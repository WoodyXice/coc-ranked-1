import { useId } from "react";
import ArmyLineup, { ArmyAttribution, hasLineup } from "./ArmyLineup.jsx";
import { StandingSummary, Trophy } from "./Standings.jsx";
import { formatDuration, formatTime } from "./battle-time.mjs";

const formatNumber = new Intl.NumberFormat("zh-CN");

export default function BattleLog({ kind, battleViews, isSample, accountName, periodLabel = "本周", showStanding = true,
  onLookupPlayer, dailyTrophies }) {
  const headingId = useId();
  const offense = kind === "attacks";
  const mode = battleViews?.defenseTrophyMode;
  const lost = !offense && mode === "lost";
  const trophyLabel = offense ? "进攻得杯" : lost ? "防守扣杯" : mode === "mixed" ? "防守杯数变动" : "防守得杯";
  const label = offense ? "进攻" : "防守";
  const lineupLabel = offense ? "己方阵容" : "对手阵容";
  const rows = [...(battleViews?.[kind] ?? [])].sort((a, b) => (b.battleTimestamp || b.timestamp || "").localeCompare(a.battleTimestamp || a.timestamp || ""));
  const knownDestruction = rows.filter((row) => Number.isFinite(row.destruction));
  const threeStars = rows.reduce((count, row) => count + Number(row.stars === 3), 0);
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
          <dl className="battle-summary">
            <div><dt>{label}场次</dt><dd>{formatNumber.format(rows.length)}</dd></div>
            <div><dt>{offense ? "三星场次" : "被三星场次"}</dt><dd>{formatNumber.format(threeStars)}</dd></div>
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
                <th scope="col">{offense ? "防守方" : "进攻方"}</th>
                <th scope="col">对战时间</th><th scope="col">用时</th><th scope="col">星数</th><th scope="col">摧毁率</th>
                <th scope="col">{trophyLabel}</th><th scope="col" className="battle-army-cell">{lineupLabel}</th>
              </tr></thead>
              <tbody>
                {rows.map((row, index) => {
                  const showArmy = hasLineup(row.army);
                  const timestamp = row.battleTimestamp || row.timestamp;
                  const strategy = row.strategy || "已获取阵容";
                  const opponent = row.opponentName || row.opponentTag || "未知玩家";
                  const canLookup = row.opponentTag && typeof onLookupPlayer === "function";
                  return (
                    <tr key={row.id || index}>
                      <th scope="row">
                        {canLookup ? (
                          <button className="battle-opponent-name battle-opponent-lookup" type="button" title={opponent}
                            aria-label={`查询村庄 ${[row.opponentName, row.opponentTag].filter(Boolean).join(" ")}`}
                            onClick={() => onLookupPlayer(row.opponentTag)}>{opponent}</button>
                        ) : <span className="battle-opponent-name" title={opponent}>{opponent}</span>}
                        {row.opponentTag && row.opponentName && <small>{row.opponentTag}</small>}
                      </th>
                      <td><time dateTime={timestamp || undefined}>{formatTime(timestamp)}</time></td>
                      <td>{formatDuration(row.durationSeconds)}</td>
                      <td>{Number.isInteger(row.stars) && row.stars >= 0 && row.stars <= 3 ? (
                        <span className="stars" aria-label={`${row.stars} 星`}>
                          <span aria-hidden="true">{"★".repeat(row.stars)}</span><span className="star-empty" aria-hidden="true">{"☆".repeat(3 - row.stars)}</span>
                        </span>
                      ) : "—"}</td>
                      <td>{Number.isFinite(row.destruction) ? row.destruction + "%" : "—"}</td>
                      <td>{Number.isFinite(row.trophyDelta) ? <Trophy value={row.trophyDelta} /> : <Trophy value={row.trophies} loss={lost} />}</td>
                      <td className="battle-army-cell">{showArmy ? (
                        <div className="battle-army">
                          <span className="battle-army-strategy" title={strategy}>{strategy}</span>
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
