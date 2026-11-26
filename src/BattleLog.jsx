import { useId, useState } from "react";
import ArmyLineup, { ArmyAttribution, hasLineup } from "./ArmyLineup.jsx";
import { compareRows, SortHeader, StandingSummary, Trophy } from "./Standings.jsx";
import { formatDuration, formatTime } from "./battle-time.mjs";
import { DEFENSE_TOP_N, defenseRanks } from "../insights.mjs";

const formatNumber = new Intl.NumberFormat("zh-CN");

function battleTrophy(row, lost) {
  if (Number.isFinite(row.trophyDelta)) return row.trophyDelta;
  if (!Number.isFinite(row.trophies)) return null;
  return lost && row.trophies !== 0 ? -Math.abs(row.trophies) : row.trophies;
}

export default function BattleLog({ kind, battleViews, isSample, accountName, periodLabel = "本周", showStanding = true,
  onLookupPlayer, dailyTrophies, standings }) {
  const headingId = useId();
  const [sort, setSort] = useState({ key: "time", ascending: false });
  const offense = kind === "attacks";
  const mode = battleViews?.defenseTrophyMode;
  const lost = !offense && mode === "lost";
  const trophyLabel = offense ? "进攻得杯" : lost ? "防守扣杯" : mode === "mixed" ? "防守杯数变动" : "防守得杯";
  const label = offense ? "进攻" : "防守";
  const lineupLabel = offense ? "己方阵容" : "对手阵容";
  const rows = battleViews?.[kind] ?? [];
  const ranks = offense && standings?.length && !battleViews?.personalOnly ? defenseRanks(standings, mode) : null;
  const columns = [
    { key: "opponent", label: offense ? "防守方" : "进攻方", ascendingFirst: true },
    { key: "time", label: "对战时间" },
    { key: "duration", label: "用时", ascendingFirst: true },
    { key: "stars", label: "星数" },
    { key: "destruction", label: "摧毁率" },
    { key: "trophy", label: trophyLabel },
    { key: "lineup", label: lineupLabel, ascendingFirst: true, className: "battle-army-cell" },
  ];
  const battleRows = rows.map((row) => {
    const timestamp = row.battleTimestamp || row.timestamp;
    const showArmy = hasLineup(row.army);
    return {
      row, timestamp, showArmy,
      time: Date.parse(timestamp || ""),
      opponent: row.opponentName || row.opponentTag || "",
      duration: row.durationSeconds,
      stars: Number.isInteger(row.stars) && row.stars >= 0 && row.stars <= 3 ? row.stars : null,
      destruction: row.destruction,
      trophy: battleTrophy(row, lost),
      lineup: row.strategy || (showArmy ? "已获取阵容" : ""),
    };
  });
  battleRows.sort((a, b) => compareRows(a, b, sort.key, sort.ascending) || compareRows(a, b, "time", false));
  const knownDestruction = rows.filter((row) => Number.isFinite(row.destruction));
  const threeStars = rows.reduce((count, row) => count + Number(row.stars === 3), 0);
  const knownStars = battleRows.filter((battle) => battle.stars !== null);
  const averageStars = knownStars.length
    ? (knownStars.reduce((sum, battle) => sum + battle.stars, 0) / knownStars.length).toFixed(2)
    : "—";
  const average = knownDestruction.length
    ? (knownDestruction.reduce((sum, row) => sum + row.destruction, 0) / knownDestruction.length).toFixed(1) + "%"
    : "—";
  const partialDurations = rows.some((row) => !Number.isFinite(row.durationSeconds));
  const hasDuration = rows.some((row) => Number.isFinite(row.durationSeconds));

  return (
    <section className="battle-log" aria-labelledby={headingId}>
      <header className="report-header">
        <h2 id={headingId}>{periodLabel}{label}记录</h2>
        {battleViews?.playerTag && <p>{[accountName || battleViews.playerName, battleViews.playerTag, "时间为北京时间"].filter(Boolean).join(" · ")}</p>}
      </header>
      {showStanding && <StandingSummary battleViews={battleViews} standing={battleViews?.standing} showPlayer={false} />}
      {dailyTrophies && <dl className="battle-summary" aria-label="当日杯数">
        <div><dt>当日进攻得杯</dt><dd><Trophy value={dailyTrophies.attack} /></dd></div>
        <div><dt>当日防守扣杯</dt><dd><Trophy value={dailyTrophies.defense} /></dd></div>
        <div><dt>当日净杯</dt><dd><Trophy value={dailyTrophies.net} /></dd></div>
      </dl>}
      {rows.length === 0 ? (
        <div className="empty-card">
          <p>{isSample ? "示例没有这类战绩。查询村庄后可查看个人战绩。" : `官方 API 本次未返回该村庄${periodLabel}的${label}记录。`}</p>
        </div>
      ) : (
        <>
          <dl className="battle-summary battle-log-stats">
            <div><dt>{label}场次</dt><dd>{formatNumber.format(rows.length)}</dd></div>
            <div><dt>{offense ? "三星场次" : "被三星场次"}</dt><dd>{formatNumber.format(threeStars)}</dd></div>
            <div><dt>{offense ? "平均进攻星数" : "平均被打星数"}</dt><dd>{averageStars}</dd></div>
            <div><dt>{offense ? "平均摧毁率" : "对手平均摧毁率"}</dt><dd>{average}</dd></div>
          </dl>
          <div className="battle-card">
            <table className="battle-table personal-battle-table">
              <colgroup>
                <col className="battle-player-column" /><col className="battle-time-column" />
                <col className="battle-duration-column" /><col className="battle-result-column" span={2} />
                <col className="battle-trophy-column" /><col />
              </colgroup>
              <thead><tr>
                {columns.map((column) => <SortHeader key={column.key} column={column} sort={sort} onSort={setSort} />)}
              </tr></thead>
              <tbody>
                {battleRows.map(({ row, timestamp, showArmy, opponent: name, stars, trophy, lineup }, index) => {
                  const opponent = name || "未知玩家";
                  const defenseRank = ranks?.get(row.opponentTag);
                  const topDefense = Number.isInteger(defenseRank) && defenseRank <= DEFENSE_TOP_N;
                  const canLookup = row.opponentTag && typeof onLookupPlayer === "function";
                  return (
                    <tr key={row.id || index} className={topDefense ? "defense-top-hit" : undefined}>
                      <th scope="row">
                        {canLookup ? (
                          <button className="battle-opponent-name battle-opponent-lookup" type="button" title={opponent}
                            aria-label={`查询村庄 ${[row.opponentName, row.opponentTag].filter(Boolean).join(" ")}`}
                            onClick={() => onLookupPlayer(row.opponentTag)}>{opponent}</button>
                        ) : <span className="battle-opponent-name" title={opponent}>{opponent}</span>}
                        {row.opponentTag && row.opponentName && <small>{row.opponentTag}</small>}
                        {defenseRank && <span className="defense-rank-badge" title="按本周小组防守得杯计算">组内防守第 {defenseRank} 名</span>}
                      </th>
                      <td><time dateTime={timestamp || undefined}>{formatTime(timestamp)}</time></td>
                      <td>{formatDuration(row.durationSeconds)}</td>
                      <td>{stars !== null ? (
                        <span className="stars" aria-label={`${stars} 星`}>
                          <span aria-hidden="true">{"★".repeat(stars)}</span><span className="star-empty" aria-hidden="true">{"☆".repeat(3 - stars)}</span>
                        </span>
                      ) : "—"}</td>
                      <td>{Number.isFinite(row.destruction) ? row.destruction + "%" : "—"}</td>
                      <td><Trophy value={trophy} /></td>
                      <td className="battle-army-cell">{showArmy ? (
                        <div className="battle-army">
                          <span className="battle-army-strategy" title={lineup}>{lineup}</span>
                          <ArmyLineup army={row.army} label={lineupLabel} />
                        </div>
                      ) : <span className="missing-lineup">{row.strategy || (row.armyShareCode ? "阵容待解析" : "暂无阵容")}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.some((row) => hasLineup(row.army)) && <ArmyAttribution />}
          {rows.some((row) => row.strategy) && <p className="battle-note">流派根据公开阵容推断，实际打法可能不同。</p>}
          {partialDurations && <p className="battle-note">{hasDuration ? "部分对战的用时未由官方 API 提供。" : "本次战绩没有附单场用时。"}</p>}
        </>
      )}
    </section>
  );
}
