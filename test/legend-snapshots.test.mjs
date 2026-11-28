import assert from "node:assert/strict";
import test from "node:test";
import { createLegendSnapshots } from "../desktop/legend-snapshots.mjs";

const epoch = Date.parse("2026-11-28T06:00:00Z");
const board = (tags, limit = 200, location = "global") => ({
  location, requestedLimit: limit, fetchedAt: new Date(epoch).toISOString(), rows: tags.map(playerTag => ({ playerTag })),
});
function fixture() {
  const files = new Map();
  let time = epoch;
  const open = (generation = "same-key") => createLegendSnapshots({
    directory: "fixture", generation, now: () => time,
    read: async path => structuredClone(files.get(path)), write: async (path, value) => files.set(path, structuredClone(value)),
  });
  return { files, open, tick(value) { time += value; } };
}

test("workbook checkpoints survive reopening and keep their real sample time across a scope change", async () => {
  const f = fixture();
  const cache = f.open();
  const first = board(["#AA", "#BB"]);
  cache.capture(first);
  cache.record("#AA", { attackCount: 9 }, epoch);
  cache.record("#BB", null, epoch);
  await cache.flush();
  const reopened = f.open();
  f.tick(601_000);
  assert.deepEqual((await reopened.restore("global")).rows, first.rows);
  assert.deepEqual(reopened.samples(first), [{ playerTag: "#AA", checkedAt: epoch, metrics: { attackCount: 9 } }]);
  const next = board(["#CC", "#AA"], 1000);
  reopened.capture(next);
  reopened.record("#BB", { attackCount: 10 }, epoch);
  reopened.record("#CC", { attackCount: 6 }, epoch + 601_000);
  await reopened.flush();
  assert.equal(f.files.size, 1);
  assert.equal((await f.open().restore("global")).requestedLimit, 1000);
  assert.deepEqual(reopened.samples(next).map(e => e.playerTag), ["#CC", "#AA"]);
  assert.equal(await f.open("replacement-key").restore("global"), null);
  assert.equal(await f.open().restore(1234), null);
  f.tick(86_400_000);
  assert.equal(await f.open().restore("global"), null);
  assert.deepEqual(reopened.samples(next), []);
});

test("a checkpoint written while new results arrive cannot overwrite the final snapshot", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const writes = [];
  const cache = createLegendSnapshots({
    directory: "fixture", generation: "first", now: () => epoch, read: async () => null,
    write: async (_path, saved) => { writes.push(structuredClone(saved)); if (writes.length === 1) await blocked; },
  });
  cache.capture(board(["#AA", "#BB"]));
  const first = cache.flush();
  cache.record("#AA", { attackCount: 1 }, epoch);
  cache.record("#BB", { attackCount: 2 }, epoch);
  const last = cache.flush();
  release();
  await Promise.all([first, last]);
  assert.deepEqual(writes.map(w => w.entries.length), [0, 2]);
  assert.equal(cache.hasWork(), false);
});
