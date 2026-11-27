import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { scoreText } from "./Standings.jsx";
import { formatTime } from "./battle-time.mjs";
import { useLegendPlayerMetrics } from "./legend-player-metrics.jsx";
import { createLegendRequestCache } from "./legend-request-cache.mjs";
import "./legend-leaderboard.css";

const emptyRows = [];

async function loadLocations() {
  const locations = await window.cocApp.fetchLegendLocations();
  if (!Array.isArray(locations)) throw new Error("官方接口未返回地区列表。");
  return locations.filter(({ id, name }) => Number.isSafeInteger(id) && id > 0 && typeof name === "string" && name.trim());
}

async function loadLeaderboard(location) {
  const board = await window.cocApp.fetchLegendLeaderboard({ location });
  if (!Array.isArray(board?.rows)) throw new Error("官方接口未返回榜单数据。");
  return board;
}

function useLegendRequest(key, active, load) {
  const [cache] = useState(() => createLegendRequestCache(load));
  const state = useSyncExternalStore(cache.subscribe, () => cache.read(key));

  useEffect(() => {
    if (active) void cache.request(key);
  }, [active, cache, key]);

  return [state, () => { if (active) void cache.request(key, true); }];
}

function regionName(location) {
  return location?.countryCode === "CN" ? "中国（国际服地区）" : location?.name;
}

