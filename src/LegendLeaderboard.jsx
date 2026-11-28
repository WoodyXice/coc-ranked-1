import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { compareRows, legendStrategyLeaderboard, nextLegendDayStart, sortLegendPlayers } from "../insights.mjs";
import { CompactSort, scoreText, SortHeader } from "./Standings.jsx";
import { formatTime } from "./battle-time.mjs";
import { useLegendPlayerMetrics } from "./legend-player-metrics.jsx";
import { createLegendRequestCache } from "./legend-request-cache.mjs";
import RankedOverview from "./RankedOverview.jsx";
import "./legend-leaderboard.css";

const emptyRows = [];
const playerColumns = [
  { key: "rank", label: "名次", ascendingFirst: true },
  { key: "playerName", label: "村庄", ascendingFirst: true },
  { key: "strategy", label: "常用流派", metric: true, ascendingFirst: true, className: "legend-metric-cell legend-strategy-value" },
  { key: "threeStarRate", label: "三星率", metric: true, className: "legend-metric-cell", title: "近两个联赛日的三星场次 ÷ 有效进攻场次" },
  { key: "averageDailyAttack", label: "日均进攻杯", metric: true, className: "legend-metric-cell", title: "近两个联赛日，仅计有完整 8 场进攻杯数的日期" },
  { key: "averageDailyNet", label: "日均净杯", metric: true, className: "legend-metric-cell", title: "近两个联赛日，仅计进攻和防守各有完整 8 场杯数的日期" },
  { key: "clanName", label: "部落", ascendingFirst: true, className: "legend-clan-heading" },
  { key: "townHallLevel", label: "大本营", className: "legend-town-hall" },
  { key: "trophies", label: "当前杯数" },
];

const strategyColumns = [
  { key: "strategy", label: "流派", ascendingFirst: true },
  { key: "threeStarRate", label: "三星率", title: "该流派的三星场次 ÷ 有效进攻场次" },
  { key: "playerCount", label: "使用人数" },
];

async function loadLocations() {
  const locations = await window.cocApp.fetchLegendLocations();
  if (!Array.isArray(locations)) throw new Error("官方接口未返回地区列表。");
  return locations.filter(({ id, name }) => Number.isSafeInteger(id) && id > 0 && typeof name === "string" && name.trim());
}

async function loadLeaderboard(key, force) {
  const [location, size] = key.split(":");
  const board = await window.cocApp.fetchLegendLeaderboard({ location: location === "global" ? location : Number(location), limit: Number(size), force });
  if (!Array.isArray(board?.rows)) throw new Error("官方接口未返回榜单数据。");
  return board;
}

function useLegendRequest(key, active, load, section) {
  const [cache] = useState(() => createLegendRequestCache(load));
  const state = useSyncExternalStore(cache.subscribe, () => cache.read(key));

  useEffect(() => {
    if (!active || key === null) return;
    void cache.request(key);
    if (key === "locations") return;
    let timer;
    function scheduleRollover() {
      const now = Date.now();
      timer = setTimeout(() => { void cache.request(key); scheduleRollover(); }, nextLegendDayStart(now) - now);
    }
    scheduleRollover();
    return () => clearTimeout(timer);
  }, [active, cache, key, section]);

  return [state, () => { if (active) void cache.request(key, true); }];
}

function regionName(location) {
  return location?.countryCode === "CN" ? "中国（国际服地区）" : location?.name;
}

function RankCell({ rank, previousRank }) {
  const knownPrevious = Number.isSafeInteger(previousRank) && previousRank > 0;
  return <td title={knownPrevious ? `上次排名 ${scoreText(previousRank)}` : undefined}>{scoreText(rank)}</td>;
}

const threeStarPercent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const dailyNetScore = new Intl.NumberFormat("zh-CN", { signDisplay: "exceptZero", maximumFractionDigits: 1 });

function PlayerLink({ player, onLookupPlayer }) {
  const name = player.playerName || player.playerTag || "未知村庄";
  if (!player.playerTag || !onLookupPlayer) return <span className="legend-player-name" title={name}>{name}</span>;
  return <button className="legend-player-button" type="button" title={`${name} ${player.playerTag}`}
    aria-label={`查询村庄 ${name} ${player.playerTag}`} onClick={() => onLookupPlayer(player.playerTag)}>{name}</button>;
}

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

