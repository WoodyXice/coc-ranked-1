import assert from "node:assert/strict";
import { test } from "node:test";
import { createLegendRequestCache } from "../src/legend-request-cache.mjs";

test("a leaderboard snapshot is reused for ten minutes and stays visible while revalidating", async () => {
  let now = 0;
  let loads = 0;
  const cache = createLegendRequestCache(() => ({ revision: ++loads }), () => now);
  assert.equal(cache.read("global").status, "idle");
  await cache.request("global");
  now = 599_999;
  const previous = cache.read("global");
  assert.equal(cache.request("global"), null);
  assert.equal(cache.read("global"), previous);
  assert.equal(loads, 1);

  now = 600_000;
  const refresh = cache.request("global");
  assert.equal(cache.read("global").status, "loading");
  assert.equal(cache.read("global").data, previous.data);
  await refresh;
  assert.deepEqual(cache.read("global").data, { revision: 2 });
  assert.equal(cache.read("global").fetchedAt, now);
});

test("leaderboard requests share an in-flight fetch per location, and manual refresh can bypass the fresh cache", async () => {
  const calls = [];
  const cache = createLegendRequestCache(async (location) => {
    calls.push(location);
    return { location };
  });
  const first = cache.request("global");
  assert.equal(cache.request("global"), first);
  assert.equal(cache.request("global", true), first);
  await Promise.all([first, cache.request(32000000)]);
  assert.deepEqual(calls, ["global", 32000000]);
  assert.deepEqual(cache.read(32000000).data, { location: 32000000 });
  assert.equal(cache.request(32000000), null);

  await cache.request("global", true);
  assert.deepEqual(calls, ["global", 32000000, "global"]);
});

test("a failed refresh retains the old leaderboard and retries after an expired tab return", async () => {
  let now = 0;
  let failure = false;
  const cache = createLegendRequestCache(() => {
    if (failure) throw new Error("限流");
    return ["existing player"];
  }, () => now);
  await cache.request("global");
  const previous = cache.read("global");
  now = 600_001;
  failure = true;
  await cache.request("global");
  const state = cache.read("global");
  assert.equal(state.status, "error");
  assert.equal(state.error, "限流");
  assert.equal(state.data, previous.data);
  assert.equal(state.fetchedAt, previous.fetchedAt);

  failure = false;
  await cache.request("global");
  assert.equal(cache.read("global").status, "ready");
  assert.equal(cache.read("global").fetchedAt, now);
});
