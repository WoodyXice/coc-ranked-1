import { Fragment, useId, useMemo, useState } from "react";
import ArmyLineup, { ArmyAttribution, hasLineup } from "./ArmyLineup.jsx";
import { formatDuration, formatShortTime, formatTime } from "./battle-time.mjs";

const number = new Intl.NumberFormat("zh-CN");
const signed = new Intl.NumberFormat("zh-CN", { signDisplay: "exceptZero" });

export function scoreText(value) {
  return Number.isFinite(value) ? number.format(value) : "—";
}

function destructionText(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

function AttackProgress({ limit, completed }) {
  const knownLimit = Number.isSafeInteger(limit) && limit >= 0;
  const knownCompleted = Number.isSafeInteger(completed) && completed >= 0;
  const allowed = knownLimit ? scoreText(limit) : "—";
  const played = knownCompleted ? scoreText(completed) : "—";
  const meaning = [
    knownLimit ? `可进攻 ${allowed} 场` : "可进攻场次未知",
    knownCompleted ? `已完成 ${played} 场` : "已完成场次未知",
  ].join("，");
  return <td title={meaning} aria-label={meaning}>{knownLimit || knownCompleted ? `${allowed}/${played}` : "—"}</td>;
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

function compareRows(a, b, key, ascending) {
  const first = a[key];
  const second = b[key];
  if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : 0;
  if (!Number.isFinite(second)) return -1;
  return ascending ? first - second : second - first;
}

function DirectionTiming({ timestamp, average, count }) {
  return <>
    <span title={count > 0 ? `按有用时的 ${scoreText(count)} 场计算` : undefined}>{formatDuration(average)}</span>
    {timestamp && <small>最近 <time dateTime={timestamp} title={formatTime(timestamp)}>{formatShortTime(timestamp)}</time></small>}
  </>;
}

function ArmyHistory({ history, player }) {
  return (
    <div className="group-army-history">
      <h3>{player.playerName || player.playerTag} 已获取的进攻阵容</h3>
      {history.map((battle, index) => {
        const timestamp = battle.battleTimestamp || battle.timestamp;
        const strategy = battle.strategy || "已获取阵容";
        const facts = [
          Number.isFinite(battle.durationSeconds) && `用时 ${formatDuration(battle.durationSeconds)}`,
          Number.isInteger(battle.stars) && `${battle.stars} 星`,
          Number.isFinite(battle.destruction) && `${battle.destruction}%`,
        ].filter(Boolean);
        return (
          <div className="army-history-row" key={battle.id || index}>
            <div className="army-history-label">
              <strong title={strategy}>{strategy}</strong>
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

export default function Standings({ rows, battleViews, groupTag, week, leagueTier, isSample, attacks = emptyAttacks, classifiedAttacks = emptyAttacks, onOpenLegend }) {
  const [sort, setSort] = useState({ key: "rank", ascending: true });
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const panelPrefix = useId();
  const lost = battleViews?.defenseTrophyMode === "lost";
  const selected = battleViews?.playerTag;
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
    { key: "attackCount", label: "进攻进度", title: "可进攻场次 / 已完成进攻场次，按已完成场次排序" },
    { key: "attackTrophies", label: "进攻得杯" },
    { key: "defenseTrophies", label: lost ? "防守扣杯" : "防守得杯" },
    { key: "trophies", label: lost ? "本周净杯" : "最终杯数" },
    { key: "defenseCount", label: "防守场次" },
    { key: "attackStars", label: "进攻总星" },
    { key: "attackDestruction", label: "进攻摧毁率", title: "该玩家进攻时造成的平均摧毁率" },
    { key: "defenseDestruction", label: "平均被摧毁率", title: "该玩家防守时对手造成的平均摧毁率，越低防守表现越好", ascendingFirst: true },
    { key: "attackDurationAverage", label: "平均进攻用时" },
    { key: "defenseDurationAverage", label: "平均防守用时" },
  ];
  const sorted = [...rows].sort((a, b) => compareRows(a, b, sort.key, sort.ascending) || compareRows(a, b, "rank", true));

  function sortHeader({ key, label, title, ascendingFirst = false }) {
    const active = sort.key === key;
    return (
      <th key={key} scope="col" aria-sort={active ? sort.ascending ? "ascending" : "descending" : undefined}>
        <button type="button" className="sort-button" title={title}
          onClick={() => setSort({ key, ascending: active ? !sort.ascending : ascendingFirst })}>
          {label}{active && <span className="sort-indicator" aria-hidden="true">{sort.ascending ? "↑" : "↓"}</span>}
        </button>
      </th>
    );
  }

  return (
    <section className="standings" aria-labelledby="standings-title">
      <header className="report-header">
        <div className="standings-heading">
          <h2 id="standings-title">本周排位排名</h2>
          <LeagueBadge tier={leagueTier} />
        </div>
        <p>{[groupTag && `小组 ${groupTag}`, week && `${week} 周`, rows.length > 0 && "时间为北京时间"].filter(Boolean).join(" · ")}</p>
      </header>
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
              <col className="rank-column" />
              <col className="player-column" />
              <col className="stat-column" span={6} />
              <col className="destruction-column" span={2} />
              <col className="timing-column" />
              <col className="timing-column" />
            </colgroup>
            <thead><tr>{sortHeader(columns[0])}<th scope="col">村庄</th>{columns.slice(1).map(sortHeader)}</tr></thead>
            <tbody>{sorted.map((row) => {
              const history = attackHistory.get(row.playerTag) ?? [];
              const expanded = expandedPlayer === row.playerTag && history.length > 0;
              const panelId = `${panelPrefix}-${row.playerTag.replace(/^#/, "")}`;
              const name = row.playerName || row.playerTag;
              return (
                <Fragment key={row.playerTag}>
                  <tr className={selected === row.playerTag ? "standing-selected" : undefined}>
                    <td>{scoreText(row.rank)}</td>
                    <th scope="row">
                      <span className="standings-player-name" title={name}>{name}</span>
                      {row.playerName && <small>{row.playerTag}</small>}
                      {history.length > 0 && <button type="button" className="lineup-button group-lineup-button" aria-expanded={expanded}
                        aria-controls={expanded ? panelId : undefined} onClick={() => setExpandedPlayer(expanded ? null : row.playerTag)}>
                        <span className="lineup-button-label">{scoreText(history.length)} 场阵容</span>
                      </button>}
                    </th>
                    <AttackProgress limit={leagueTier?.attackLimit} completed={row.attackCount} />
                    <td><Trophy value={row.attackTrophies} /></td>
                    <td><Trophy value={row.defenseTrophies} loss={lost} /></td>
                    <td className="total-trophies"><Trophy value={row.trophies} change={lost} /></td>
                    <td>{scoreText(row.defenseCount)}</td>
                    <td>{scoreText(row.attackStars)}</td>
                    <td>{destructionText(row.attackDestruction)}</td>
                    <td>{destructionText(row.defenseDestruction)}</td>
                    <td><DirectionTiming timestamp={row.lastAttackAt} average={row.attackDurationAverage} count={row.attackDurationCount} /></td>
                    <td><DirectionTiming timestamp={row.lastDefenseAt} average={row.defenseDurationAverage} count={row.defenseDurationCount} /></td>
                  </tr>
                  {expanded && <tr className="army-expanded-row"><td colSpan={columns.length + 1} id={panelId}>
                    <ArmyHistory history={history} player={row} />
                  </td></tr>}
                </Fragment>
              );
            })}</tbody>
          </table>
          <p className="battle-note">平均用时只计入已知用时的对战。「最近」是最近一场的对战时间。</p>
        </div>
      )}
    </section>
  );
}
