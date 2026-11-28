import test from "node:test";
import assert from "node:assert/strict";
import { nextLegendMetricBatch } from "../src/legend-metric-batch.mjs";

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
