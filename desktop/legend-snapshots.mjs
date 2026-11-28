import { join } from "node:path";
import { legendBoardLocation } from "../collector.mjs";
import { legendDayNumber } from "../insights.mjs";

// One replaceable workbook per location. Changing the requested depth reuses
// overlapping players without accumulating a file for every typed limit.
export function createLegendSnapshots({ directory, generation, read, write, now = Date.now }) {
  const locations = new Map();
  let timer, writing;

  function locationState(location) {
    const id = legendBoardLocation(location);
    if (!locations.has(id)) {
      locations.set(id, { file: join(directory, id === "global" ? "全球榜.xlsx" : `地区榜-${id}.xlsx`),
        board: null, entries: new Map(), members: new Set(), loaded: false, dirty: false });
    }
    return locations.get(id);
  }
  function today(time) {
    const epoch = now();
    return Number.isFinite(time) && time <= epoch && legendDayNumber(time) === legendDayNumber(epoch);
  }
  function install(state, board, entries) {
    state.board = board;
    state.members = new Set(board.rows.map(p => p.playerTag));
    state.entries = new Map();
    for (const entry of entries) {
      if (state.members.has(entry.playerTag) && entry.metrics && today(entry.checkedAt)) state.entries.set(entry.playerTag, entry);
    }
  }
  async function restore(location) {
    const state = locationState(location);
    if (!state.loaded) {
      state.loading ??= read(state.file).then(saved => {
        if (saved?.board?.cacheGeneration === generation && saved.board.location === legendBoardLocation(location)
            && today(Date.parse(saved.board.fetchedAt))) install(state, saved.board, saved.entries);
      }).catch(() => {}).finally(() => { state.loaded = true; state.loading = null; });
      await state.loading;
    }
    return state.board && today(Date.parse(state.board.fetchedAt)) ? state.board : null;
  }
  function samples(board) {
    const state = locationState(board.location);
    if (!state.board || !today(Date.parse(board.fetchedAt))) return [];
    return board.rows.map(p => state.entries.get(p.playerTag)).filter(entry => entry && today(entry.checkedAt));
  }
  function schedule(delay) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
    timer.unref?.();
  }
  function capture(board) {
    const state = locationState(board.location);
    install(state, board, state.entries.values());
    state.loaded = true;
    state.dirty = true;
    schedule(5000);
  }
  function record(playerTag, metrics, checkedAt) {
    if (!metrics || !today(checkedAt)) return;
    for (const state of locations.values()) {
      if (!state.members.has(playerTag) || !today(Date.parse(state.board.fetchedAt))) continue;
      const first = !state.entries.has(playerTag);
      state.entries.set(playerTag, { playerTag, metrics, checkedAt });
      state.dirty = true;
      if (first && state.entries.size === state.members.size) void flush();
      else schedule(state.members.size > 1000 ? 60_000 : 15_000);
    }
  }
  function hasWork() {
    return !!writing || [...locations.values()].some(state => state.dirty);
  }
  function flush() {
    if (writing) return writing.then(flush);
    clearTimeout(timer);
    timer = null;
    const dirty = [...locations.values()].filter(state => state.dirty);
    if (!dirty.length) return Promise.resolve();
    const owner = generation;
    writing = (async () => {
      for (const state of dirty) {
        if (owner !== generation) break;
        state.dirty = false;
        const snapshot = { board: { ...state.board, cacheGeneration: owner }, entries: [...state.entries.values()] };
        try { await write(state.file, snapshot); }
        catch {
          // Excel can hold the destination open. Keep the previous file and retry on the next checkpoint.
          state.dirty = true;
          console.warn("榜单 Excel 缓存未写入，本次会话仍可查看。");
        }
      }
    })().finally(() => { writing = null; });
    return writing;
  }
  function reset(newGeneration) {
    generation = newGeneration;
    clearTimeout(timer);
    timer = null;
    locations.clear();
  }
  return { restore, samples, capture, record, flush, hasWork, reset };
}
