import { Fragment, useId, useMemo, useState } from "react";
import catalog from "./army-icons.json";
import ArmyLineup, { ArmyAttribution } from "./ArmyLineup.jsx";
import {
  MAX_FILTER_HEROES, MAX_GEAR_PER_HERO, armySets, attacksWithEquipment, equipmentByHero, equipmentUsage, playerStats,
} from "../insights.mjs";

const number = new Intl.NumberFormat("zh-CN");
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 0 });

function iconFor(id) {
  const file = catalog.entries[`equipment:${id}`]?.file;
  return typeof file === "string" && /^[A-Za-z0-9_-]+\.(?:webp|png|jpg)$/i.test(file) ? `./army-icons/${file}` : "";
}

function rate(value) {
  return Number.isFinite(value) ? percent.format(value) : "—";
}

export default function EquipmentFilter({ attacks, standings, groupTag, week, isSample, personalOnly, onOpenPlayer }) {
  const usage = useMemo(() => equipmentUsage(attacks, standings), [attacks, standings]);
  const heroes = useMemo(() => equipmentByHero(usage), [usage]);
  const itemById = useMemo(() => new Map(usage.map((item) => [item.id, item])), [usage]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const panelPrefix = useId();

  const selectedItems = selectedIds.map((id) => itemById.get(id)).filter(Boolean);
  const selectedHeroes = new Set(selectedItems.map((item) => item.heroId));
  const matching = useMemo(() => attacksWithEquipment(attacks, selectedIds), [attacks, selectedIds]);
  const players = useMemo(() => playerStats(matching, standings), [matching, standings]);
  const setsByPlayer = useMemo(() => {
    const byPlayer = new Map();
    for (const attack of matching) {
      if (!byPlayer.has(attack.playerTag)) byPlayer.set(attack.playerTag, []);
      byPlayer.get(attack.playerTag).push(attack);
    }
    return new Map([...byPlayer].map(([tag, list]) => [tag, armySets(list)]));
  }, [matching]);
  const label = selectedItems.map((item) => item.name).join(" + ");

  function blockedReason(item) {
    if (selectedIds.includes(item.id)) return "";
    const sameHero = selectedItems.filter((selected) => selected.heroId === item.heroId).length;
    if (sameHero >= MAX_GEAR_PER_HERO) return `每位英雄最多带 ${MAX_GEAR_PER_HERO} 件装备`;
    if (!selectedHeroes.has(item.heroId) && selectedHeroes.size >= MAX_FILTER_HEROES) return `最多选 ${MAX_FILTER_HEROES} 位英雄的装备`;
    return "";
  }

  function toggle(item) {
    if (selectedIds.includes(item.id)) setSelectedIds(selectedIds.filter((id) => id !== item.id));
    else if (!blockedReason(item)) setSelectedIds([...selectedIds, item.id]);
  }

  return (
    <section className="standings" aria-labelledby="equipment-title">
      <header className="report-header">
        <h2 id="equipment-title">本周装备携带</h2>
        <p>{[groupTag && `小组 ${groupTag}`, week && `${week} 周`, "只统计已获取阵容的组内进攻"].filter(Boolean).join(" · ")}</p>
      </header>
      {!usage.length ? (
        <div className="empty-card"><p>{personalOnly ? "传奇 I 没有周排位小组，无法统计组内装备。"
          : isSample ? "示例未包含组内阵容。查询村庄后可按装备筛选。" : "本次没有取得带英雄装备的组内进攻阵容。"}</p></div>
      ) : (
        <>
          <div className="gear-picker battle-card" role="group" aria-label="按英雄选择装备">
            <div className="gear-picker-status">
              <span>已选 {selectedHeroes.size} / {MAX_FILTER_HEROES} 位英雄 · 同一场进攻须同时携带所选装备</span>
              {selectedIds.length > 0 && <button type="button" onClick={() => setSelectedIds([])}>清空</button>}
            </div>
            {heroes.map((hero) => (
              <div className="gear-hero-row" key={hero.heroId ?? "other"}>
                <span className={"gear-hero-name" + (selectedHeroes.has(hero.heroId) ? " gear-hero-active" : "")}>{hero.heroName}</span>
                <div className="gear-chips">
                  {hero.items.map((item) => {
                    const pressed = selectedIds.includes(item.id);
                    const reason = blockedReason(item);
                    const icon = iconFor(item.id);
                    return (
                      <button type="button" key={item.id} className="gear-chip" aria-pressed={pressed}
                        disabled={!!reason} title={reason || `${item.name}：${item.players.length} 人携带`} onClick={() => toggle(item)}>
                        {icon && <img src={icon} alt="" />}
                        <span>{item.name}</span>
                        <small>{number.format(item.players.length)} 人</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {!selectedIds.length ? (
            <div className="empty-card"><p>选择装备后，这里列出本周进攻时同时携带这些装备的玩家。</p></div>
          ) : (
            <div className="battle-card">
              <p className="gear-result-summary">{label}：{number.format(players.length)} 人，共 {number.format(matching.length)} 场</p>
              {players.length === 0 ? <p className="battle-note">本周没有同时携带这些装备的进攻。</p> : (
                <table className="battle-table equipment-table">
                  <thead><tr>
                    <th scope="col">玩家</th>
                    <th scope="col">携带场次</th>
                    <th scope="col" title="同时携带所选装备的进攻中三星的比例">携带时三星率</th>
                    <th scope="col">携带时平均星</th>
                    <th scope="col">携带时平均摧毁率</th>
                    <th scope="col" title="官方统计的本周全部排位进攻胜 / 负，不区分是否携带">本周进攻胜率</th>
                  </tr></thead>
                  <tbody>{players.map((player) => {
                    const name = player.playerName || player.playerTag;
                    const open = () => onOpenPlayer(player.playerTag, { ids: [...selectedIds], name: label });
                    const sets = setsByPlayer.get(player.playerTag) ?? [];
                    const expanded = expandedPlayer === player.playerTag && sets.length > 0;
                    const panelId = `${panelPrefix}-${player.playerTag.replace(/^#/, "")}`;
                    return (
                      <Fragment key={player.playerTag}>
                      <tr>
                        <th scope="row">
                          <button type="button" className="player-link standings-player-name" title="在排位排名中展开该玩家" onClick={open}>{name}</button>
                          {player.playerName && <small>{player.playerTag}</small>}
                          {sets.length > 0 && <button type="button" className="lineup-button group-lineup-button" aria-expanded={expanded}
                            aria-controls={expanded ? panelId : undefined} title="展开使用阵容"
                            onClick={() => { setExpandedPlayer(expanded ? null : player.playerTag); }}>
                            <span className="lineup-button-label">{number.format(sets.length)} 套阵容</span>
                          </button>}
                        </th>
                        <td>{number.format(player.carried)}</td>
                        <td>{rate(player.threeStarRate)}{player.scored > 0 && <small> {player.threeStars}/{player.scored}</small>}</td>
                        <td>{Number.isFinite(player.averageStars) ? player.averageStars.toFixed(2) : "—"}</td>
                        <td>{Number.isFinite(player.averageDestruction) ? player.averageDestruction.toFixed(1) + "%" : "—"}</td>
                        <td>{rate(player.weekWinRate)}{Number.isInteger(player.attackWins) && Number.isInteger(player.attackLosses)
                          && <small> {player.attackWins}胜{player.attackLosses}负</small>}</td>
                      </tr>
                      {expanded && <tr className="army-expanded-row"><td colSpan={6} id={panelId}>
                        <div className="group-army-history">
                          {sets.map((set) => (
                            <div className="army-history-row" key={set.key}>
                              <div className="army-history-label">
                                <strong>{number.format(set.count)} 场</strong>
                                <span>{[
                                  Number.isFinite(set.averageStars) && `平均 ${set.averageStars.toFixed(2)} 星`,
                                  Number.isFinite(set.averageDestruction) && `平均 ${set.averageDestruction.toFixed(1)}%`,
                                  set.threeStars > 0 && `三星 ${set.threeStars} 场`,
                                ].filter(Boolean).join(" · ")}</span>
                              </div>
                              <ArmyLineup army={set.army} label="使用阵容" />
                            </div>
                          ))}
                        </div>
                      </td></tr>}
                      </Fragment>
                    );
                  })}</tbody>
                </table>
              )}
              {players.length > 0 && <ArmyAttribution />}
              <p className="battle-note">点「N 套阵容」展开该玩家用过的阵容：兵种、法术、攻城机器的种类和数量相同就算同一套（与下兵顺序无关），英雄装备取该套最近一场。点击玩家名字可跳到「排位排名」并展开其阵容，符合条件的场次会标出。本周进攻胜率来自官方胜负统计，包含不符合条件的场次。</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
