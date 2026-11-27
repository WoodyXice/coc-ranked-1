import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import ArmyLineup, { ArmyAttribution, hasLineup } from "./ArmyLineup.jsx";
import { formatDuration, formatShortTime, formatTime } from "./battle-time.mjs";
import { DEFENSE_TOP_N, attackEquipmentIds, defenseRanks, myAttacksByOpponent } from "../insights.mjs";

const number = new Intl.NumberFormat("zh-CN");
const signed = new Intl.NumberFormat("zh-CN", { signDisplay: "exceptZero" });

export function scoreText(value) {
  return Number.isFinite(value) ? number.format(value) : "—";
}

function destructionText(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

function AttackProgress({ limit, completed, className }) {
  const knownLimit = Number.isSafeInteger(limit) && limit >= 0;
  const knownCompleted = Number.isSafeInteger(completed) && completed >= 0;
  const allowed = knownLimit ? scoreText(limit) : "—";
  const played = knownCompleted ? scoreText(completed) : "—";
  const meaning = [
    knownLimit ? `可进攻 ${allowed} 场` : "可进攻场次未知",
    knownCompleted ? `已完成 ${played} 场` : "已完成场次未知",
  ].join("，");
  return <td className={className} title={meaning} aria-label={meaning}>{knownLimit || knownCompleted ? `${allowed}/${played}` : "—"}</td>;
}

function officialLeagueIcon(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    return url.origin === "https://api-assets.clashofclans.com" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

export function LeagueBadge({ tier }) {
  const [failedIcons, setFailedIcons] = useState([]);
  const id = tier?.id;
  const fallback = Number.isInteger(id) && id >= 105000001 && id <= 105000036 ? `./league-icons/${id}.png` : "";
  const icon = [officialLeagueIcon(tier?.iconUrl), fallback].find((source) => source && !failedIcons.includes(source));
  const name = typeof tier?.name === "string" ? tier.name.trim() : "";
  if (!name && !icon) return null;
  return (
    <span className="standings-league-badge">
      {icon && <img src={icon} width="30" height="30" referrerPolicy="no-referrer" alt=""
        title={icon === fallback ? "徽章来源 ClashKing Assets，素材归 Supercell 所有" : undefined}
        onError={() => setFailedIcons((failed) => [...failed, icon])} />}
      <span>{name || "排位联赛"}</span>
    </span>
  );
}

export function Trophy({ value, loss = false, change = true }) {
  if (!Number.isFinite(value)) return "—";
  const amount = loss && value !== 0 ? -Math.abs(value) : value;
  return <span className={change ? amount > 0 ? "trophy-positive" : amount < 0 ? "trophy-negative" : undefined : undefined}>
    {(change ? signed : number).format(amount)}
  </span>;
}

export function StandingSummary({ battleViews, standing, showPlayer = true }) {
  if (!standing) return null;
  const mode = battleViews?.defenseTrophyMode;
  const lost = mode === "lost";
  const mixed = mode === "mixed";
  const personal = battleViews?.personalOnly;
  const rank = personal ? battleViews.currentLegendRank ?? standing.rank : standing.rank;
  return (
    <section className="standing-summary" aria-label="当前村庄排位摘要">
      {showPlayer && <p>{[standing.playerName || battleViews?.playerName, standing.playerTag || battleViews?.playerTag].filter(Boolean).join(" · ")}</p>}
      <dl className={"battle-summary score-summary" + (personal ? " legend-score-summary" : "")}>
        <div><dt>{personal ? "当前传奇排名" : "小组排名"}</dt><dd>{Number.isFinite(rank) ? `第 ${scoreText(rank)} 名` : "—"}</dd></div>
        <div><dt>进攻得杯</dt><dd><Trophy value={standing.attackTrophies} /></dd></div>
        <div><dt>{mixed ? "防守净杯" : lost ? "防守扣杯" : "防守得杯"}</dt><dd><Trophy value={mixed ? standing.defenseNetTrophies : standing.defenseTrophies} loss={lost} /></dd></div>
        <div><dt>{personal ? "本周净杯" : "最终杯数"}</dt><dd><Trophy value={standing.trophies} change={personal} /></dd></div>
        {personal && <div><dt>当前传奇杯</dt><dd>{scoreText(battleViews.currentLegendTrophies)}</dd></div>}
      </dl>
    </section>
  );
}

export function compareRows(a, b, key, ascending) {
  const first = a[key];
  const second = b[key];
  if (typeof first === "string" && typeof second === "string" && first && second) {
    return ascending ? first.localeCompare(second, "zh-CN") : second.localeCompare(first, "zh-CN");
  }
  if (typeof first === "string" && first) return -1;
  if (typeof second === "string" && second) return 1;
  if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : 0;
  if (!Number.isFinite(second)) return -1;
  return ascending ? first - second : second - first;
}

export function SortHeader({ column: { key, label, title, ascendingFirst = false, className }, sort, onSort }) {
  const active = sort.key === key;
  return (
    <th scope="col" className={className} aria-sort={active ? sort.ascending ? "ascending" : "descending" : undefined}>
      <button type="button" className="sort-button" title={title}
        onClick={() => onSort({ key, ascending: active ? !sort.ascending : ascendingFirst })}>
        {label}{active && <span className="sort-indicator" aria-hidden="true">{sort.ascending ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function DirectionTiming({ timestamp, average, count }) {
  return <>
    <span title={count > 0 ? `按有用时的 ${scoreText(count)} 场计算` : undefined}>{formatDuration(average)}</span>
    {timestamp && <small>最近 <time dateTime={timestamp} title={formatTime(timestamp)}>{formatShortTime(timestamp)}</time></small>}
  </>;
}

function ArmyHistory({ history, player, focusEquipment }) {
  return (
    <div className="group-army-history">
      <h3>{player.playerName || player.playerTag} 已获取的进攻阵容</h3>
      {history.map((battle, index) => {
        const timestamp = battle.battleTimestamp || battle.timestamp;
        const strategy = battle.strategy || "已获取阵容";
        const gear = focusEquipment ? attackEquipmentIds(battle.army) : null;
        const carried = !!focusEquipment?.ids?.length && focusEquipment.ids.every((id) => gear.has(id));
        const facts = [
          Number.isFinite(battle.durationSeconds) && `用时 ${formatDuration(battle.durationSeconds)}`,
          Number.isInteger(battle.stars) && `${battle.stars} 星`,
          Number.isFinite(battle.destruction) && `${battle.destruction}%`,
        ].filter(Boolean);
        return (
          <div className={"army-history-row" + (carried ? " army-history-focus" : "")} key={battle.id || index}>
            <div className="army-history-label">
              <strong title={strategy}>{strategy}</strong>
              {carried && <span className="gear-badge">带{focusEquipment.name}</span>}
              <span>
                {timestamp && <> · <time dateTime={timestamp} title={formatTime(timestamp)}>{formatShortTime(timestamp)}</time></>}
                {facts.length > 0 && " · " + facts.join(" · ")}
              </span>
            </div>
            <ArmyLineup army={battle.army} label="进攻阵容明细" />
          </div>
        );
      })}
      <ArmyAttribution />
    </div>
  );
}

const emptyAttacks = [];
const initialSort = { key: "rank", ascending: true };
const compactWidth = 1160;
const coreClass = {
  rank: "standings-core standings-rank",
  player: "standings-core standings-player",
  progress: "standings-core standings-progress",
  attack: "standings-core standings-attack",
  defense: "standings-core standings-defense",
  total: "standings-core standings-total",
  defenseRank: "standings-core standings-defense-rank",
};
const rankColumn = { key: "rank", label: "排名", ascendingFirst: true, className: coreClass.rank };
const defenseRankColumn = { key: "defenseRank", label: "防守排名", ascendingFirst: true, className: coreClass.defenseRank,
  title: "按防守得杯排名，并列时平均被打星少的靠前" };
const detailColumns = [
  { key: "defenseCount", label: "防守场次", widthClass: "stat-column", value: (row) => scoreText(row.defenseCount) },
  { key: "attackStars", label: "进攻总星", widthClass: "stat-column", value: (row) => scoreText(row.attackStars) },
  { key: "attackDestruction", label: "进攻摧毁率", widthClass: "destruction-column",
    title: "该玩家进攻时造成的平均摧毁率", value: (row) => destructionText(row.attackDestruction) },
  { key: "defenseDestruction", label: "平均被摧毁率", widthClass: "destruction-column", ascendingFirst: true,
    title: "该玩家防守时对手造成的平均摧毁率，越低防守表现越好", value: (row) => destructionText(row.defenseDestruction) },
  { key: "attackDurationAverage", label: "平均进攻用时", widthClass: "timing-column",
    value: (row) => <DirectionTiming timestamp={row.lastAttackAt} average={row.attackDurationAverage} count={row.attackDurationCount} /> },
  { key: "defenseDurationAverage", label: "平均防守用时", widthClass: "timing-column",
    value: (row) => <DirectionTiming timestamp={row.lastDefenseAt} average={row.defenseDurationAverage} count={row.defenseDurationCount} /> },
];

function CompactSort({ columns, sort, onSort }) {
  return (
    <label className="standings-compact-sort">
      <span>排序方式</span>
      <select value={`${sort.key}:${sort.ascending ? "asc" : "desc"}`} onChange={(event) => {
        const [key, direction] = event.target.value.split(":");
        onSort({ key, ascending: direction === "asc" });
      }}>
        {columns.flatMap((column) => [Boolean(column.ascendingFirst), !column.ascendingFirst].map((ascending) => {
          const value = `${column.key}:${ascending ? "asc" : "desc"}`;
          return <option key={value} value={value}>{column.label} · {ascending ? "升序" : "降序"}</option>;
        }))}
      </select>
    </label>
  );
}

function MyResult({ results }) {
  return results.map((result, index) => (
    <span className="my-result" key={index} title={result.timestamp ? formatTime(result.timestamp) : undefined}>
      {Number.isInteger(result.stars) ? `${result.stars}★` : "—"}{Number.isFinite(result.destruction) ? ` ${result.destruction}%` : ""}
    </span>
  ));
}

export default function Standings({ rows, battleViews, groupTag, week, leagueTier, isSample,
  attacks = emptyAttacks, classifiedAttacks = emptyAttacks, onOpenLegend, onLookupPlayer, focus = null,
  showOwnResults = true, requireFullDefenseRanks = false }) {
  const [sort, setSort] = useState(initialSort);
  const [openPanel, setOpenPanel] = useState(null);
  const [compact, setCompact] = useState(false);
  const sectionRef = useRef(null);
  const panelPrefix = useId();
  const mode = battleViews?.defenseTrophyMode;
  const lost = mode === "lost";
  const selected = battleViews?.playerTag;
  const ranks = useMemo(() => defenseRanks(rows, mode), [rows, mode]);
  const mine = useMemo(() => showOwnResults ? myAttacksByOpponent(battleViews) : null, [battleViews, showOwnResults]);
  const showDefenseRank = !battleViews?.personalOnly && ranks.size > 0 && (!requireFullDefenseRanks || ranks.size === rows.length);
  const showMyResult = showOwnResults && showDefenseRank;
  const rankedRows = rows.map((row) => ({ ...row, defenseRank: ranks.get(row.playerTag) ?? null }));

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const update = (width) => setCompact(width < compactWidth);
    update(section.clientWidth);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!focus?.playerTag) return;
    setOpenPanel({ playerTag: focus.playerTag, panel: "lineup" });
    const frame = requestAnimationFrame(() => {
      document.getElementById(`${panelPrefix}-row-${focus.playerTag.replace(/^#/, "")}`)
        ?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, panelPrefix]);
  const attackHistory = useMemo(() => {
    const grouped = new Map();
    const labels = new Map(classifiedAttacks.map(({ id, strategy }) => [id, strategy]));
    for (const battle of attacks) {
      if (!battle.playerTag || !hasLineup(battle.army)) continue;
      if (!grouped.has(battle.playerTag)) grouped.set(battle.playerTag, []);
      grouped.get(battle.playerTag).push({ ...battle, strategy: labels.get(battle.id) || battle.strategy });
    }
    for (const history of grouped.values()) {
      history.sort((a, b) => (b.battleTimestamp || b.timestamp || "").localeCompare(a.battleTimestamp || a.timestamp || ""));
    }
    return grouped;
  }, [attacks, classifiedAttacks]);
  const scoreColumns = [
    { key: "attackCount", label: "进攻进度", className: coreClass.progress, title: "可进攻场次 / 已完成进攻场次，按已完成场次排序" },
    { key: "attackTrophies", label: "进攻得杯", className: coreClass.attack },
    { key: "defenseTrophies", label: lost ? "防守扣杯" : "防守得杯", className: coreClass.defense },
    { key: "trophies", label: lost ? "本周净杯" : "最终杯数", className: coreClass.total },
  ];
  const sortColumns = [rankColumn, ...scoreColumns, ...(showDefenseRank ? [defenseRankColumn] : []), ...detailColumns];
  const activeSort = sort.key === "defenseRank" && !showDefenseRank ? initialSort : sort;
  const coreCount = 2 + scoreColumns.length + Number(showDefenseRank);
  const extraCount = detailColumns.length + Number(showMyResult);
  const visibleCount = coreCount + (compact ? 0 : extraCount);
  const sorted = rankedRows.sort((a, b) => compareRows(a, b, activeSort.key, activeSort.ascending) || compareRows(a, b, "rank", true));

  function sortHeader(column) {
    return <SortHeader key={column.key} column={column} sort={activeSort} onSort={setSort} />;
  }

  return (
    <section ref={sectionRef} className={compact ? "standings standings-compact" : "standings"} aria-labelledby="standings-title">
      <header className="report-header">
        <div className="standings-heading">
          <h2 id="standings-title">本周排位排名</h2>
          <LeagueBadge tier={leagueTier} />
        </div>
        <p>{[groupTag && `小组 ${groupTag}`, week && `${week} 周`, rows.length > 0 && "时间为北京时间"].filter(Boolean).join(" · ")}</p>
      </header>
      {compact && rows.length > 0 && <CompactSort columns={sortColumns} sort={activeSort} onSort={setSort} />}
      {rows.length === 0 ? (
        <div className="empty-card">
          {battleViews?.personalOnly ? (
            <div className="standings-legend-entry">
              <p>传奇 I 的名次在全球榜和地区榜中显示，本周战绩可在进攻和防守页查看。</p>
              {onOpenLegend && <button type="button" onClick={onOpenLegend}>查看传奇 I 全球榜</button>}
            </div>
          ) : <p>{isSample ? "示例未包含小组排名。查询村庄后可查看排名。" : "官方 API 本次未返回该小组的成员排名。"}</p>}
        </div>
      ) : (
        <div className="battle-card standings-card">
          <table className="battle-table standings-table">
            <colgroup>
              <col className={`rank-column ${coreClass.rank}`} />
              <col className={`player-column ${coreClass.player}`} />
              {scoreColumns.map((column) => <col key={column.key} className={`stat-column ${column.className}`} />)}
              {showDefenseRank && <col className={`defense-rank-column ${coreClass.defenseRank}`} />}
              {showMyResult && !compact && <col className="standings-extra my-result-column" />}
              {!compact && detailColumns.map((column) => <col key={column.key} className={`standings-extra ${column.widthClass}`} />)}
            </colgroup>
            <thead><tr>
              {sortHeader(rankColumn)}
              <th scope="col" className={coreClass.player}>村庄</th>
              {scoreColumns.map(sortHeader)}
              {showDefenseRank && sortHeader(defenseRankColumn)}
              {showMyResult && !compact && <th scope="col" className="standings-extra" title="本人本周对该玩家的进攻">我打过</th>}
              {!compact && detailColumns.map((column) => sortHeader({ ...column, className: "standings-extra" }))}
            </tr></thead>
            <tbody>{sorted.map((row) => {
              const history = attackHistory.get(row.playerTag) ?? [];
              const open = openPanel?.playerTag === row.playerTag ? openPanel.panel : null;
              const detailsExpanded = compact && open === "details";
              const lineupExpanded = history.length > 0 && open === "lineup";
              const panelId = `${panelPrefix}-${row.playerTag.replace(/^#/, "")}`;
              const name = row.playerName || row.playerTag;
              const lookupName = name === row.playerTag ? name : `${name} ${row.playerTag}`;
              const results = mine?.get(row.playerTag) ?? [];
              const myResult = selected === row.playerTag ? "本人" : results.length ? <MyResult results={results} /> : "—";
              const topHit = showMyResult && results.length > 0 && row.defenseRank !== null && row.defenseRank <= DEFENSE_TOP_N;
              const rowClass = [selected === row.playerTag && "standing-selected", topHit && "defense-top-hit"].filter(Boolean).join(" ");
              const togglePanel = (panel) => setOpenPanel(open === panel ? null : { playerTag: row.playerTag, panel });
              return (
                <Fragment key={row.playerTag}>
                  <tr className={rowClass || undefined} id={`${panelPrefix}-row-${row.playerTag.replace(/^#/, "")}`}>
                    <td className={coreClass.rank}>{scoreText(row.rank)}</td>
                    <th scope="row" className={coreClass.player}>
                      {row.playerTag && onLookupPlayer ? <button type="button" className="standings-player-name battle-opponent-lookup"
                        aria-label={`查看 ${lookupName} 的攻防战报`} title={name}
                        onClick={() => onLookupPlayer(row.playerTag)}>{name}</button>
                        : <span className="standings-player-name" title={name}>{name}</span>}
                      {row.playerName && <small>{row.playerTag}</small>}
                      {(compact || history.length > 0) && <div className="standings-row-actions">
                        {compact && <button type="button" className="standings-detail-toggle" aria-label={`${name} 数据详情`}
                          aria-expanded={detailsExpanded} aria-controls={detailsExpanded ? panelId : undefined}
                          onClick={() => togglePanel("details")}>数据详情</button>}
                        {history.length > 0 && <button type="button" className="lineup-button group-lineup-button" aria-expanded={lineupExpanded}
                          aria-controls={lineupExpanded ? panelId : undefined} onClick={() => togglePanel("lineup")}>
                          <span className="lineup-button-label">{scoreText(history.length)} 场阵容</span>
                        </button>}
                      </div>}
                    </th>
                    <AttackProgress className={coreClass.progress} limit={leagueTier?.attackLimit} completed={row.attackCount} />
                    <td className={coreClass.attack}><Trophy value={row.attackTrophies} /></td>
                    <td className={coreClass.defense}><Trophy value={row.defenseTrophies} loss={lost} /></td>
                    <td className={`total-trophies ${coreClass.total}`}><Trophy value={row.trophies} change={lost} /></td>
                    {showDefenseRank && <td className={coreClass.defenseRank}>{row.defenseRank ? `第 ${row.defenseRank} 名` : "—"}</td>}
                    {showMyResult && !compact && <td className="standings-extra my-result-cell">{myResult}</td>}
                    {!compact && detailColumns.map((column) => <td key={column.key} className="standings-extra">{column.value(row)}</td>)}
                  </tr>
                  {(detailsExpanded || lineupExpanded) && <tr className={detailsExpanded ? "army-expanded-row standings-detail-row" : "army-expanded-row"}><td colSpan={visibleCount} id={panelId}>
                    {detailsExpanded ? <section className="standings-detail-panel" aria-label={`${name} 数据详情`}>
                      <dl className="standings-detail-stats">
                        {showOwnResults && (showDefenseRank || results.length > 0) && <div><dt>我打过</dt><dd>{myResult}</dd></div>}
                        {detailColumns.map((column) => <div key={column.key}><dt>{column.label}</dt><dd>{column.value(row)}</dd></div>)}
                      </dl>
                    </section> : <ArmyHistory history={history} player={row}
                      focusEquipment={focus?.playerTag === row.playerTag ? focus.equipment : null} />}
                  </td></tr>}
                </Fragment>
              );
            })}</tbody>
          </table>
          <p className="battle-note">平均用时只计入已知用时的对战。「最近」是最近一场的对战时间。
            {showDefenseRank && " 防守排名按防守得杯，并列时平均被打星少的靠前。"}
            {showMyResult && `打过防守前 ${DEFENSE_TOP_N} 的行标黄。`}</p>
        </div>
      )}
    </section>
  );
}
