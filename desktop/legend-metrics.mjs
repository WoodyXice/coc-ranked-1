import { legendBoardKey } from "../collector.mjs";
import { freshLegendSnapshot, legendDayNumber } from "../insights.mjs";
import { createLegendMetricsCollector } from "./service.mjs";

const lifetime = 10 * 60_000;
const failureLifetime = 60_000;
const batchLimit = 20;
const concurrentLimit = 4;
const displayInterval = 650;

export function createLegendMetricsService({ readHistory, onCollected, makeCollector = createLegendMetricsCollector, now = Date.now } = {}) {
  let session;

  function reset() {
    const previous = session;
    session = undefined;
    if (!previous) return;
    for (const { playerTag, resolve } of previous.queue.splice(0)) {
      previous.pending.delete(playerTag);
      resolve(null);
    }
  }

  function isListed(state, playerTag) {
    for (const tags of state.boards.values()) {
      if (tags.has(playerTag)) return true;
    }
    return false;
  }

  function setRows(token, rows, location, limit, savedEntries = []) {
    const key = legendBoardKey(location, limit);
    if (session?.token !== token) {
      reset();
      session = { token, collect: makeCollector(token), boards: new Map(), cache: new Map(), pending: new Map(), queue: [], running: 0 };
    }
    const previous = session.boards.get(key);
    const roster = new Set(rows.map(({ playerTag }) => playerTag));
    session.boards.set(key, roster);
    const time = now();
    for (const { playerTag, checkedAt, metrics } of savedEntries) {
      if (!roster.has(playerTag) || !metrics || !Number.isFinite(checkedAt) || !freshLegendSnapshot(checkedAt, time)) continue;
      if (session.cache.get(playerTag)?.checkedAt >= checkedAt) continue;
      session.cache.set(playerTag, { metrics, checkedAt, day: legendDayNumber(checkedAt), expiresAt: checkedAt + lifetime });
    }
    for (const tag of previous ?? []) {
      if (!isListed(session, tag)) session.cache.delete(tag);
    }
  }

  async function run(state, { playerTag, resolve }) {
    const startedDay = legendDayNumber(now());
    let archive;
    let metrics = null;
    try {
      archive = readHistory?.(playerTag);
    } catch {
      // The official log can still provide a current sample.
    }
    try {
      metrics = await state.collect(playerTag, archive);
    } catch {
      // One unavailable battle log must not hide the other players' results.
    }

    const checkedAt = now();
    let entry = null;
    if (state === session && isListed(state, playerTag) && legendDayNumber(checkedAt) === startedDay) {
      entry = { metrics, checkedAt, day: startedDay, expiresAt: checkedAt + (metrics == null ? failureLifetime : lifetime) };
      state.cache.set(playerTag, entry);
      if (metrics && onCollected) {
        try {
          Promise.resolve(onCollected(playerTag, metrics, checkedAt)).catch(() => {});
        } catch {
          // The live result is still usable when the local workbook cannot be updated.
        }
      }
    }
    state.pending.delete(playerTag);
    state.running -= 1;
    resolve(entry);
    if (state === session) drain(state);
  }

  function drain(state) {
    while (state.running < concurrentLimit && state.queue.length > 0) {
      const task = state.queue.shift();
      if (!isListed(state, task.playerTag)) {
        state.pending.delete(task.playerTag);
        task.resolve(null);
        continue;
      }
      state.running += 1;
      void run(state, task);
    }
  }

  function lookup(state, playerTag) {
    const cached = state.cache.get(playerTag);
    const time = now();
    if (cached && cached.expiresAt > time && cached.day === legendDayNumber(time)) return cached;
    const pending = state.pending.get(playerTag);
    if (pending) return pending;
    const task = new Promise((resolve) => { state.queue.push({ playerTag, resolve }); });
    state.pending.set(playerTag, task);
    drain(state);
    return task;
  }

  async function fetchBatch(token, playerTags, location, limit, progressive = false) {
    const state = session;
    if (!state || state.token !== token || !Array.isArray(playerTags)) return { entries: [] };
    const key = legendBoardKey(location, limit);
    const board = state.boards.get(key);
    if (!board) return { entries: [] };
    const tags = [...new Set(playerTags.slice(0, batchLimit))].filter((tag) => board.has(tag));
    const ready = new Map();
    const jobs = tags.map(async (tag) => { ready.set(tag, await lookup(state, tag)); });
    const all = Promise.all(jobs);
    if (progressive && jobs.length > 1) {
      await Promise.race(jobs);
      if (ready.size < jobs.length) {
        // Flush several nearby completions together. The next batch joins remaining jobs
        // through lookup(), freeing new slots without waiting for a slow player.
        let timer;
        await Promise.race([all, new Promise(resolve => { timer = setTimeout(resolve, displayInterval); })]);
        clearTimeout(timer);
      }
    } else {
      await all;
    }
    if (state !== session) return { entries: [] };
    const current = state.boards.get(key);
    const listed = tags.filter(tag => current.has(tag));
    const entries = listed.filter(tag => ready.has(tag)).map(playerTag => {
      const entry = ready.get(playerTag);
      return { playerTag, metrics: entry?.metrics ?? null, ...(progressive && entry && { checkedAt: entry.checkedAt }) };
    });
    return entries.length < listed.length ? { entries, partial: true } : { entries };
  }

  return { setRows, reset, fetchBatch };
}
