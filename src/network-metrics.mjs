export const rateBands = [
  { id: "r0", label: "低于 50%", color: "#758a9f", min: 0, max: .5 },
  { id: "r50", label: "50%–<75%", color: "#4f8aa4", min: .5, max: .75 },
  { id: "r75", label: "75%–<90%", color: "#338b84", min: .75, max: .90 },
  { id: "r90", label: "90% 及以上", color: "#956a2e", min: .90, max: Infinity },
];

export const netBands = [
  { id: "loss", label: "负净杯", color: "#a46074", min: -Infinity, max: 0 },
  { id: "n0", label: "0 至 <+40", color: "#6b82a7", min: 0, max: 40 },
  { id: "n40", label: "+40 至 <+80", color: "#288780", min: 40, max: 80 },
  { id: "n80", label: "+80 及以上", color: "#a26c32", min: 80, max: Infinity },
];

export function measuredValue(stats, dimension) {
  if (dimension === "rate" && stats?.attackCount > 0 && Number.isFinite(stats.threeStarRate)) return stats.threeStarRate;
  if (dimension === "attack" && stats?.attackDays > 0 && Number.isFinite(stats.averageDailyAttack)) return stats.averageDailyAttack;
  if (dimension === "net" && stats?.completedDays > 0 && Number.isFinite(stats.averageDailyNet)) return stats.averageDailyNet;
  return null;
}

export function valueBand(value, bands) {
  return value === null ? undefined : bands.find(band => value >= band.min && value < band.max);
}

function matchesRate(value, filter) {
  if (!filter) return true;
  if (value === null) return false;
  if (filter === "at75") return value >= .75;
  if (filter === "perfect") return value === 1;
  return valueBand(value, rateBands)?.id === filter;
}

export function matchesNetworkFilters(player, { styles, rate, net, attack, sample, perStyle }) {
  const useStyleRates = perStyle && styles.length > 0 && rate;
  for (const style of styles) {
    const use = player.uses.find(entry => entry.strategy === style);
    if (!use) return false;
    if (useStyleRates) {
      if (!(use.scoredCount > 0) || !Number.isFinite(use.threeStarCount) || (sample && use.scoredCount < sample)) return false;
      if (!matchesRate(use.threeStarCount / use.scoredCount, rate)) return false;
    }
  }
  if (!useStyleRates) {
    if (sample && !(player.stats?.attackCount >= sample)) return false;
    if (!matchesRate(measuredValue(player.stats, "rate"), rate)) return false;
  }
  if (attack) {
    const attackCups = measuredValue(player.stats, "attack");
    if (attackCups === null || attackCups < attack) return false;
  }
  const cups = measuredValue(player.stats, "net");
  if (net === "positive") return cups !== null && cups > 0;
  if (net === "at40") return cups !== null && cups >= 40;
  return !net || valueBand(cups, netBands)?.id === net;
}

export function playerRadius(player, sizeBy, netExtent) {
  if (sizeBy === "rank") return [9, 7.8, 6.6, 5.1, 3.8, 2.9][player.tier];
  const value = sizeBy === "sample" ? player.stats?.attackCount : measuredValue(player.stats, sizeBy);
  if (!Number.isFinite(value)) return 2.6;
  let fraction = value;
  if (sizeBy === "sample") fraction = value / 16;
  if (sizeBy === "net") {
    const [min, max] = netExtent;
    fraction = max > min ? (value - min) / (max - min) : .5;
  }
  return Math.sqrt(9 + 60 * Math.max(0, Math.min(1, fraction)));
}
