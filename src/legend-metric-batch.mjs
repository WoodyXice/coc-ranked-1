const batchSize = 20;

export function nextLegendMetricBatch(candidates, fresh, history, day) {
  const unseen = new Set();
  const stale = new Set();
  for (const { playerTag } of candidates) {
    if (!playerTag || fresh.has(playerTag)) continue;
    if (history?.get(playerTag)?.day === day) {
      if (stale.size < batchSize) stale.add(playerTag);
    } else {
      unseen.add(playerTag);
      if (unseen.size === batchSize) break;
    }
  }
  return [...unseen, ...stale].slice(0, batchSize);
}
