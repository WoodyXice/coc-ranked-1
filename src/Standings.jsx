import { useMemo, useState } from "react";
import { formatDuration, formatShortTime, formatTime } from "./battle-time.mjs";
import { DEFENSE_TOP_N, defenseRanks, myAttacksByOpponent } from "../insights.mjs";

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

function MyResult({ results }) {
  return results.map((result, index) => (
    <span className="my-result" key={index} title={result.timestamp ? formatTime(result.timestamp) : undefined}>
      {Number.isInteger(result.stars) ? `${result.stars}★` : "—"}{Number.isFinite(result.destruction) ? ` ${result.destruction}%` : ""}
    </span>
  ));
}

export default function Standings({ rows, battleViews, groupTag, week, leagueTier, isSample, onOpenLegend, onOpenPlayer }) {
  const [sort, setSort] = useState({ key: "rank", ascending: true });
  const mode = battleViews?.defenseTrophyMode;
  const lost = mode === "lost";
  const selected = battleViews?.playerTag;
  const ranks = useMemo(() => defenseRanks(rows, mode), [rows, mode]);
  const mine = useMemo(() => myAttacksByOpponent(battleViews), [battleViews]);
  const showDefenseRank = !battleViews?.personalOnly && ranks.size > 0;
  const rankedRows = rows.map((row) => ({ ...row, defenseRank: ranks.get(row.playerTag) ?? null }));

  const scoreColumns = [
    { key: "attackCount", label: "进攻进度", title: "可进攻场次 / 已完成进攻场次，按已完成场次排序" },
    { key: "attackTrophies", label: "进攻得杯" },
    { key: "defenseTrophies", label: lost ? "防守扣杯" : "防守得杯" },
    { key: "trophies", label: lost ? "本周净杯" : "最终杯数" },
  ];
  const defenseRankColumn = { key: "defenseRank", label: "防守排名", ascendingFirst: true,
    title: "按防守得杯排名，并列时平均被打星少的靠前" };
  const detailColumns = [
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
              <col className="stat-column" span={scoreColumns.length} />
              {showDefenseRank && <>
                <col className="defense-rank-column" />
                <col className="my-result-column" />
              </>}
              <col className="stat-column" span={2} />
              <col className="destruction-column" span={2} />
              <col className="timing-column" />
              <col className="timing-column" />
            </colgroup>
            <thead><tr>
              {sortHeader({ key: "rank", label: "排名", ascendingFirst: true })}
              <th scope="col">村庄</th>
              {scoreColumns.map(sortHeader)}
              {showDefenseRank && <>
                {sortHeader(defenseRankColumn)}
                <th scope="col" title="本人本周对该玩家的进攻">我打过</th>
              </>}
              {detailColumns.map(sortHeader)}
            </tr></thead>
            <tbody>{sorted.map((row) => {
              const name = row.playerName || row.playerTag;
              const results = mine.get(row.playerTag) ?? [];
              const topHit = showDefenseRank && results.length > 0 && row.defenseRank !== null && row.defenseRank <= DEFENSE_TOP_N;
              const rowClass = [selected === row.playerTag && "standing-selected", topHit && "defense-top-hit"].filter(Boolean).join(" ");
              const canOpen = typeof onOpenPlayer === "function";
              return (
                <tr key={row.playerTag} className={rowClass || undefined}>
                  <td>{scoreText(row.rank)}</td>
                  <th scope="row">
                    {canOpen ? <button type="button" className="battle-opponent-lookup standings-player-name" title={`查看 ${name} 的进攻和防守记录`}
                      onClick={() => onOpenPlayer(row.playerTag, "attacks")}>{name}</button>
                      : <span className="standings-player-name" title={name}>{name}</span>}
                    {row.playerName && <small>{row.playerTag}</small>}
                  </th>
                  <AttackProgress limit={leagueTier?.attackLimit} completed={row.attackCount} />
                  <td><Trophy value={row.attackTrophies} /></td>
                  <td><Trophy value={row.defenseTrophies} loss={lost} /></td>
                  <td className="total-trophies"><Trophy value={row.trophies} change={lost} /></td>
                  {showDefenseRank && <td>{row.defenseRank ? `第 ${row.defenseRank} 名` : "—"}</td>}
                  {showDefenseRank && <td className="my-result-cell">{selected === row.playerTag ? "本人"
                    : results.length ? <MyResult results={results} /> : "—"}</td>}
                  <td>{canOpen && row.defenseCount > 0
                    ? <button type="button" className="battle-opponent-lookup standings-defense-lookup" title={`查看 ${name} 的防守记录`}
                      onClick={() => onOpenPlayer(row.playerTag, "defenses")}>{scoreText(row.defenseCount)}</button>
                    : scoreText(row.defenseCount)}</td>
                  <td>{scoreText(row.attackStars)}</td>
                  <td>{destructionText(row.attackDestruction)}</td>
                  <td>{destructionText(row.defenseDestruction)}</td>
                  <td><DirectionTiming timestamp={row.lastAttackAt} average={row.attackDurationAverage} count={row.attackDurationCount} /></td>
                  <td><DirectionTiming timestamp={row.lastDefenseAt} average={row.defenseDurationAverage} count={row.defenseDurationCount} /></td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="battle-note">点击玩家名字查看其进攻和防守记录与阵容。平均用时只计入已知用时的对战。「最近」是最近一场的对战时间。
            {showDefenseRank && ` 防守排名按防守得杯，并列时平均被打星少的靠前；打过防守前 ${DEFENSE_TOP_N} 的行标黄。`}</p>
        </div>
      )}
    </section>
  );
}
