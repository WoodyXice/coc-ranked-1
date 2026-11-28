import { measuredValue, netBands, rateBands, valueBand } from "./network-metrics.mjs";
import { styleColors } from "./strategy-search.mjs";

export const unknownStyle = { key: null, name: "流派待定", color: "#c9d1d4", pointColor: "#768389" };

export function prepareBoard(rows, metrics, strategies, mode) {
  const styleNames = new Set(strategies.map(entry => entry.strategy));
  const bands = mode === "rate" ? rateBands : netBands;
  const players = rows.filter(row => Number.isInteger(row.rank) && row.rank >= 1)
    .map(row => {
      const stats = metrics.get(row.playerTag);
      const uses = (stats?.strategies ?? []).filter(entry => entry.scoredCount > 0);
      const primary = stats?.strategy ?? uses[0]?.strategy ?? null;
      // A recognized army counts as a style even when the battle has no star result.
      if (primary && !uses.some(entry => entry.strategy === primary)) {
        uses.push({ strategy: primary, scoredCount: 0, threeStarCount: 0 });
      }
      for (const entry of uses) styleNames.add(entry.strategy);
      const cluster = mode === "style" ? primary : valueBand(measuredValue(stats, mode), bands)?.id ?? null;
      const tier = [1, 3, 10, 30, 80, Infinity].findIndex(last => row.rank <= last);
      return { ...row, stats, uses, primary, cluster, tier };
    }).sort((a, b) => a.rank - b.rank);
  const styles = [...styleNames];
  const groups = mode === "style"
    ? styles.map(name => ({ key: name, name, ...styleColors(name) }))
    : bands.map(band => ({ key: band.id, name: band.label, color: band.color, pointColor: band.color }));
  const colors = new Map(groups.map(group => [group.key, group.pointColor]));
  let min = Infinity, max = -Infinity;
  for (const player of players) {
    player.pointColor = colors.get(player.cluster) ?? unknownStyle.pointColor;
    const net = measuredValue(player.stats, "net");
    if (net !== null) { min = Math.min(min, net); max = Math.max(max, net); }
  }
  return { players, groups, styles, netExtent: min === Infinity ? [0, 0] : [min, max] };
}
