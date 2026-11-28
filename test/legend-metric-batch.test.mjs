import test from "node:test";
import assert from "node:assert/strict";
import { applyLegendMetricResults, legendMetricView, nextLegendMetricBatch, restoredLegendMetrics } from "../src/legend-metric-batch.mjs";
import { legendDayNumber } from "../insights.mjs";

test("resuming a slow ten-thousand-player sweep reaches new players before refreshing earlier expired attempts", () => {
  const rows = Array.from({ length: 10000 }, (_, i) => ({ playerTag: `#P${i + 1}` }));
  const day = 101;
  const history = new Map(rows.slice(0, 9974).map(({ playerTag }) => [playerTag, { day }]));
  const fresh = new Map(rows.slice(80, 9974).map(({ playerTag }) => [playerTag, history.get(playerTag)]));
  const first = nextLegendMetricBatch(rows, fresh, history, day);
  assert.deepEqual(first, rows.slice(9974, 9994).map(row => row.playerTag));
  for (const tag of first) {
    history.set(tag, { day });
    fresh.set(tag, history.get(tag));
  }
  const second = nextLegendMetricBatch(rows, fresh, history, day);
  assert.deepEqual(second, [...rows.slice(9994), ...rows.slice(0, 14)].map(row => row.playerTag));
});

test("visible candidates define the scope, an unavailable attempt counts for today, and a new league day clears priority", () => {
  const visible = ["#A", "#B", "#C", "#C", "#D"].map(playerTag => ({ playerTag }));
  const history = new Map([["#A", { day: 5, metrics: null }], ["#B", { day: 5 }], ["#C", { day: 4 }]]);
  const fresh = new Map([["#B", history.get("#B")]]);
  assert.deepEqual(nextLegendMetricBatch(visible, fresh, history, 5), ["#C", "#D", "#A"]);
  assert.deepEqual(nextLegendMetricBatch(visible, new Map(), history, 6), ["#A", "#B", "#C", "#D"]);
  assert.deepEqual(nextLegendMetricBatch([], fresh, history, 5), []);
});

test("show Excel samples immediately; overdue samples remain visible during refresh and after isolated failures", () => {
  const now = Date.parse("2026-11-27T06:20:00Z");
  const day = legendDayNumber(now);
  const rows = ["#WARM", "#STALE", "#MISSING", "#OTHERDAY"].map(playerTag => ({ playerTag }));
  const expired = now - 600_000;
  const saved = restoredLegendMetrics([
    { playerTag: "#WARM", metrics: { n: 1 }, checkedAt: expired + 1 },
    { playerTag: "#STALE", metrics: { n: 2 }, checkedAt: expired },
    { playerTag: "#OTHERDAY", metrics: { n: 3 }, checkedAt: now - 86_400_000 },
    { playerTag: "#MISSING", metrics: null, checkedAt: now },
    { playerTag: "#MISSING", metrics: { n: 4 }, checkedAt: now + 1 },
  ], now);
  const initial = legendMetricView(rows, undefined, saved, now, "roster");
  assert.equal(initial.staleCount, 1);
  assert.equal(initial.pendingCount, 3);
  assert.equal(initial.statuses.size, 2);
  assert.equal(initial.statuses.get("#WARM").restoredUntil, now + 1);
  assert.deepEqual(nextLegendMetricBatch(rows, initial.settled, undefined, day, saved), ["#MISSING", "#OTHERDAY", "#STALE"]);

  const tags = rows.map(row => row.playerTag);
  const failure = applyLegendMetricResults(undefined, tags, { partial: true,
    entries: [{ playerTag: "#STALE", metrics: null, checkedAt: now }, { playerTag: "#MISSING", metrics: null, checkedAt: now }] },
  day, "roster", now);
  const afterFailure = legendMetricView(rows, failure, saved, now, "roster");
  assert.equal(afterFailure.pendingCount, 1);
  assert.equal(afterFailure.staleFailedCount, 1);
  assert.equal(afterFailure.statuses.get("#STALE").checkedAt, expired);
  assert.deepEqual(afterFailure.statuses.get("#STALE").metrics, { n: 2 });
  assert.equal(afterFailure.statuses.get("#MISSING").metrics, null);
  assert.ok(!afterFailure.statuses.has("#OTHERDAY"));

  const retried = legendMetricView(rows, failure, saved, now + 60_000, "roster");
  assert.equal(retried.pendingCount, 4);
  const success = applyLegendMetricResults(failure, ["#STALE"], { entries: [
    { playerTag: "#STALE", metrics: { n: 5 }, checkedAt: now + 30_000 },
  ] }, day, "roster", now + 60_000);
  const updated = legendMetricView(rows, success, saved, now + 60_000, "roster");
  assert.deepEqual(updated.statuses.get("#STALE"), { metrics: { n: 5 }, checkedAt: now + 30_000, stale: false, refreshFailed: false, restoredUntil: null });
  assert.equal(updated.staleFailedCount, 0);
  assert.equal(legendMetricView(rows, success, saved, now + 86_400_000, "roster").statuses.size, 0);
});
