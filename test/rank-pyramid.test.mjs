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

test("affinity groups players horizontally without moving the podium, unknown players or rank bands", () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({ rank: index + 1, playerTag: `#${index + 1}` }));
  const grouped = rows.map(row => ({ ...row, affinity: row.rank % 5 === 0 ? null : row.rank % 2 }));
  for (const width of [320, 960]) {
    const original = buildRankPyramid(rows, width).players;
    const placed = buildRankPyramid(grouped, width).players;
    assert.deepEqual(placed, buildRankPyramid(grouped.toReversed(), width).players);
    for (const [i, player] of placed.entries()) {
      assert.equal(player.playerTag, rows[i].playerTag);
      assert.equal(player.tier, original[i].tier);
      assert.equal(player.affinity, grouped[i].affinity);
      if (player.rank <= 3 || player.affinity === null) {
        assert.equal(player.x, original[i].x);
        assert.equal(player.y, original[i].y);
      }
    }
    const lower = placed.filter(p => p.tier >= 3);
    const meanX = affinity => {
      const members = lower.filter(p => p.affinity === affinity);
      return members.reduce((total, p) => total + p.x, 0) / members.length;
    };
    assert.ok(meanX(1) - meanX(0) > width * .20);
    // Lower tiers use a continuous vertical spread instead of rows of aligned dots.
    assert.ok(new Set(lower.map(p => Math.round(p.y))).size > lower.length / 2);
  }
});
