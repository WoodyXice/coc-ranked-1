import { measuredValue, netBands, rateBands, valueBand } from "./network-metrics.mjs";
import { styleColors } from "./strategy-search.mjs";

export const unknownStyle = { key: null, name: "流派待定", color: "#c9d1d4", pointColor: "#768389" };

function playerUses(stats) {
  const uses = new Map();
  for (const entry of stats?.strategies ?? []) {
    if (!entry.strategy || !(entry.count > 0 || entry.scoredCount > 0)) continue;
    // Older metrics only recorded a total for the primary style.
    const count = entry.count ?? (entry.strategy === stats.strategy ? stats.strategyCount : null);
    uses.set(entry.strategy, { ...entry, count: count ?? null });
  }
  if (stats?.strategy && !uses.has(stats.strategy)) {
    uses.set(stats.strategy, { strategy: stats.strategy, count: stats.strategyCount ?? null,
      scoredCount: null, threeStarCount: null });
  }
  return [...uses.values()];
}

function chooseOverlapPair(players, styles, requested) {
  if (styles.length < 2) return [...styles];
  const left = styles.includes(requested[0]) ? requested[0] : null;
  const right = requested[1] !== left && styles.includes(requested[1]) ? requested[1] : null;
  if (left && right) return [left, right];

  const usage = new Map(styles.map(name => [name, 0]));
  for (const { uses } of players) {
    for (const { strategy } of uses) usage.set(strategy, usage.get(strategy) + 1);
  }
  const ranked = [...styles].sort((a, b) => usage.get(b) - usage.get(a) || a.localeCompare(b, "zh-CN"));
  const indices = new Map(ranked.map((name, index) => [name, index]));
  const fixed = left ?? right;
  const fixedIndex = indices.get(fixed);
  const pairCounts = new Map();
  let bestKey = Infinity, bestCount = 0;
  // Count only combinations people actually used. Each player contributes once per pair.
  for (const { uses } of players) {
    const used = uses.map(use => indices.get(use.strategy)).sort((a, b) => a - b);
    for (let i = 0; i < used.length; i++) {
      for (let j = i + 1; j < used.length; j++) {
        if (fixed && used[i] !== fixedIndex && used[j] !== fixedIndex) continue;
        const key = used[i] * ranked.length + used[j];
        const count = (pairCounts.get(key) ?? 0) + 1;
        pairCounts.set(key, count);
        if (count > bestCount || (count === bestCount && key < bestKey)) {
          bestKey = key;
          bestCount = count;
        }
      }
    }
  }
  const pair = bestCount ? [ranked[Math.floor(bestKey / ranked.length)], ranked[bestKey % ranked.length]] : ranked;
  if (!fixed) return pair.slice(0, 2);
  const partner = pair.find(name => name !== fixed);
  return left ? [left, partner] : [partner, right];
}

export function overlapGroupKey(player, [left, right]) {
  if (!player.uses.length) return null;
  const hasLeft = player.uses.some(use => use.strategy === left);
  const hasRight = player.uses.some(use => use.strategy === right);
  if (hasLeft && hasRight) return "both";
  if (hasLeft) return "left";
  if (hasRight) return "right";
  return "other";
}

export function partitionOverlapPlayers(players, statuses) {
  const compared = [];
  const outside = new Map();
  for (const player of players) {
    if (player.cluster !== "other" && player.cluster !== null) {
      compared.push(player);
      continue;
    }
    let group = "其他流派";
    if (!player.stats) group = statuses?.has(player.playerTag) ? "战报暂缺" : "待取战报";
    else if (!player.uses.length) group = player.stats.strategyStatus === "no-attacks" ? "暂无近期进攻" : "流派未识别";
    if (!outside.has(group)) outside.set(group, []);
    outside.get(group).push(player);
  }
  return { compared, outside };
}

function overlapGroups([left, right]) {
  const groups = [];
  if (left) groups.push({ key: "left", name: left, ...styleColors(left) });
  if (right) {
    const rightColors = styleColors(right);
    const leftColors = groups[0];
    groups.push({ key: "both", name: "共同使用",
      color: `color-mix(in srgb, ${leftColors.color}, ${rightColors.color})`,
      pointColor: `color-mix(in srgb, ${leftColors.pointColor}, ${rightColors.pointColor})` });
    groups.push({ key: "right", name: right, ...rightColors });
  }
  return groups;
}

export function prepareBoard(rows, metrics, strategies, mode, requestedPair = []) {
  const styleNames = new Set(strategies.map(entry => entry.strategy));
  const bands = mode === "rate" ? rateBands : netBands;
  const players = rows.filter(row => Number.isInteger(row.rank) && row.rank >= 1)
    .map(row => {
      const stats = metrics.get(row.playerTag);
      const uses = playerUses(stats);
      const primary = stats?.strategy ?? uses[0]?.strategy ?? null;
      for (const entry of uses) styleNames.add(entry.strategy);
      const tier = [1, 3, 10, 30, 80, Infinity].findIndex(last => row.rank <= last);
      return { ...row, stats, uses, primary, tier };
    }).sort((a, b) => a.rank - b.rank);
  const styles = [...styleNames];
  // A pair chosen for this board remains selectable while a fresh batch loads.
  if (mode === "overlap") {
    for (const name of requestedPair) if (name && !styles.includes(name)) styles.push(name);
  }
  const pair = mode === "overlap" ? chooseOverlapPair(players, styles, requestedPair) : [];
  const groups = mode === "overlap" ? overlapGroups(pair) : mode === "style"
    ? styles.map(name => ({ key: name, name, ...styleColors(name) }))
    : bands.map(band => ({ key: band.id, name: band.label, color: band.color, pointColor: band.color }));
  const colors = new Map(groups.map(group => [group.key, group.pointColor]));
  let min = Infinity, max = -Infinity;
  for (const player of players) {
    if (mode === "overlap") player.cluster = overlapGroupKey(player, pair);
    else if (mode === "style") player.cluster = player.primary;
    else player.cluster = valueBand(measuredValue(player.stats, mode), bands)?.id ?? null;
    player.pointColor = colors.get(player.cluster) ?? unknownStyle.pointColor;
    const net = measuredValue(player.stats, "net");
    if (net !== null) { min = Math.min(min, net); max = Math.max(max, net); }
  }
  return { players, groups, styles, pair, netExtent: min === Infinity ? [0, 0] : [min, max] };
}
