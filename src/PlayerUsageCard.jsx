import { useLayoutEffect, useRef } from "react";
import { styleColors } from "./strategy-search.mjs";

const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });

export default function PlayerUsageCard({ player, pair, emptyReason, onDismiss, onReport }) {
  const dialog = useRef(null);
  useLayoutEffect(() => {
    const panel = dialog.current;
    panel.showModal();
    return () => panel.close();
  }, []);

  const byStyle = new Map(player.uses.map(use => [use.strategy, use]));
  const rows = [...pair.map(name => byStyle.get(name)).filter(Boolean), ...player.uses.filter(use => !pair.includes(use.strategy))];
  return <dialog ref={dialog} className="atlas-usage-card" aria-label="玩家流派战绩"
    onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <header><div><h3>{player.playerName || player.playerTag}</h3>
      <small>#{player.rank} · {player.playerTag}</small></div>
      <button type="button" onClick={onDismiss} aria-label="关闭流派战绩">关闭</button></header>
    <div className="atlas-usage-body">
      <h4>近两个联赛日 · 进攻流派</h4>
      {rows.length ? <table aria-label="各流派的进攻场次和三星率">
        <thead><tr><th scope="col">流派</th><th scope="col">使用场次</th>
          <th scope="col" title="三星场次 / 有星数记录的进攻场次">三星 / 有星数</th><th scope="col">三星率</th></tr></thead>
        <tbody>{rows.map(use => {
          const scored = use.scoredCount > 0 && Number.isInteger(use.threeStarCount);
          return <tr key={use.strategy}>
            <th scope="row"><i style={{ background: styleColors(use.strategy).pointColor }} />{use.strategy}</th>
            <td title={use.count == null ? "旧战报只保留了已知的最低场数" : undefined}>
              {use.count ?? `≥${Math.max(1, use.scoredCount || 0)}`}</td>
            <td>{scored ? `${use.threeStarCount}/${use.scoredCount}` : "—"}</td>
            <td>{scored ? percent.format(use.threeStarCount / use.scoredCount) : "—"}</td>
          </tr>;
        })}</tbody></table> : <p>{emptyReason}</p>}
    </div>
    {onReport && <footer><button type="button" onClick={() => { onDismiss(); onReport(player.playerTag); }}>完整战报</button></footer>}
  </dialog>;
}
