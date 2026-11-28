import { useId, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import BattleLog from "./BattleLog.jsx";
import EquipmentFilter from "./EquipmentFilter.jsx";
import GroupReport from "./GroupReport.jsx";
import PlayerStrategyStats from "./PlayerStrategyStats.jsx";
import Standings from "./Standings.jsx";

const labels = { meta: "小组流派", standings: "排位排名", equipment: "装备筛选", attacks: "进攻", defenses: "防守" };

export default function VillageReport({ entry, busy, run, onRefresh, onOpenLegend, onLookupPlayer, onManage }) {
  const { payload, name, tag } = entry;
  const { raw, report, fetchedAt } = payload ?? {};
  const battles = raw?.battleViews;
  const personal = !!battles?.personalOnly;
  const [selected, setSelected] = useState(personal ? "attacks" : "meta");
  const [focus, setFocus] = useState(null);
  const chart = useRef(null);
  const id = useId();
  const tabs = personal ? ["attacks", "defenses"] : Object.keys(labels);
  const tab = tabs.includes(selected) ? selected : tabs[0];
  const sample = report?.source === "sample";
  const group = raw?.source === "api" && raw.groupTag && raw.seasonId != null && raw.week && fetchedAt
    ? { reportOwnerTag: tag, groupTag: raw.groupTag, seasonId: raw.seasonId, week: raw.week, fetchedAt } : null;

  async function saveImage() {
    await document.fonts.ready;
    const node = chart.current;
    if (!node) throw new Error("当前没有可保存的流派图。");
    const blob = await toBlob(node, {
      backgroundColor: "#f4f8fa", pixelRatio: 2, skipFonts: true,
      width: node.offsetWidth + 56, height: node.offsetHeight + 56,
      style: { padding: "28px", boxSizing: "border-box" },
      filter: (element) => element.dataset?.noExport !== "true",
    });
    if (!blob) throw new Error("无法生成图片。");
    const filename = "COC-" + (report.groupTag || "report").replace(/[^a-z0-9-]/gi, "") + (report.week ? "-" + report.week : "") + ".png";
    return window.cocApp.saveImage(new Uint8Array(await blob.arrayBuffer()), filename);
  }

  function switchTab(next) {
    setSelected(next);
    setFocus(null);
  }
  function keyboard(event) {
    const index = tabs.indexOf(tab);
    const next = { ArrowRight: tabs[(index + 1) % tabs.length], ArrowLeft: tabs[(index + tabs.length - 1) % tabs.length],
      Home: tabs[0], End: tabs[tabs.length - 1] }[event.key];
    if (!next) return;
    event.preventDefault();
    switchTab(next);
    document.getElementById(id + next)?.focus();
  }
  return <article className="village-report">
    <header className="village-heading"><div>
      <h2>{name || battles?.playerName || tag || "示例村庄"}</h2>
      <div className="village-meta">{tag || battles?.playerTag}{sample ? " · 示例数据" : null}</div>
    </div><div className="export-actions">
      {!sample && onRefresh && <>
        <button type="button" disabled={busy} onClick={() => onLookupPlayer(tag)}>历史与个人流派</button>
        <button type="button" disabled={busy} onClick={onRefresh}>更新本周排位</button>
      </>}
      {report && <button type="button" disabled={busy} onClick={() => run("正在保存 Excel…", () => window.cocApp.downloadWorkbook(raw), "已保存 Excel。")}>导出 Excel</button>}
      {report && tab === "meta" && <button type="button" disabled={busy} onClick={() => run("正在生成图片…", saveImage, "已保存 PNG。")}>保存图片</button>}
    </div></header>
    {!report ? <div className="empty-results empty-card"><div>暂无本周战报</div>
      {!onRefresh && <button type="button" onClick={onManage}>管理村庄与令牌</button>}</div> : <>
      <div className="tabs village-tabs" role="tablist" aria-label="村庄战报">
        {tabs.map((key) => <button key={key} id={id + key} type="button" role="tab" aria-selected={tab === key}
          aria-controls={id + "panel"} tabIndex={tab === key ? 0 : -1} onKeyDown={keyboard} onClick={() => switchTab(key)}>
          {labels[key]}{Array.isArray(battles?.[key]) ? " " + battles[key].length : ""}</button>)}
      </div>
      <div className="village-content" id={id + "panel"} role="tabpanel" aria-labelledby={id + tab}>
        {tab === "meta" && <GroupReport report={report} reportRef={chart} battleViews={battles}/>}
        {tab === "standings" && <Standings rows={raw?.standings ?? []} battleViews={battles}
          attacks={raw?.attacks ?? report.attacks} classifiedAttacks={report.attacks}
          groupTag={report.groupTag} week={report.week} leagueTier={raw?.leagueTier} isSample={sample}
          focus={focus} onOpenLegend={onOpenLegend}
          onLookupPlayer={group ? (playerTag) => onLookupPlayer(playerTag, group) : undefined}/>}
        {tab === "equipment" && <EquipmentFilter attacks={raw?.attacks ?? []} classifiedAttacks={report.attacks}
          standings={raw?.standings ?? []} groupTag={report.groupTag} week={report.week} isSample={sample}
          personalOnly={personal} onOpenPlayer={(playerTag, equipment) => {setFocus({ playerTag, equipment }); setSelected("standings");}}/>}
        {tab === "attacks" && battles?.attacks?.length > 0 && <PlayerStrategyStats
          ranges={[{ key: "week", label: "本周", attacks: battles.attacks }]} />}
        {(tab === "attacks" || tab === "defenses") && <BattleLog key={tab} kind={tab} battleViews={battles}
          isSample={sample} accountName={name} standings={raw?.standings ?? []}
          onLookupPlayer={onRefresh ? onLookupPlayer : undefined}/>}
      </div>
    </>}
  </article>;
}