function PlayerTable({ label, rows, statuses, sort, onSort, observeRow, selectedTag, onLookupPlayer }) {
  return <div className="legend-table-card">
    <table className="legend-table legend-player-table" aria-label={label}>
      <colgroup>
        <col className="legend-rank-column" /><col />
        <col className="legend-metric-column legend-strategy-column" />
        <col className="legend-metric-column legend-three-star-column" />
        <col className="legend-metric-column legend-daily-attack-column" />
        <col className="legend-metric-column legend-daily-net-column" />
        <col className="legend-clan-column" /><col className="legend-town-hall-column" /><col className="legend-trophy-column" />
      </colgroup>
      <thead><tr>{playerColumns.map((column) =>
        <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />)}</tr></thead>
      <tbody>{rows.map((row) => {
        const own = row.playerTag === selectedTag;
        const metrics = statuses.get(row.playerTag);
        const clan = row.clanName || row.clanTag;
        return <tr key={row.playerTag || row.rank} className={own ? "legend-own-row" : undefined}
          data-player-tag={row.playerTag} ref={observeRow}>
          <RankCell rank={row.rank} previousRank={row.previousRank} />
          <th scope="row">
            <PlayerLink player={row} onLookupPlayer={onLookupPlayer} />
            <small>{[row.playerTag, own && "当前村庄"].filter(Boolean).join(" · ")}</small>
            <small className="legend-compact-clan">{[clan, row.townHallLevel && `${row.townHallLevel} 本`].filter(Boolean).join(" · ")}</small>
            <LegendMetrics result={metrics} compact />
          </th>
          <LegendMetrics result={metrics} />
          <td className="legend-clan-name" title={clan}>{clan || "—"}</td>
          <td className="legend-town-hall">{scoreText(row.townHallLevel)}</td>
          <td className="legend-trophy-score">{scoreText(row.trophies)}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function StrategyTable({ label, strategies, sort, onSort, onLookupPlayer }) {
  const ranked = strategies.toSorted((a, b) => compareRows(a, b, sort.key, sort.ascending));
  return <div className="legend-table-card">
    <table className="legend-table legend-strategy-table" aria-label={label}>
      <colgroup><col className="legend-style-name-column" /><col className="legend-style-rate-column" />
        <col className="legend-style-count-column" /><col /></colgroup>
      <thead><tr>{strategyColumns.map((column) =>
        <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />)}
        <th scope="col" title="按该流派三星率排名，同率时有效进攻场次多者优先">流派前三</th></tr></thead>
      <tbody>{ranked.map((row) => <tr key={row.strategy}>
        <th scope="row">{row.strategy}</th>
        <td><strong>{threeStarPercent.format(row.threeStarRate)}</strong>
          <small title="三星场次 / 有效进攻场次">{row.threeStarCount}/{row.scoredCount} 场</small>
        </td>
        <td>{scoreText(row.playerCount)}</td>
        <td className="legend-style-leaders">
          <ol aria-label={row.strategy + "前三名"}>{row.topPlayers.map((player, index) =>
            <li key={player.playerTag}>
              <span className="legend-style-place" aria-hidden="true">{index + 1}</span>
              <div>
                <PlayerLink player={player} onLookupPlayer={onLookupPlayer} />
                <small title="个人使用该流派的三星率与三星 / 有效进攻场次">
                  {threeStarPercent.format(player.threeStarRate)} · {player.threeStarCount}/{player.scoredCount} 场
                </small>
              </div>
            </li>)}</ol>
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function PagedPlayers({ rows, ...props }) {
  const [selectedPage, setPage] = useState(1);
  const pageSize = 100;
  if (rows.length <= 200) return <PlayerTable rows={rows} {...props} />;
  const pages = Math.ceil(rows.length / pageSize);
  const current = Math.min(selectedPage, pages);
  return <>
    <nav className="legend-pages" aria-label="榜单分页">
      <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>上一页</button>
      <select aria-label="榜单页码" value={current} onChange={event => setPage(Number(event.target.value))}>
        {Array.from({ length: pages }, (_, i) => <option key={i} value={i + 1}>第 {i + 1} / {pages} 页</option>)}
      </select>
      <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>下一页</button>
    </nav>
    <PlayerTable rows={rows.slice((current - 1) * pageSize, current * pageSize)} {...props} />
  </>;
}

export default function LegendLeaderboard({ scope, active = true, overview = false, hasDeveloperToken, accountLoading,
  selectedTag, selectedStanding, onLookupPlayer, onOpenGlobal, onOpenVillages }) {
  const regional = scope === "regional";
  const headingId = useId();
  const regionId = useId();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(200);
  const [draftLimit, setDraftLimit] = useState("200");
  const [limitError, setLimitError] = useState("");
  const [view, setView] = useState("players");
  const [playerSort, setPlayerSort] = useState({ key: "rank", ascending: true });
  const [strategySort, setStrategySort] = useState({ key: "threeStarRate", ascending: false });
  const [chosenRegionId, chooseRegion] = useState(null);
  const enabled = hasDeveloperToken && !accountLoading;
  const [locations, refreshLocations] = useLegendRequest(regional && enabled ? "locations" : null, active, loadLocations);
  const countries = locations.data ?? emptyRows;
  const region = countries.find(({ id }) => id === chosenRegionId)
    ?? countries.find(({ countryCode }) => countryCode === "CN")
    ?? countries[0];
  const location = !enabled ? null : regional ? region?.id ?? null : "global";
  const [board, refreshBoard] = useLegendRequest(location === null ? null : `${location}:${limit}`, active, loadLeaderboard, overview);
  const activeQuery = regional && !region ? locations : board;
  const waiting = enabled && (activeQuery.status === "idle" || activeQuery.status === "loading");
  const rows = board.data?.rows ?? emptyRows;
  const query = regional ? search.trim().toLowerCase() : "";
  const strategyView = view === "strategies";
  const loadAll = overview || strategyView || playerColumns.some((column) => column.key === playerSort.key && column.metric);
  const hasTier = board.data?.hasTierData === true;
  const { statuses, observeRow } = useLegendPlayerMetrics(rows, {
    active: active && enabled, location, loadAll, limit,
    refreshKey: board.data?.fetchedAt,
  });
  const metricsByTag = useMemo(() => new Map([...statuses].filter(([, entry]) => entry.metrics)
    .map(([tag, entry]) => [tag, entry.metrics])), [statuses]);
  const players = useMemo(() => {
    if (overview || strategyView) return emptyRows;
    const matches = query ? rows.filter(({ playerName, playerTag }) => playerName?.toLowerCase().includes(query)
      || playerTag?.toLowerCase().includes(query)) : rows;
    return sortLegendPlayers(matches, metricsByTag, playerSort.key, playerSort.ascending ? "asc" : "desc");
  }, [rows, metricsByTag, query, playerSort, strategyView, overview]);
  const strategies = useMemo(() => overview || strategyView ? legendStrategyLeaderboard(rows, metricsByTag) : emptyRows,
    [rows, metricsByTag, strategyView, overview]);
  const unavailable = statuses.size - metricsByTag.size;
  const metricsPending = statuses.size < rows.length;
  const ownInTable = selectedTag && rows.some((row) => row.playerTag === selectedTag);
  const profileRank = Number.isSafeInteger(selectedStanding?.rank) && selectedStanding.rank > 0 ? selectedStanding.rank : null;
  const profileTrophies = selectedStanding?.trophies;
  const showProfile = !regional && selectedTag && !ownInTable && (profileRank !== null || Number.isFinite(profileTrophies));
  const range = regional ? "地区" : "全球";
  const heading = board.data?.hasTierData === false ? `官方${range}杯数榜` : hasTier ? `传奇 I ${range}榜` : `${range}排行榜`;
  const scopeControl = !regional && <form className="legend-scope-control" onSubmit={event => {
    event.preventDefault();
    const digits = draftLimit.trim().normalize("NFKC");
    const next = Number(digits);
    if (!/^\d+$/.test(digits) || !Number.isSafeInteger(next) || next < 1) {
      setLimitError("请输入有效的正整数");
      return;
    }
    setLimitError("");
    setDraftLimit(String(next));
    setLimit(next);
  }}>
    <label>榜单前 <input aria-label="榜单范围" inputMode="numeric" value={draftLimit}
      aria-invalid={!!limitError} onFocus={event => event.target.select()} onChange={event => {
        setDraftLimit(event.target.value); setLimitError("");
      }} /> 人</label>
    <button type="submit">应用</button>
    {limitError && <small role="alert">{limitError}</small>}
  </form>;

  function refresh() {
    if (regional && !region) refreshLocations();
    else refreshBoard();
  }

  if (overview) return <RankedOverview rows={rows} strategies={strategies} metricsByTag={metricsByTag}
    board={board} waiting={waiting} pending={metricsPending} unavailable={unavailable} scopeControl={scopeControl} limit={limit}
    accountLoading={accountLoading} enabled={enabled} onRefresh={refresh}
    onOpenVillages={onOpenVillages} onLookupPlayer={onLookupPlayer}
    onOpenStrategies={() => { setView("strategies"); onOpenGlobal?.(); }} />;

  return (
    <section className="legend-board" aria-labelledby={headingId}>
      <header className="report-header legend-board-header">
        <div>
          <div className="legend-board-heading">
            <h2 id={headingId}>{heading}</h2>
            {hasTier && <img src="./league-icons/105000036.png" alt="" width="30" height="30"
              title="徽章来源 ClashKing Assets，素材归 Supercell 所有" />}
            {rows.length > 0 && <div className="metric-control legend-view-control" role="group" aria-label={`${range}榜视图`}>
              <button type="button" aria-pressed={!strategyView} onClick={() => setView("players")}>玩家排名</button>
              <button type="button" aria-pressed={strategyView} onClick={() => setView("strategies")}>流派排行</button>
            </div>}
          </div>
          {board.data && <p className="legend-board-meta">
            <span>{scoreText(rows.length)} 名玩家</span>
            <span title="今日和上一个联赛日，北京时间每日 13:00 换日">近两个联赛日</span>
            {board.data.fetchedAt && <time dateTime={board.data.fetchedAt}>更新于 {formatTime(board.data.fetchedAt)}（北京时间）</time>}
            {board.data.hasTierData === false && <span>接口未返回段位</span>}
            {board.data.paginationInterrupted ? <span>榜单分页中断，可刷新重试</span>
              : !regional && rows.length < limit && <span>已显示本次接口返回的全部可用玩家</span>}
          </p>}
        </div>
        <div className="legend-board-controls">
          {scopeControl}
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
      {rows.length > 0 && !strategyView && <div className="legend-board-tools">
        {regional && <div className="legend-board-search">
          <label htmlFor={searchId}>榜内搜索</label>
          <input id={searchId} type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="玩家名或 Tag" autoComplete="off" />
          {query && <span role="status">找到 {scoreText(players.length)} 名玩家</span>}
        </div>}
        <CompactSort columns={playerColumns} sort={playerSort} onSort={setPlayerSort} />
      </div>}
      {loadAll && (metricsPending || unavailable > 0) && <p className="legend-board-message legend-metric-coverage" role="status">
        {metricsPending && "正在读取战报 · "}已取得 {metricsByTag.size}/{rows.length} 人
        {unavailable > 0 && ` · ${unavailable} 人暂缺`}
      </p>}
      {rows.length > 0 && strategyView ? (
        strategies.length ? <StrategyTable label={`${range}流派排行`} strategies={strategies}
          sort={strategySort} onSort={setStrategySort} onLookupPlayer={onLookupPlayer} />
          : <div className="empty-card" role="status"><p>{metricsPending ? "正在汇总各流派的进攻记录…"
            : "近两个联赛日暂无已识别流派的有效进攻记录。"}</p></div>
      ) : players.length ? (
        <PagedPlayers key={`${location}:${limit}:${playerSort.key}:${playerSort.ascending}:${query}`} label={`${range}排名表`} rows={players} statuses={statuses} observeRow={observeRow}
          selectedTag={selectedTag} sort={playerSort} onSort={setPlayerSort} onLookupPlayer={onLookupPlayer} />
      ) : (
        <div className="empty-card" role={activeQuery.status === "error" ? "alert" : "status"}>
          <p>{rows.length ? "榜内没有匹配的玩家。"
            : accountLoading ? "正在读取本机设置…" : !enabled ? "在「管理令牌」保存开发者 API 令牌，即可查询榜单。"
            : activeQuery.status === "error" ? activeQuery.error
            : waiting ? regional && !region ? "正在查询可用地区…" : "正在查询榜单…"
            : regional && !region ? "官方接口本次未返回可用地区。" : "官方接口本次未返回榜单成员。"}</p>
        </div>
      )}
    </section>
  );
}