function rankCompare(left, right) {
  return (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
}

function RankCell({ rank, previousRank }) {
  const knownPrevious = Number.isSafeInteger(previousRank) && previousRank > 0;
  return <td title={knownPrevious ? `上次排名 ${scoreText(previousRank)}` : undefined}>{scoreText(rank)}</td>;
}

const threeStarPercent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const dailyNetScore = new Intl.NumberFormat("zh-CN", { signDisplay: "exceptZero", maximumFractionDigits: 1 });

function LegendMetrics({ result, compact = false }) {
  const stats = result?.metrics;
  const unavailable = result ? "暂未取得近期战报" : "滚动到附近时查询近期战报";
  const values = [
    {
      className: "legend-strategy-value", label: "常用流派", value: stats?.strategy || "—",
      title: stats?.strategy ? `${stats.strategy} · ${scoreText(stats.strategyCount)} 场`
        : stats ? "近期进攻中暂无可识别的流派" : unavailable,
    },
    {
      className: "legend-three-star-value", label: "三星率",
      value: Number.isFinite(stats?.threeStarRate) ? threeStarPercent.format(stats.threeStarRate) : "—",
      title: stats?.attackCount ? `按已收录的 ${scoreText(stats.attackCount)} 场近期进攻统计` : stats ? "暂无近期进攻记录" : unavailable,
    },
    {
      className: "legend-daily-attack-value", label: "日均进攻杯",
      value: Number.isFinite(stats?.averageDailyAttack) ? scoreText(stats.averageDailyAttack) : "—",
      oneDay: stats?.attackDays === 1 && Number.isFinite(stats?.averageDailyAttack),
      title: stats?.attackDays ? `按 ${scoreText(stats.attackDays)} 个有完整进攻记录的联赛日统计`
        : stats ? "近两个联赛日暂无齐全的进攻记录" : unavailable,
    },
    {
      className: "legend-daily-net-value", label: "日均净杯",
      value: Number.isFinite(stats?.averageDailyNet) ? dailyNetScore.format(stats.averageDailyNet) : "—",
      oneDay: stats?.completedDays === 1 && Number.isFinite(stats?.averageDailyNet),
      title: stats?.completedDays ? `按 ${scoreText(stats.completedDays)} 个攻防齐全的联赛日统计`
        : stats ? "近两个联赛日暂无齐全的攻防记录" : unavailable,
      scoreClass: stats?.averageDailyNet > 0 ? "trophy-positive" : stats?.averageDailyNet < 0 ? "trophy-negative" : undefined,
    },
  ];

  function metricValue({ value, scoreClass, oneDay }) {
    return <><span className={scoreClass}>{value}</span>
      {oneDay && <span className="legend-metric-sample">1 日</span>}</>;
  }

  if (compact) return <dl className="legend-compact-metrics">
    {values.map((metric) => <div key={metric.label} title={metric.title}>
      <dt>{metric.label}</dt><dd>{metricValue(metric)}</dd>
    </div>)}
  </dl>;
  return values.map((metric) => <td className={`legend-metric-cell ${metric.className}`}
    key={metric.label} title={metric.title}>{metricValue(metric)}</td>);
}

export default function LegendLeaderboard({ scope, active = true, hasDeveloperToken, accountLoading, selectedTag, selectedStanding, onLookupPlayer }) {
  const regional = scope === "regional";
  const headingId = useId();
  const regionId = useId();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [chosenRegionId, chooseRegion] = useState(null);
  const enabled = hasDeveloperToken && !accountLoading;
  const [locations, refreshLocations] = useLegendRequest(regional && enabled ? "locations" : null, active, loadLocations);
  const countries = locations.data ?? emptyRows;
  const region = countries.find(({ id }) => id === chosenRegionId)
    ?? countries.find(({ countryCode }) => countryCode === "CN")
    ?? countries[0];
  const location = !enabled ? null : regional ? region?.id ?? null : "global";
  const [board, refreshBoard] = useLegendRequest(location, active, loadLeaderboard);
  const activeQuery = regional && !region ? locations : board;
  const waiting = enabled && (activeQuery.status === "idle" || activeQuery.status === "loading");
  const rows = board.data?.rows ?? emptyRows;
  const query = search.trim().toLowerCase();
  const matchingRows = query ? rows.filter((row) => row.playerName.toLowerCase().includes(query)
    || row.playerTag.toLowerCase().includes(query)) : rows;
  const hasTier = board.data?.hasTierData === true;
  const { statuses: playerMetrics, observeRow: observeMetricRow } = useLegendPlayerMetrics(matchingRows, {
    active: active && enabled && !regional,
    refreshKey: board.data?.fetchedAt,
  });
  const ownInTable = selectedTag && rows.some((row) => row.playerTag === selectedTag);
  const profileRank = Number.isSafeInteger(selectedStanding?.rank) && selectedStanding.rank > 0 ? selectedStanding.rank : null;
  const profileTrophies = selectedStanding?.trophies;
  const showProfile = !regional && selectedTag && !ownInTable && (profileRank !== null || Number.isFinite(profileTrophies));
  const range = regional ? "地区" : "全球";
  const heading = board.data?.hasTierData === false ? "官方杯数榜（接口未返回段位）" : hasTier ? `传奇 I ${range}榜` : `${range}排行榜`;

  function refresh() {
    if (regional && !region) refreshLocations();
    else refreshBoard();
  }

  return (
    <section className="legend-board" aria-labelledby={headingId}>
      <header className="report-header legend-board-header">
        <div>
          <div className="legend-board-heading">
            <h2 id={headingId}>{heading}</h2>
            {hasTier && <img src="./league-icons/105000036.png" alt="" width="30" height="30"
              title="徽章来源 ClashKing Assets，素材归 Supercell 所有" />}
          </div>
          {board.data && <p>{[
            regional ? regionName(region) : "全球",
            `已获取 ${scoreText(rows.length)} 名玩家`,
            board.data.fetchedAt && `获取时间 ${formatTime(board.data.fetchedAt)}（北京时间）`,
          ].filter(Boolean).join(" · ")}</p>}
        </div>
        <div className="legend-board-controls">
          {regional && countries.length > 0 && <label htmlFor={regionId}>地区
            <select id={regionId} value={region.id} onChange={(event) => chooseRegion(Number(event.target.value))}>
              {countries.map((item) => <option key={item.id} value={item.id}>{regionName(item)}</option>)}
            </select>
          </label>}
          <button type="button" disabled={!enabled || waiting} onClick={refresh}>刷新榜单</button>
        </div>
      </header>

      {showProfile && <dl className="legend-player-summary" aria-label="当前村庄个人资料">
        <div><dt>当前村庄</dt><dd>{selectedTag}</dd></div>
        <div><dt>资料中的全球排名</dt><dd>{scoreText(profileRank)}</dd></div>
        <div><dt>传奇杯数</dt><dd>{scoreText(profileTrophies)}</dd></div>
      </dl>}

      {waiting && rows.length > 0 && <p className="legend-board-message" role="status">正在刷新榜单…</p>}
      {activeQuery.status === "error" && rows.length > 0 && <p className="legend-board-message legend-board-error" role="alert">
        刷新失败，保留上次结果。{activeQuery.error}
      </p>}
      {rows.length > 0 && <div className="legend-board-search">
        <label htmlFor={searchId}>榜内搜索</label>
        <input id={searchId} type="search" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="玩家名或 Tag" autoComplete="off" />
        {query && <span role="status">找到 {scoreText(matchingRows.length)} 名玩家</span>}
      </div>}
      {!regional && matchingRows.length > 0 && <p className="legend-metrics-source">
        统计今天和上一个联赛日（北京时间 13:00 换日）。日均进攻杯取进攻满 8 场的日期，日均净杯取攻防各满 8 场的日期。
      </p>}
      {matchingRows.length ? (
        <div className="legend-table-card">
          <table className={`legend-table${regional ? "" : " legend-global-table"}`} aria-label={`${range}排名表`}>
            <colgroup><col className="legend-rank-column" /><col />
              {!regional && <>
                <col className="legend-metric-column legend-strategy-column" />
                <col className="legend-metric-column legend-three-star-column" />
                <col className="legend-metric-column legend-daily-attack-column" />
                <col className="legend-metric-column legend-daily-net-column" />
              </>}
              <col className="legend-clan-column" />
              <col className="legend-town-hall-column" /><col className="legend-trophy-column" /></colgroup>
            <thead><tr><th scope="col">名次</th><th scope="col">村庄</th>
              {!regional && <>
                <th scope="col" className="legend-metric-cell legend-strategy-value">常用流派</th>
                <th scope="col" className="legend-metric-cell">三星率</th>
                <th scope="col" className="legend-metric-cell">日均进攻杯</th>
                <th scope="col" className="legend-metric-cell">日均净杯</th>
              </>}
              <th scope="col" className="legend-clan-heading">部落</th>
              <th scope="col">大本营</th><th scope="col">当前杯数</th></tr></thead>
            <tbody>{[...matchingRows].sort(rankCompare).map((row) => {
              const own = row.playerTag === selectedTag;
              const name = row.playerName || row.playerTag || "未知村庄";
              const metrics = playerMetrics.get(row.playerTag);
              return (
                <tr key={row.playerTag || row.rank} className={own ? "legend-own-row" : undefined}
                  data-player-tag={row.playerTag} ref={regional ? undefined : observeMetricRow}>
                  <RankCell rank={row.rank} previousRank={row.previousRank} />
                  <th scope="row">
                    {row.playerTag && onLookupPlayer ? <button className="legend-player-button" type="button" title={name}
                      aria-label={`查询村庄 ${name} ${row.playerTag}`} onClick={() => onLookupPlayer(row.playerTag)}>{name}</button>
                      : <span className="legend-player-name" title={name}>{name}</span>}
                    <small>{[row.playerTag, own && "当前村庄"].filter(Boolean).join(" · ")}</small>
                    {!regional && <LegendMetrics result={metrics} compact />}
                  </th>
                  {!regional && <LegendMetrics result={metrics} />}
                  <td className="legend-clan-name" title={row.clanName || row.clanTag}>{row.clanName || row.clanTag || "—"}</td>
                  <td>{scoreText(row.townHallLevel)}</td>
                  <td className="legend-trophy-score">{scoreText(row.trophies)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : (
        <div className="empty-card" role={activeQuery.status === "error" ? "alert" : "status"}>
          <p>{rows.length ? "榜内没有匹配的玩家。可以在顶部「临时查村庄」按 Tag 查询。"
            : accountLoading ? "正在读取本机设置…" : !enabled ? "在「管理令牌」保存开发者 API 令牌，即可查询榜单。"
            : activeQuery.status === "error" ? activeQuery.error
            : waiting ? regional && !region ? "正在查询可用地区…" : "正在查询榜单…"
            : regional && !region ? "官方接口本次未返回可用地区。" : "官方接口本次未返回榜单成员。"}</p>
        </div>
      )}
    </section>
  );
}
