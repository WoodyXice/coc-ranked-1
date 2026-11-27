import { legendBoardLocation } from "../collector.mjs";
import { legendDayNumber } from "../insights.mjs";
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

  function isListed(state, playerTag) {
    for (const tags of state.boards.values()) {
      if (tags.has(playerTag)) return true;
    }
    return false;
  }

  function setRows(token, rows, inputLocation) {
    const location = legendBoardLocation(inputLocation);
    if (session?.token !== token) {
      reset();
      session = { token, collect: makeCollector(token), boards: new Map(), cache: new Map(), pending: new Map(), queue: [], running: 0 };
    }
    const previous = session.boards.get(location);
    session.boards.set(location, new Set(rows.map(({ playerTag }) => playerTag)));
    for (const tag of previous ?? []) {
      if (!isListed(session, tag)) session.cache.delete(tag);
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

    if (state === session && isListed(state, playerTag)) {
      const checkedAt = now();
      state.cache.set(playerTag, { metrics, day: legendDayNumber(checkedAt), expiresAt: checkedAt + (metrics == null ? failureLifetime : lifetime) });
    }
    state.pending.delete(playerTag);
    state.running -= 1;
    resolve(state === session ? metrics : null);
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
    if (cached && cached.expiresAt > time && cached.day === legendDayNumber(time)) return cached.metrics;
    const pending = state.pending.get(playerTag);
    if (pending) return pending;
    const task = new Promise((resolve) => { state.queue.push({ playerTag, resolve }); });
    state.pending.set(playerTag, task);
    drain(state);
    return task;
  }

  async function fetchBatch(token, playerTags, inputLocation) {
    const state = session;
    if (!state || state.token !== token || !Array.isArray(playerTags)) return { entries: [] };
    const location = legendBoardLocation(inputLocation);
    const board = state.boards.get(location);
    if (!board) return { entries: [] };
    const tags = [...new Set(playerTags.slice(0, batchLimit))].filter((tag) => board.has(tag));
    const entries = await Promise.all(tags.map(async (playerTag) => ({ playerTag, metrics: await lookup(state, playerTag) })));
    if (state !== session) return { entries: [] };
    const current = state.boards.get(location);
    return { entries: entries.filter(({ playerTag }) => current.has(playerTag)) };
  }

  return { setRows, reset, fetchBatch };
}
