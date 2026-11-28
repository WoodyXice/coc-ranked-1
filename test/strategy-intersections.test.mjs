import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategyMap, regionContains } from "../src/strategy-map-layout.mjs";
import { buildPopulationLayer } from "../src/atlas-population.mjs";

const keys = ["left", "both", "right", "other", null];
const groups = keys.map(key => ({ key }));
function playersWithCounts(counts) {
  let rank = 0;
  return counts.flatMap((count, i) => Array.from({ length: count }, () => {
    rank++;
    return { rank, playerTag: `#P${rank}`, primary: keys[i], cluster: keys[i],
      uses: (keys[i] === "both" ? ["A", "B"] : keys[i] ? [keys[i]] : []).map(strategy => ({ strategy })) };
  }));
}

test("overlap map draws the occupied exclusive, shared and outside regions, with one identity per point", () => {
  for (const [width, counts] of [[240, [1, 1, 1, 100, 97]], [320, [12, 1, 110, 67, 10]],
    [1000, [45, 50, 65, 29, 11]], [320, [8, 171, 1, 19, 1]], [1000, [600, 1400, 4000, 3900, 100]],
    [320, [3, 9980, 2, 8, 7]], [320, [1, 1, 1, 2, 9995]]]) {
    const players = playersWithCounts(counts);
    const { nodes, regions, styleShapes, height } = buildStrategyMap(players, groups, width, "rank", "overlap", "all");
    const anchors = nodes.map(node => ({ ...node, radius: node.rank < 4 ? 12 : 5 }));
    const population = buildPopulationLayer(players, anchors, width, height, regions);
    assert.equal(nodes.length + population.points.length, players.length, `population at ${width} with ${counts}`);
    assert.deepEqual(styleShapes.map(s => s.key).sort(), ["left", "right"]);
    const bucket = new Map(players.map(p => [p.playerTag, p.cluster]));
    for (const p of [...nodes, ...population.points]) {
      const membership = regions.filter(region => regionContains(region, p.x, p.y)).map(region => region.key);
      assert.deepEqual(membership, [bucket.get(p.playerTag)], `membership at ${width} / ${p.playerTag}`);
    }
    for (const p of population.points) {
      assert.equal(population.hitTest(p.x, p.y), p.playerTag);
      for (const anchor of anchors) {
        assert.ok(Math.hypot(p.x - anchor.x, p.y - anchor.y) >= Math.max(12, anchor.radius + 4));
      }
    }
  }
});

test("zero shared members, subset sets, identical sets, a single set and no usable samples preserve only real memberships", () => {
  for (const counts of [[111, 0, 63, 26, 0], [1, 192, 0, 0, 7], [0, 1, 1, 2, 196], [0, 200, 0, 0, 0],
    [199, 1, 0, 0, 0], [0, 0, 154, 0, 46], [0, 0, 0, 0, 200], [0, 0, 0, 20, 180],
    [0, 1, 0, 0, 0], [0, 0, 1, 0, 0], [1, 0, 1, 0, 0]]) {
    const players = playersWithCounts(counts);
    const { nodes, regions, styleShapes, height } = buildStrategyMap(players, groups, 240, "rank", "overlap", "all");
    const remaining = buildPopulationLayer(players, nodes, 240, height, regions);
    assert.equal(nodes.length + remaining.points.length, players.length);
    assert.deepEqual(regions.map(region => region.key).sort(), keys.filter((_, i) => counts[i]).sort());
    assert.deepEqual(styleShapes.map(s => s.key).sort(),
      ["left", "right"].filter((_, i) => (i ? counts[2] : counts[0]) || counts[1]));
    const left = regions.find(r => r.key === "left");
    const right = regions.find(r => r.key === "right");
    const shared = regions.find(r => r.key === "both");
    if (!shared && left && right) assert.ok(left.bounds.x + left.bounds.width < right.bounds.x);
    for (const p of [...nodes, ...remaining.points]) {
      const key = players[Number(p.playerTag.slice(2)) - 1].cluster;
      assert.deepEqual(regions.filter(r => regionContains(r, p.x, p.y)).map(r => r.key), [key]);
    }
  }
});
