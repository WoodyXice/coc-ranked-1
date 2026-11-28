import { Fragment, useId, useState } from "react";
import { playerStrategySamples, playerStrategyStats } from "../insights.mjs";
import ArmyLineup, { hasLineup } from "./ArmyLineup.jsx";
import { formatDuration, formatShortTime } from "./battle-time.mjs";
import "./player-strategy-stats.css";

const number = new Intl.NumberFormat("zh-CN");
const percent = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function AttackSample({ label, battle }) {
  const time = battle?.battleTimestamp || battle?.timestamp;
  return <section className="strategy-sample">
    <h4>{label}</h4>
    {battle ? <>
      <p>{[
        `${battle.stars} 星`,
        Number.isFinite(battle.destruction) && battle.destruction >= 0 && battle.destruction <= 100 && `${battle.destruction}%`,
        `用时 ${formatDuration(battle.durationSeconds)}`,
        time && formatShortTime(time),
      ].filter(Boolean).join(" · ")}</p>
      {hasLineup(battle.army) ? <ArmyLineup army={battle.army} label={label + "阵容"} />
        : <span className="missing-lineup">暂无阵容</span>}
    </> : <p>暂无</p>}
  </section>;
}

export default function PlayerStrategyStats({ ranges = [] }) {
  const headingId = useId();
  const comparisonId = useId();
  const [rangeKey, setRangeKey] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const range = ranges.find(({ key }) => key === rangeKey) ?? ranges[0];
  if (!range) return null;

  const rows = playerStrategyStats(range.attacks);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const unknown = rows.find((row) => row.strategy === null)?.count ?? 0;
  const samples = expanded && playerStrategySamples(range.attacks, expanded);

  return (
    <section className="player-strategy-stats query-card" aria-labelledby={headingId}>
      <header className="player-strategy-heading">
        <h3 id={headingId}>进攻流派统计</h3>
        {ranges.length > 1 && <label>
          统计范围
          <select value={range.key} onChange={(event) => { setRangeKey(event.target.value); setExpanded(null); }}>
            {ranges.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>}
      </header>
      <p className="player-strategy-coverage" role="status">
        {ranges.length === 1 && range.label && `${range.label} · `}
        {total > 0 ? `已查到 ${number.format(total)} 场进攻，${number.format(total - unknown)} 场已识别流派。`
          : "该范围暂无已收录的进攻。"}
      </p>
      {rows.length > 0 && <>
        <table className="battle-table player-strategy-table">
          <colgroup><col /><col className="player-strategy-count" /><col className="player-strategy-metric" span={2} /></colgroup>
          <thead><tr>
            <th scope="col">流派</th>
            <th scope="col">场次</th>
            <th scope="col">平均摧毁率</th>
            <th scope="col">三星率</th>
          </tr></thead>
          <tbody>{rows.map((row) => (
            <Fragment key={row.strategy ?? "未识别流派"}><tr>
              <th scope="row">{row.strategy && row.scoredCount > 0 ? <button type="button" className="strategy-disclosure" aria-expanded={expanded === row.strategy}
                aria-controls={expanded === row.strategy ? comparisonId : undefined} aria-label={`${row.strategy}配兵对照`}
                onClick={() => setExpanded(expanded === row.strategy ? null : row.strategy)}>
                {row.strategy}<span aria-hidden="true">{expanded === row.strategy ? "▴" : "▾"}</span>
              </button> : row.strategy || "未识别流派"}</th>
              <td>{number.format(row.count)}</td>
              <td>
                {Number.isFinite(row.averageDestruction) ? `${row.averageDestruction.toFixed(1)}%` : "—"}
                {row.destructionCount > 0 && <small>{number.format(row.destructionCount)} 场</small>}
              </td>
              <td>
                {Number.isFinite(row.threeStarRate) ? percent.format(row.threeStarRate) : "—"}
                {row.scoredCount > 0 && <small>{number.format(row.threeStarCount)}/{number.format(row.scoredCount)}</small>}
              </td>
            </tr>
            {samples && expanded === row.strategy && <tr className="strategy-sample-row">
              <td colSpan={4}><div id={comparisonId} className="strategy-comparison">
                <AttackSample label="最近三星进攻" battle={samples.triple} />
                <AttackSample label="最佳未三星进攻" battle={samples.near} />
              </div></td>
            </tr>}
            </Fragment>
          ))}</tbody>
        </table>
        <p className="player-strategy-note">平均摧毁率按有摧毁率的场次计算。三星率按有星数的场次计算。</p>
      </>}
    </section>
  );
}
