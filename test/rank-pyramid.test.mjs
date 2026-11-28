import assert from "node:assert/strict";
import test from "node:test";
import { buildRankPyramid } from "../src/rank-pyramid-layout.mjs";

test("the pyramid keeps all 200 actual ranks in widening, separated bands at mobile and desktop widths", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ rank: 200 - i, playerTag: `#${200 - i}` }));
  for (const width of [320, 600, 1012, 1500]) {
    const { players, height } = buildRankPyramid(rows, width);
    assert.deepEqual(players.map(p => p.playerTag), rows.map(p => p.playerTag).reverse());
    assert.equal(players[0].x, width / 2);
    let previousSpan = -1, previousBottom = 0;
    for (const [tier, size] of [1, 2, 7, 20, 50, 120].entries()) {
      const band = players.filter(p => p.tier === tier);
      assert.equal(band.length, size);
      const span = Math.max(...band.map(p => p.x)) - Math.min(...band.map(p => p.x));
      assert.ok(span > previousSpan && Math.min(...band.map(p => p.y)) > previousBottom);
      previousSpan = span;
      previousBottom = Math.max(...band.map(p => p.y));
    }
    for (const [i, p] of players.entries()) {
      assert.ok(0 < p.x && p.x < width && 0 < p.y && p.y < height);
      assert.ok(players.slice(i + 1).every(q => Math.hypot(p.x - q.x, p.y - q.y) > 14));
    }
    assert.deepEqual(buildRankPyramid([rows[0]], width).players, [players[199]]);
  }
});
