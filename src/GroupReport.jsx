import { useEffect, useId, useRef, useState } from "react";
import { StandingSummary } from "./Standings.jsx";

const TAU = Math.PI * 2;
const CHART_SIZE = 400;
const formatNumber = new Intl.NumberFormat("zh-CN");
const formatShare = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function Pie({ rows, active, onActive }) {
  const canvas = useRef(null);
  const angle = useRef([]);

  useEffect(() => {
    const element = canvas.current;
    const density = Math.max(1, window.devicePixelRatio || 1);
    element.width = CHART_SIZE * density;
    element.height = CHART_SIZE * density;
    const context = element.getContext("2d");
    context.scale(density, density);
    const center = CHART_SIZE / 2;
    const radius = center - 1.5;
    const labels = [];
    let start = -Math.PI / 2;

    angle.current = rows.map((row, index) => {
      const end = start + row.share * TAU;
      if (row.share <= 0) return end;
      context.beginPath();
      context.moveTo(center, center);
      context.arc(center, center, radius, start, end);
      context.closePath();
      context.globalAlpha = active === null || active === index ? 1 : 0.55;
      context.fillStyle = row.color;
      context.fill();
      context.globalAlpha = 1;
      context.lineWidth = 3;
      context.strokeStyle = "#fff";
      if (row.share < 1) context.stroke();
      const middle = (start + end) / 2;
      if (row.share >= 0.05) labels.push({ middle, share: row.share });
      start = end;
      return end;
    });

    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 18px Arial, sans-serif";
    for (const { middle, share } of labels) {
      const text = Math.round(share * 100) + "%";
      const x = center + Math.cos(middle) * 132;
      const y = center + Math.sin(middle) * 132;
      context.lineWidth = 3;
      context.strokeStyle = "#253347";
      context.strokeText(text, x, y);
      context.fillText(text, x, y);
    }
  }, [rows, active]);

  function move(event) {
    const rect = canvas.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    if (Math.hypot(x, y) > 0.5 || !rows.length) {
      onActive(null);
      return;
    }
    const fromTop = (Math.atan2(y, x) + Math.PI / 2 + TAU) % TAU - Math.PI / 2;
    const index = angle.current.findIndex((end) => fromTop < end);
    onActive(index < 0 ? null : index);
  }

  return (
    <canvas
      className="pie"
      ref={canvas}
      role="img"
      aria-label="流派占比饼图，详细比例见旁边的表格"
      onPointerMove={move}
      onPointerLeave={() => onActive(null)}
    />
  );
}

function detailText(row) {
  if (row.name === "蓝胖") {
    return row.details.map(({ name, count }) => name.replace(/蓝胖$/, "") + " " + count).join(" ・ ");
  }
  if (row.name === "其他") {
    const listed = row.details.filter(({ name }) => name !== "其他");
    return listed.length ? "含" + listed.map(({ name, count }) => name + " " + count).join("、") : "";
  }
  return row.details.map(({ name, count }) => name + " " + count).join("、");
}

