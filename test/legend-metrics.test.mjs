import assert from "node:assert/strict";
import test from "node:test";
import { createLegendMetricsService } from "../desktop/legend-metrics.mjs";

test("legend metrics reuse recent results and scope them to global board players and key", async () => {
  let time = 10_000;
  const calls = [];
  const service = createLegendMetricsService({
    now: () => time,
    readHistory: (tag) => ({ tag }),
    makeCollector: (key) => async (tag, archive) => {
      calls.push([key, tag, archive.tag]);
      return { strategy: "龙流" };
    },
  });
  service.setRows("fixture-1", [{ playerTag: "#MOCK1" }]);
  const first = await service.fetchBatch("fixture-1", ["#MOCK1", "#MOCK1", "#UNLISTED"]);
  assert.deepEqual(first.entries, [{ playerTag: "#MOCK1", metrics: { strategy: "龙流" } }]);
  assert.deepEqual(await service.fetchBatch("other-key", ["#MOCK1"]), { entries: [] });
  time += 600_000 - 1;
  assert.deepEqual(await service.fetchBatch("fixture-1", ["#MOCK1"]), first);
  assert.equal(calls.length, 1);
  time += 1;
  await service.fetchBatch("fixture-1", ["#MOCK1"]);
  assert.deepEqual(calls, [["fixture-1", "#MOCK1", "#MOCK1"], ["fixture-1", "#MOCK1", "#MOCK1"]]);
  service.setRows("fixture-1", [{ playerTag: "#MOCK2" }]);
  assert.deepEqual(await service.fetchBatch("fixture-1", ["#MOCK1"]), { entries: [] });
  service.reset();
  assert.deepEqual(await service.fetchBatch("fixture-1", ["#MOCK2"]), { entries: [] });
});

test("legend metrics batch caps work, coalesces overlapping calls, and handles isolated failures", async () => {
  const tags = Array.from({ length: 22 }, (_, index) => `#MOCK${index}`);
  const calls = [];
  let running = 0;
  let maxRunning = 0;
  const service = createLegendMetricsService({
    makeCollector: () => async (tag) => {
      calls.push(tag);
      running += 1;
      maxRunning = Math.max(running, maxRunning);
      await new Promise(setImmediate);
      running -= 1;
      if (tag === tags[0]) throw new Error("unavailable mock battle log");
      return { strategy: tag };
    },
  });
  service.setRows("fixture", tags.map((playerTag) => ({ playerTag })));
  const [first, overlapping] = await Promise.all([
    service.fetchBatch("fixture", tags), service.fetchBatch("fixture", tags.slice(0, 10)),
  ]);
  assert.equal(first.entries.length, 20);
  assert.deepEqual(overlapping.entries, first.entries.slice(0, 10));
  assert.deepEqual(first.entries[0], { playerTag: tags[0], metrics: null });
  assert.equal(first.entries[1].metrics.strategy, tags[1]);
  assert.equal(calls.length, 20);
  assert.equal(maxRunning, 4);
});
