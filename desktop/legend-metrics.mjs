import { createLegendMetricsCollector } from "./service.mjs";

const lifetime = 10 * 60_000;
const failureLifetime = 60_000;
const batchLimit = 20;
const concurrentLimit = 4;

export function createLegendMetricsService({ readHistory, makeCollector = createLegendMetricsCollector, now = Date.now } = {}) {
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

  function setRows(token, rows) {
    if (session?.token !== token) {
      reset();
      session = { token, collect: makeCollector(token), tags: new Set(), cache: new Map(), pending: new Map(), queue: [], running: 0 };
    }
    session.tags = new Set(rows.map(({ playerTag }) => playerTag));
    for (const tag of session.cache.keys()) {
      if (!session.tags.has(tag)) session.cache.delete(tag);
    }
  }

  async function run(state, { playerTag, resolve }) {
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

    if (state === session && state.tags.has(playerTag)) {
      state.cache.set(playerTag, { metrics, expiresAt: now() + (metrics == null ? failureLifetime : lifetime) });
    }
    state.pending.delete(playerTag);
    state.running -= 1;
    resolve(state === session ? metrics : null);
    if (state === session) drain(state);
  }

  function drain(state) {
    while (state.running < concurrentLimit && state.queue.length > 0) {
      const task = state.queue.shift();
      if (!state.tags.has(task.playerTag)) {
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
    if (cached && cached.expiresAt > now()) return cached.metrics;
    const pending = state.pending.get(playerTag);
    if (pending) return pending;
    const task = new Promise((resolve) => { state.queue.push({ playerTag, resolve }); });
    state.pending.set(playerTag, task);
    drain(state);
    return task;
  }

  async function fetchBatch(token, playerTags) {
    const state = session;
    if (!state || state.token !== token || !Array.isArray(playerTags)) return { entries: [] };
    const tags = [...new Set(playerTags.slice(0, batchLimit))].filter((tag) => state.tags.has(tag));
    const entries = await Promise.all(tags.map(async (playerTag) => ({ playerTag, metrics: await lookup(state, playerTag) })));
    return { entries };
  }

  return { setRows, reset, fetchBatch };
}
