import test from "node:test";
import assert from "node:assert/strict";
import { buildPopulationLayer } from "../src/atlas-population.mjs";
import { buildStrategyMap, regionContains } from "../src/strategy-map-layout.mjs";

test("every non-anchor in the filtered population has a visible, individually hit-testable point", () => {
  const groups = [{ key: "dragon" }, { key: "bowler" }];
  for (const [width, count] of [[320, 10000], [900, 2000], [1012, 1000]]) {
    const players = Array.from({ length: count }, (_, i) => ({
      rank: i + 1, playerTag: `#P${i + 1}`, cluster: i % 3 === 0 ? "dragon" : i % 3 === 1 ? "bowler" : null,
    }));
    const { nodes, height, regions } = buildStrategyMap(players, groups, width, "rank", "style", "all");
    const box = { x: width * .18, y: 65, width: 65, height: 35 };
    const layer = buildPopulationLayer(players, nodes, width, height, regions, [box]);
    assert.equal(layer.points.length + nodes.length, players.length);
    const ids = new Set(nodes.map(n => n.playerTag));
    const owners = new Map(players.map(p => [p.playerTag, p.cluster]));
    for (const p of layer.points) {
      assert.ok(p.x >= 0 && p.x < width && p.y >= 0 && p.y < height);
      assert.ok(!ids.has(p.playerTag));
      assert.deepEqual(regions.filter(z => regionContains(z, p.x, p.y)).map(z => z.key), [owners.get(p.playerTag)]);
      assert.ok(p.x < box.x || p.y < box.y || p.x > box.x + box.width || p.y > box.y + box.height);
      assert.equal(layer.hitTest(p.x, p.y), p.playerTag);
      ids.add(p.playerTag);
    }
    assert.equal(ids.size, players.length);
    assert.equal(layer.hitTest(-1, 0), null);
    for (const node of nodes) assert.equal(layer.hitTest(node.x, node.y), null);
  }
});

test("unknown and singleton styles have exclusive space even without a foreground representative", () => {
  const groups = Array.from({ length: 24 }, (_, i) => ({ key: String(i) }));
  const players = Array.from({ length: 200 }, (_, i) => ({
    rank: i + 1, playerTag: String(i), cluster: groups[i]?.key ?? null,
  }));
  const { nodes, height, regions } = buildStrategyMap(players, groups, 320, "rank", "style", "all");
  assert.equal(regions.length, 25);
  const layer = buildPopulationLayer(players, nodes, 320, height, regions);
  assert.equal(nodes.length + layer.points.length, players.length);
  for (const p of [...nodes, ...layer.points]) {
    const owner = players[Number(p.playerTag)].cluster;
    assert.deepEqual(regions.filter(zone => regionContains(zone, p.x, p.y)).map(zone => zone.key), [owner]);
  }
});

test("small and empty filtered results carry only the current player identities", () => {
  const a = { playerTag: "#A", rank: 1, x: 50, y: 50 };
  const b = { playerTag: "#B", rank: 8976, cluster: "dragon", pointColor: "#287f90" };
  assert.deepEqual(buildPopulationLayer([], [], 320, 160).points, []);
  assert.equal(buildPopulationLayer([a], [a], 320, 160).points.length, 0);
  const layer = buildPopulationLayer([a, b], [a], 320, 200);
  assert.deepEqual(layer.points.map(p => p.playerTag), ["#B"]);
  assert.equal(layer.points[0].color, b.pointColor);
  assert.equal(layer.hitTest(300, 180), null);
  assert.deepEqual(layer.points, buildPopulationLayer([a, b], [a], 320, 200).points);
});
