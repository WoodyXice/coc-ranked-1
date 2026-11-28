import { legendDayNumber } from "../insights.mjs";

const batchSize = 20;
const lifetime = 10 * 60_000;
const retryDelay = 60_000;

export function restoredLegendMetrics(entries, now) {
  const saved = new Map();
  const day = legendDayNumber(now);
  for (const { playerTag, checkedAt, metrics } of entries ?? []) {
    if (!playerTag || !metrics || !Number.isFinite(checkedAt) || checkedAt > now || legendDayNumber(checkedAt) !== day) continue;
    if (saved.get(playerTag)?.checkedAt >= checkedAt) continue;
    saved.set(playerTag, { day, checkedAt, metrics });
  }
  return saved;
}

export function legendMetricView(rows, live, saved, cutoff, refreshKey) {
  const statuses = new Map();
  const settled = new Set();
  const day = legendDayNumber(cutoff);
  let staleCount = 0;
  let staleFailedCount = 0;
  for (const { playerTag } of rows) {
    const recent = live?.get(playerTag);
    const attempt = recent?.day === day ? recent : null;
    const disk = saved.get(playerTag);
    const restored = disk?.day === day && (!attempt?.metrics || disk.checkedAt > attempt.checkedAt);
    const sample = restored ? disk : attempt;
    const metrics = sample?.metrics ?? null;
    const checkedAt = metrics ? sample.checkedAt : null;
    const stale = Boolean(metrics && checkedAt + lifetime <= cutoff);
    const refreshFailed = attempt?.refreshKey === refreshKey && Number.isFinite(attempt?.failedAt)
      && attempt.failedAt >= (checkedAt ?? -Infinity);
    const coolingDown = refreshFailed && attempt.failedAt + retryDelay > cutoff;
    if ((metrics && !stale) || coolingDown) settled.add(playerTag);
    if (metrics || coolingDown) {
      statuses.set(playerTag, { metrics, checkedAt, stale, refreshFailed,
        restoredUntil: restored && !stale ? checkedAt + lifetime : null });
    }
    if (stale) staleCount++;
    if (stale && refreshFailed) staleFailedCount++;
  }
  return { statuses, settled, pendingCount: rows.length - settled.size, staleCount, staleFailedCount };
}

export function applyLegendMetricResults(previous, tags, result, requestDay, refreshKey, receivedAt) {
  if (legendDayNumber(receivedAt) !== requestDay) return previous;
  const entries = new Map(previous);
  for (const [tag, entry] of entries) {
    if (entry.day !== requestDay) entries.delete(tag);
  }
  const byTag = new Map((result?.entries ?? []).map(entry => [entry.playerTag, entry]));
  for (const tag of tags) {
    const value = byTag.get(tag);
    if (!value && result?.partial) continue;
    const checkedAt = value?.checkedAt ?? receivedAt;
    const validTime = Number.isFinite(checkedAt) && checkedAt <= receivedAt && legendDayNumber(checkedAt) === requestDay;
    const prior = entries.get(tag);
    if (validTime && prior?.checkedAt > checkedAt) continue;
    if (value?.metrics && validTime) {
      entries.set(tag, { metrics: value.metrics, checkedAt, day: requestDay });
    } else {
      entries.set(tag, { ...prior, day: requestDay, failedAt: validTime ? checkedAt : receivedAt, refreshKey });
    }
  }
  return entries;
}

export function nextLegendMetricBatch(candidates, fresh, history, day, saved) {
  const unseen = new Set();
  const stale = new Set();
  for (const { playerTag } of candidates) {
    if (!playerTag || fresh.has(playerTag)) continue;
    if (history?.get(playerTag)?.day === day || saved?.get(playerTag)?.day === day) {
      if (stale.size < batchSize) stale.add(playerTag);
    } else {
      unseen.add(playerTag);
      if (unseen.size === batchSize) break;
    }
  }
  return [...unseen, ...stale].slice(0, batchSize);
}
