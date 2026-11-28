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

test("progressive batches publish completed players and refill the queue past a slow log", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tags = Array.from({ length: 24 }, (_, i) => `#MOCK${i}`);
  const slow = Promise.withResolvers();
  const calls = [];
  const service = createLegendMetricsService({
    makeCollector: () => async tag => {
      calls.push(tag);
      if (tag === tags[0]) return slow.promise;
      if (tag === tags[1]) throw new Error("fixture missing");
      return { tag };
    },
  });
  service.setRows("key", tags.map(playerTag => ({ playerTag })));
  const fetch = batch => service.fetchBatch("key", batch, "global", 200, true);
  async function flush() {
    await new Promise(setImmediate);
    t.mock.timers.tick(1000);
  }
  const first = fetch(tags);
  await flush();
  const partial = await first;
  assert.equal(partial.partial, true);
  assert.deepEqual(partial.entries.map(entry => entry.playerTag), tags.slice(1, 20));
  assert.equal(partial.entries[0].metrics, null);
  const next = fetch([tags[0], ...tags.slice(20)]);
  await flush();
  assert.deepEqual((await next).entries.map(entry => entry.playerTag), tags.slice(20));
  slow.resolve({ tag: tags[0] });
  const finished = (await fetch([tags[0]])).entries[0];
  assert.deepEqual(finished.metrics, { tag: tags[0] });
  assert.ok(Number.isFinite(finished.checkedAt));
  const warm = await fetch(tags.slice(0, 20));
  assert.equal(warm.partial, undefined);
  assert.equal(warm.entries.length, 20);
  assert.deepEqual(calls, tags);
});

test("Excel samples warm only current roster members and preserve their original ten-minute deadline", async () => {
  let time = Date.parse("2026-11-27T05:07:00Z");
  const captured = time - 6 * 60_000;
  const written = [];
  const service = createLegendMetricsService({ now: () => time,
    makeCollector: () => async tag => tag === "#FAILED" ? null : { sample: "new" },
    onCollected: (...args) => { written.push(args); },
  });
  const tags = ["#FRESH", "#YESTERDAY", "#FAILED", "#FUTURE"];
  const entries = [
    { playerTag: "#FRESH", checkedAt: captured, metrics: { sample: "disk" } },
    { playerTag: "#OTHER", checkedAt: captured, metrics: { sample: "another board" } },
    { playerTag: "#YESTERDAY", checkedAt: time - 8 * 60_000, metrics: { sample: "previous day" } },
    { playerTag: "#FUTURE", checkedAt: time + 1, metrics: { sample: "future" } },
  ];
  const setRows = () => service.setRows("test", tags.map(playerTag => ({ playerTag })), "global", 200, entries);
  const get = async tags => (await service.fetchBatch("test", tags, "global", 200, true)).entries;
  setRows();
  assert.deepEqual(await get(["#FRESH", "#OTHER"]), [entries[0]]);
  assert.deepEqual(written, []);
  const collected = await get(tags.slice(1));
  assert.deepEqual(collected.map(entry => entry.metrics?.sample ?? null), ["new", null, "new"]);
  assert.deepEqual(written.map(entry => entry[0]), ["#YESTERDAY", "#FUTURE"]);
  time = captured + 600_000;
  setRows();
  const [refreshed] = await get(["#FRESH"]);
  assert.deepEqual(refreshed, { playerTag: "#FRESH", metrics: { sample: "new" }, checkedAt: time });
  assert.deepEqual(written.at(-1), ["#FRESH", refreshed.metrics, time]);
  setRows();
  assert.deepEqual(await get(["#FRESH"]), [refreshed]);
  assert.equal(written.length, 3);
});

test("a collection finishing after a credential switch or league-day reset never reaches the workbook", async () => {
  let time = Date.parse("2026-11-27T04:59:59Z");
  let pending = Promise.withResolvers();
  const writes = [];
  const tracked = createLegendMetricsService({ now: () => time, makeCollector: () => () => pending.promise,
    onCollected: (...args) => writes.push(args) });
  const rows = [{ playerTag: "#MOCK" }];
  tracked.setRows("first", rows);
  const beforeReset = tracked.fetchBatch("first", ["#MOCK"]);
  time += 1000;
  pending.resolve({ value: 1 });
  assert.equal((await beforeReset).entries[0].metrics, null);
  pending = Promise.withResolvers();
  const beforeSwitch = tracked.fetchBatch("first", ["#MOCK"]);
  tracked.setRows("second", rows);
  pending.resolve({ value: 2 });
  assert.deepEqual((await beforeSwitch).entries, []);
  assert.deepEqual(writes, []);

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

test("the active size scopes each roster while identical players share cached metrics", async () => {
  const requests = [];
  const service = createLegendMetricsService({
    makeCollector: () => async tag => { requests.push(tag); return { tag }; },
  });
  const rows = (...tags) => tags.map(playerTag => ({ playerTag }));
  service.setRows("token", rows("#LEADER"), "global");
  service.setRows("token", rows("#LEADER", "#DEEP"), "global", 10000);
  const tags = ["#LEADER", "#DEEP"];
  const get = async limit => (await service.fetchBatch("token", tags, "global", limit)).entries.map(entry => entry.playerTag);
  assert.deepEqual(await get(200), ["#LEADER"]);
  assert.deepEqual(await get(10000), tags);
  service.setRows("token", [], "global", 200);
  assert.deepEqual(await get(200), []);
  assert.deepEqual(await get(10000), tags);
  assert.deepEqual(await get(2000), []);
  assert.deepEqual(requests, tags);
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
