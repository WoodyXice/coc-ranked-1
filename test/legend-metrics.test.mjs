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

test("each board admits only its own rows and shares overlapping players across boards", async () => {
  const requested = [];
  const service = createLegendMetricsService({
    makeCollector: () => async (playerTag) => {
      requested.push(playerTag);
      await new Promise(setImmediate);
      return { playerTag };
    },
  });
  const rows = (...tags) => tags.map((playerTag) => ({ playerTag }));
  service.setRows("key", rows("#A", "#B"));
  service.setRows("key", rows("#B", "#C"), 42);
  service.setRows("key", rows("#D"), 43);
  const tags = ["#A", "#B", "#C", "#D"];
  const [global, region, other] = await Promise.all([
    service.fetchBatch("key", tags), service.fetchBatch("key", tags, "42"), service.fetchBatch("key", tags, 43),
  ]);
  assert.deepEqual(global.entries.map((entry) => entry.playerTag), ["#A", "#B"]);
  assert.deepEqual(region.entries.map((entry) => entry.playerTag), ["#B", "#C"]);
  assert.deepEqual(other.entries.map((entry) => entry.playerTag), ["#D"]);
  assert.deepEqual(requested.toSorted(), tags);
  service.setRows("key", rows("#A"));
  assert.deepEqual(await service.fetchBatch("key", ["#B"]), { entries: [] });
  assert.deepEqual(await service.fetchBatch("key", tags, 42), region);
  assert.deepEqual(await service.fetchBatch("key", tags, 44), { entries: [] });
  assert.equal(requested.length, 4);
});

test("results from an obsolete roster or credential do not escape an in-flight batch", async () => {
  let finish;
  const service = createLegendMetricsService({
    makeCollector: () => () => new Promise((resolve) => { finish = resolve; }),
  });
  const roster = [{ playerTag: "#COMMON" }];
  const tags = ["#COMMON"];
  service.setRows("first", roster);
  service.setRows("first", roster, 42);
  const global = service.fetchBatch("first", tags);
  const regional = service.fetchBatch("first", tags, 42);
  service.setRows("first", [], 42);
  finish({ strategy: "龙流" });
  assert.deepEqual((await global).entries, [{ playerTag: "#COMMON", metrics: { strategy: "龙流" } }]);
  assert.deepEqual(await regional, { entries: [] });

  service.setRows("second", roster, 42);
  assert.deepEqual(await service.fetchBatch("second", tags), { entries: [] });
  const pending = service.fetchBatch("second", tags, 42);
  service.setRows("third", roster);
  finish({ strategy: "龙流" });
  assert.deepEqual(await pending, { entries: [] });
});

test("a new league day invalidates two-day metrics within the cache lifetime", async () => {
  let time = Date.parse("2026-11-27T04:59:59Z");
  let calls = 0;
  const service = createLegendMetricsService({
    now: () => time,
    makeCollector: () => async () => ({ sample: ++calls }),
  });
  service.setRows("key", [{ playerTag: "#A" }], 42);
  const fetch = async () => (await service.fetchBatch("key", ["#A"], 42)).entries[0].metrics;
  assert.deepEqual(await fetch(), { sample: 1 });
  time += 1000;
  assert.deepEqual(await fetch(), { sample: 2 });
});