function ThreeStarChart({ rows, active, onActive }) {
  return (
    <div className="three-star-chart" aria-label="各流派三星率">
      {rows.map((row, index) => {
        if (!Number.isFinite(row.threeStarRate)) return null;
        return (
          <div className={active === index ? "active-rate" : undefined} key={row.name}
            onPointerEnter={() => onActive(index)} onPointerLeave={() => onActive(null)}>
            <span>{row.name}</span><strong>{formatShare.format(row.threeStarRate)}</strong>
            <div className="rate-track" aria-hidden="true">
              <div style={{ width: `${Math.min(1, Math.max(0, row.threeStarRate)) * 100}%`, background: row.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function GroupReport({ report, reportRef, battleViews }) {
  const titleId = useId();
  const [active, setActive] = useState(null);
  const [metric, setMetric] = useState("usage");
  const personalOnly = battleViews?.personalOnly;
  const { groupTag, week, rows, total, notes, telemetry, source } = report;
  const hasRate = source === "api" && rows.some((row) => Number.isFinite(row.threeStarRate));
  const showRate = hasRate && metric === "rate";
  const displayRows = showRate
    ? [...rows].sort((left, right) => (right.threeStarRate ?? -1) - (left.threeStarRate ?? -1))
    : rows;
  const title = showRate ? "流派三星率" : "流派占比";
  const scope = source === "api" && telemetry?.expectedAttacks !== undefined
    ? "已获取阵容 " + formatNumber.format(total) + " / 组内已知进攻 "
      + formatNumber.format(telemetry.expectedAttacks) + " 场" : "";
  const recovered = telemetry?.recoveredFromDefense || 0;
  const failed = (telemetry?.groupLogFailures || 0) + (telemetry?.battleLogFailures || 0);

  return (
    <article ref={reportRef} className="report" aria-labelledby={titleId}>
      <header className="report-header">
        <div className="report-heading-row">
          <h2 id={titleId}>{groupTag ? "小组 " + groupTag + " " : ""}{week ? "本周" : ""}{title}</h2>
          {hasRate && <div className="metric-control" data-no-export="true" role="group" aria-label="统计指标">
            <button type="button" aria-pressed={!showRate} onClick={() => { setMetric("usage"); setActive(null); }}>使用率</button>
            <button type="button" aria-pressed={showRate} onClick={() => { setMetric("rate"); setActive(null); }}>三星率</button>
          </div>}
        </div>
        {!personalOnly && <p>
          {[
            week && week + " 周",
            "有阵容排位进攻 " + formatNumber.format(total) + " 场",
            rows.some(({ name }) => name === "蓝胖") && "天女 / 隐龙 / 其他蓝胖合并为「蓝胖」",
          ].filter(Boolean).join(" ・ ")}
        </p>}
      </header>
      <StandingSummary battleViews={battleViews} standing={battleViews?.standing} />
      <section className={rows.length ? "report-card" : "report-card empty-card"} aria-label="本周流派统计">
        {rows.length ? (
          <>
            {showRate ? <ThreeStarChart rows={displayRows} active={active} onActive={setActive} />
              : <div className="pie-cell"><Pie rows={displayRows} active={active} onActive={setActive} /></div>}
            <table className="report-table">
              <thead><tr><th scope="col">流派</th><th scope="col">{showRate ? "三星 / 有星数" : "场数"}</th><th scope="col" aria-sort="descending">{showRate ? "三星率" : "占比"} <span className="sort-indicator" aria-hidden="true">↓</span></th></tr></thead>
              <tbody>
                {displayRows.map((row, index) => {
                  const detail = detailText(row);
                  return (
                    <tr key={row.name} className={active === index ? "active-row" : ""}
                      onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)}>
                      <th scope="row">
                        <span className="row-name"><span className="color-key" style={{ background: row.color }} />{row.name}</span>
                        {detail && <small>{detail}</small>}
                      </th>
                      <td>{showRate ? (row.scoredCount > 0 ? `${formatNumber.format(row.threeStarCount)} / ${formatNumber.format(row.scoredCount)}` : "—") : formatNumber.format(row.count)}</td>
                      <td>{showRate ? (Number.isFinite(row.threeStarRate) ? formatShare.format(row.threeStarRate) : "—") : formatShare.format(row.share)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : <p>{personalOnly ? "传奇 I 无周排位小组。" : "本次没有取得带阵容的排位进攻记录。"}</p>}
      </section>
      {!!(notes.length || scope) && (
        <div className="report-notes">
          {showRate && <p>三星率以本次获取到星数的场次为分母。</p>}
          {notes.length > 0 && <p>{notes.join(" ")}</p>}
          {scope && <p>{scope}{recovered > 0 && "，其中 " + formatNumber.format(recovered) + " 场由防守日志补齐"}。</p>}
          {failed > 0 && <p>{failed} 个日志请求失败。再次抓取可补充记录。</p>}
        </div>
      )}
    </article>
  );
}
