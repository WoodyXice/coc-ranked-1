import { Fragment, useEffect, useId, useMemo, useState } from "react";
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
  if (typeof first === "string" || typeof second === "string") {
    if (!first) return second ? 1 : 0;
    if (!second) return -1;
    return ascending ? first.localeCompare(second, "zh-CN") : second.localeCompare(first, "zh-CN");
  }
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

function MyResult({ results }) {
  return results.map((result, index) => (
    <span className="my-result" key={index} title={result.timestamp ? formatTime(result.timestamp) : undefined}>
      {Number.isInteger(result.stars) ? `${result.stars}★` : "—"}{Number.isFinite(result.destruction) ? ` ${result.destruction}%` : ""}
    </span>
  ));
}

export default function Standings({ rows, battleViews, groupTag, week, isSample, attacks = emptyAttacks, classifiedAttacks = emptyAttacks, focus = null }) {
  const [sort, setSort] = useState({ key: "rank", ascending: true });
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const panelPrefix = useId();
  const lost = battleViews?.defenseTrophyMode === "lost";
  const selected = battleViews?.playerTag;
  const ranks = useMemo(() => defenseRanks(rows), [rows]);
  const mine = useMemo(() => myAttacksByOpponent(battleViews), [battleViews]);
  const showDefenseRank = !lost && ranks.size > 0;
  const rankedRows = rows.map((row) => ({ ...row, defenseRank: ranks.get(row.playerTag) ?? null }));

  useEffect(() => {
    if (!focus?.playerTag) return;
    setExpandedPlayer(focus.playerTag);
    const frame = requestAnimationFrame(() => {
      document.getElementById(`${panelPrefix}-row-${focus.playerTag.replace(/^#/, "")}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
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
  const columns = [
    { key: "rank", label: "排名", ascendingFirst: true },
    { key: "attackTrophies", label: "进攻得杯" },
    { key: "defenseTrophies", label: lost ? "防守扣杯" : "防守得杯" },
    { key: "trophies", label: lost ? "本周净杯" : "最终杯数" },
    ...(showDefenseRank ? [{ key: "defenseRank", label: "防守排名", ascendingFirst: true,
      title: "按防守得杯排名，并列时平均被打星少的靠前" }] : []),
    { key: "attackCount", label: "进攻场次" },
    { key: "defenseCount", label: "防守场次" },
    { key: "attackStars", label: "进攻总星" },
    { key: "attackDestruction", label: "进攻摧毁率", title: "该玩家进攻时造成的平均摧毁率" },
    { key: "defenseDestruction", label: "平均被摧毁率", title: "该玩家防守时对手造成的平均摧毁率，越低防守表现越好", ascendingFirst: true },
    { key: "attackDurationAverage", label: "平均进攻用时" },
    { key: "defenseDurationAverage", label: "平均防守用时" },
  ];
  const sorted = [...rankedRows].sort((a, b) => compareRows(a, b, sort.key, sort.ascending) || compareRows(a, b, "rank", true));

  function sortHeader(column) {
    return <SortHeader key={column.key} column={column} sort={sort} onSort={setSort} />;
  }

  return (
    <section className="standings" aria-labelledby="standings-title">
      <header className="report-header">
        <h2 id="standings-title">本周排位排名</h2>
        <p>{[groupTag && `小组 ${groupTag}`, week && `${week} 周`, rows.length > 0 && "时间为北京时间"].filter(Boolean).join(" · ")}</p>
      </header>
      {rows.length === 0 ? (
        <div className="empty-card"><p>{battleViews?.personalOnly ? "传奇 I 使用排行榜，这里只提供该村庄本周的个人战绩。"
          : isSample ? "示例未包含小组排名。查询村庄后可查看排名。" : "官方 API 本次未返回该小组的成员排名。"}</p></div>
      ) : (
        <div className="battle-card standings-card">
          <table className="battle-table standings-table">
            <colgroup>
              <col className="rank-column" />
              <col className="player-column" />
              {showDefenseRank ? <>
                <col className="stat-column" span={4} />
                <col className="my-result-column" />
                <col className="stat-column" span={3} />
              </> : <col className="stat-column" span={6} />}
              <col className="destruction-column" span={2} />
              <col className="timing-column" />
              <col className="timing-column" />
            </colgroup>
            <thead><tr>{sortHeader(columns[0])}<th scope="col">村庄</th>{columns.slice(1, showDefenseRank ? 5 : 4).map(sortHeader)}
              {showDefenseRank && <th scope="col" title="本人本周对该玩家的进攻">我打过</th>}
              {columns.slice(showDefenseRank ? 5 : 4).map(sortHeader)}</tr></thead>
            <tbody>{sorted.map((row) => {
              const history = attackHistory.get(row.playerTag) ?? [];
              const expanded = expandedPlayer === row.playerTag && history.length > 0;
              const panelId = `${panelPrefix}-${row.playerTag.replace(/^#/, "")}`;
              const name = row.playerName || row.playerTag;
              const results = mine.get(row.playerTag) ?? [];
              const topHit = results.length > 0 && row.defenseRank !== null && row.defenseRank <= DEFENSE_TOP_N;
              const rowClass = [selected === row.playerTag && "standing-selected", topHit && "defense-top-hit"].filter(Boolean).join(" ");
              return (
                <Fragment key={row.playerTag}>
                  <tr className={rowClass || undefined} id={`${panelPrefix}-row-${row.playerTag.replace(/^#/, "")}`}>
                    <td>{scoreText(row.rank)}</td>
                    <th scope="row">
                      <span className="standings-player-name" title={name}>{name}</span>
                      {row.playerName && <small>{row.playerTag}</small>}
                      {history.length > 0 && <button type="button" className="lineup-button group-lineup-button" aria-expanded={expanded}
                        aria-controls={expanded ? panelId : undefined} onClick={() => setExpandedPlayer(expanded ? null : row.playerTag)}>
                        <span className="lineup-button-label">{scoreText(history.length)} 场阵容</span>
                      </button>}
                    </th>
                    <td><Trophy value={row.attackTrophies} /></td>
                    <td><Trophy value={row.defenseTrophies} loss={lost} /></td>
                    <td className="total-trophies"><Trophy value={row.trophies} change={lost} /></td>
                    {showDefenseRank && <td>{row.defenseRank ? `第 ${row.defenseRank} 名` : "—"}</td>}
                    {showDefenseRank && <td className="my-result-cell">{selected === row.playerTag ? "本人"
                      : results.length ? <MyResult results={results} /> : "—"}</td>}
                    <td>{scoreText(row.attackCount)}</td><td>{scoreText(row.defenseCount)}</td>
                    <td>{scoreText(row.attackStars)}</td>
                    <td>{destructionText(row.attackDestruction)}</td>
                    <td>{destructionText(row.defenseDestruction)}</td>
                    <td><DirectionTiming timestamp={row.lastAttackAt} average={row.attackDurationAverage} count={row.attackDurationCount} /></td>
                    <td><DirectionTiming timestamp={row.lastDefenseAt} average={row.defenseDurationAverage} count={row.defenseDurationCount} /></td>
                  </tr>
                  {expanded && <tr className="army-expanded-row"><td colSpan={columns.length + 1 + Number(showDefenseRank)} id={panelId}>
                    <ArmyHistory history={history} player={row}
                      focusEquipment={focus?.playerTag === row.playerTag ? focus.equipment : null} />
                  </td></tr>}
                </Fragment>
              );
            })}</tbody>
          </table>
          <p className="battle-note">平均用时只计入已知用时的对战。「最近」是最近一场的对战时间。
            {showDefenseRank && ` 防守排名按防守得杯，并列时平均被打星少的靠前；打过防守前 ${DEFENSE_TOP_N} 的行标黄。`}</p>
        </div>
      )}
    </section>
  );
}
