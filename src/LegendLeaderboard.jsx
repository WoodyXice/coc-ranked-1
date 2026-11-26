import { useEffect, useId, useRef, useState } from "react";
import { scoreText } from "./Standings.jsx";
import { formatTime } from "./battle-time.mjs";
import "./legend-leaderboard.css";

const emptyRequest = { key: null, status: "idle", data: null, error: "" };
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

function useLegendRequest(key, refresh, load) {
  const [state, setState] = useState(emptyRequest);
  const pending = useRef(null);

  useEffect(() => {
    if (key === null) return;
    let active = true;
    setState((previous) => ({ key, status: "loading", data: previous.key === key ? previous.data : null, error: "" }));
    if (pending.current?.key !== key || pending.current?.refresh !== refresh) {
      pending.current = { key, refresh, task: Promise.resolve().then(() => load(key)) };
    }
    const { task } = pending.current;
    task.then((data) => {
      if (active) setState({ key, status: "ready", data, error: "" });
    }).catch((error) => {
      if (active) setState((previous) => ({ ...previous, status: "error", error: error?.message || "查询失败，请重试。" }));
    }).finally(() => {
      if (pending.current?.task === task) pending.current = null;
    });
    return () => { active = false; };
  }, [key, refresh, load]);

  return state.key === key ? state : emptyRequest;
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

export default function LegendLeaderboard({ scope, hasDeveloperToken, accountLoading, selectedTag, selectedStanding, onLookupPlayer }) {
  const regional = scope === "regional";
  const headingId = useId();
  const regionId = useId();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [chosenRegionId, chooseRegion] = useState(null);
  const [locationRefresh, refreshLocations] = useState(0);
  const [boardRefresh, refreshBoard] = useState(0);
  const enabled = hasDeveloperToken && !accountLoading;
  const locations = useLegendRequest(regional && enabled ? "locations" : null, locationRefresh, loadLocations);
  const countries = locations.data ?? emptyRows;
  const region = countries.find(({ id }) => id === chosenRegionId)
    ?? countries.find(({ countryCode }) => countryCode === "CN")
    ?? countries[0];
  const location = !enabled ? null : regional ? region?.id ?? null : "global";
  const board = useLegendRequest(location, boardRefresh, loadLeaderboard);
  const activeQuery = regional && !region ? locations : board;
  const waiting = enabled && (activeQuery.status === "idle" || activeQuery.status === "loading");
  const rows = board.data?.rows ?? emptyRows;
  const query = search.trim().toLowerCase();
  const matchingRows = query ? rows.filter((row) => row.playerName.toLowerCase().includes(query)
    || row.playerTag.toLowerCase().includes(query)) : rows;
  const hasTier = board.data?.hasTierData === true;
  const ownInTable = selectedTag && rows.some((row) => row.playerTag === selectedTag);
  const profileRank = Number.isSafeInteger(selectedStanding?.rank) && selectedStanding.rank > 0 ? selectedStanding.rank : null;
  const profileTrophies = selectedStanding?.trophies;
  const showProfile = !regional && selectedTag && !ownInTable && (profileRank !== null || Number.isFinite(profileTrophies));
  const range = regional ? "地区" : "全球";
  const heading = board.data?.hasTierData === false ? "官方杯数榜（接口未返回段位）" : hasTier ? `传奇 I ${range}榜` : `${range}排行榜`;

  function refresh() {
    if (regional && !region) refreshLocations((count) => count + 1);
    else refreshBoard((count) => count + 1);
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
      {matchingRows.length ? (
        <div className="legend-table-card" role="region" tabIndex={0} aria-label={`${range}排名表`}>
          <table className="legend-table">
            <colgroup><col className="legend-rank-column" /><col /><col className="legend-clan-column" />
              <col className="legend-town-hall-column" /><col className="legend-trophy-column" /></colgroup>
            <thead><tr><th scope="col">名次</th><th scope="col">村庄</th><th scope="col">部落</th>
              <th scope="col">大本营</th><th scope="col">当前杯数</th></tr></thead>
            <tbody>{[...matchingRows].sort(rankCompare).map((row) => {
              const own = row.playerTag === selectedTag;
              const name = row.playerName || row.playerTag || "未知村庄";
              return (
                <tr key={row.playerTag || row.rank} className={own ? "legend-own-row" : undefined}>
                  <RankCell rank={row.rank} previousRank={row.previousRank} />
                  <th scope="row">
                    {row.playerTag && onLookupPlayer ? <button className="legend-player-button" type="button" title={name}
                      aria-label={`查询村庄 ${name} ${row.playerTag}`} onClick={() => onLookupPlayer(row.playerTag)}>{name}</button>
                      : <span className="legend-player-name" title={name}>{name}</span>}
                    <small>{[row.playerTag, own && "当前村庄"].filter(Boolean).join(" · ")}</small>
                  </th>
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
          <p>{rows.length ? "榜内没有匹配的玩家。也可用「传奇 I 查村庄」按 Tag 直接查询。"
            : accountLoading ? "正在读取本机设置…" : !enabled ? "在「管理令牌」保存开发者 API 令牌，即可查询榜单。"
            : activeQuery.status === "error" ? activeQuery.error
            : waiting ? regional && !region ? "正在查询可用地区…" : "正在查询榜单…"
            : regional && !region ? "官方接口本次未返回可用地区。" : "官方接口本次未返回榜单成员。"}</p>
        </div>
      )}
    </section>
  );
}
