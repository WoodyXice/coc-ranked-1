import { useId, useState } from "react";
import BattleLog from "./BattleLog.jsx";
import { BattleDirections } from "./TemporaryPlayer.jsx";
import { attackEquipmentIds } from "../insights.mjs";
import "./temporary-player.css";

const emptyBattles = { attacks: [], defenses: [] };

function initialPlayer(players, focus, selectedTag) {
  const tags = new Set(players.map((row) => row.playerTag));
  return [focus?.playerTag, selectedTag].find((tag) => tag && tags.has(tag)) ?? players[0]?.playerTag ?? "";
}

// Weekly attack and defense records for any member of the ranked group.
export default function GroupPlayer({ standings, groupBattles, battleViews, isSample, onLookupPlayer, focus }) {
  const players = [...standings].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const [playerTag, setPlayerTag] = useState(() => initialPlayer(players, focus, battleViews?.playerTag));
  const [kind, setKind] = useState(focus?.kind ?? "attacks");
  const selectId = useId();
  const logId = useId();

  let empty = "";
  if (battleViews?.personalOnly) empty = "传奇 I 没有排位小组，本人的战绩可在进攻和防守页查看。";
  else if (!players.length) empty = isSample ? "示例未包含小组成员。" : "官方 API 本次未返回该小组的成员排名。";
  else if (!groupBattles) empty = "本周缓存的战报没有组内玩家记录，请重新查询本周排位。";
  if (empty) return <section className="empty-card" aria-label="玩家记录"><p>{empty}</p></section>;

  const standing = players.find((row) => row.playerTag === playerTag) ?? players[0];
  const battles = groupBattles[standing.playerTag] ?? emptyBattles;
  const equipment = focus?.playerTag === standing.playerTag && focus.equipment?.ids?.length ? focus.equipment : null;
  const rowBadge = equipment && kind === "attacks" ? (row) => {
    const gear = attackEquipmentIds(row.army);
    return equipment.ids.every((id) => gear.has(id)) ? `带${equipment.name}` : null;
  } : undefined;
  const views = {
    playerTag: standing.playerTag,
    playerName: standing.playerName || battles.playerName,
    attacks: battles.attacks ?? [],
    defenses: battles.defenses ?? [],
    defenseTrophyMode: battleViews?.defenseTrophyMode,
    standing,
  };

  return (
    <section className="group-player" aria-label="玩家记录">
      <div className="legend-player-day-bar group-player-bar query-card">
        <label htmlFor={selectId}>
          查看玩家
          <select id={selectId} value={standing.playerTag} onChange={(event) => setPlayerTag(event.target.value)}>
            {players.map((row) => (
              <option key={row.playerTag} value={row.playerTag}>
                {[Number.isFinite(row.rank) && `第 ${row.rank} 名`, row.playerName || row.playerTag].filter(Boolean).join(" · ")
                  + (row.playerTag === battleViews?.playerTag ? "（本人）" : "")}
              </option>
            ))}
          </select>
        </label>
        <BattleDirections battles={views} kind={kind} setKind={setKind} logId={logId} />
        <p>记录来自本周小组对战日志，点击对手名字可查看其临时战报。</p>
      </div>
      <div id={logId}>
        <BattleLog key={standing.playerTag + kind} kind={kind} battleViews={views} isSample={isSample}
          standings={standings} onLookupPlayer={onLookupPlayer} rowBadge={rowBadge} />
      </div>
    </section>
  );
}
