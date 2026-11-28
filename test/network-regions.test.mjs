import assert from "node:assert/strict";
import test from "node:test";
import { buildNetworkRegion } from "../src/network-regions.mjs";

test("region contours follow observed neighbors, isolate distant members and preserve empty space inside a ring", () => {
  const width = 1000, height = 500;
  const nearby = [{ x: 80, y: 80 }, { x: 114, y: 86 }];
  const local = buildNetworkRegion(nearby, width, height);
  assert.equal(local.match(/M/g).length, 1);
  assert.equal(buildNetworkRegion(nearby.toReversed(), width, height), local);
  const separate = buildNetworkRegion([...nearby, { x: 330, y: 250 }], width, height);
  assert.equal(separate.match(/M/g).length, 2);

  const ring = Array.from({ length: 32 }, (_, index) => ({
    x: 500 + 85 * Math.cos(index * Math.PI / 16),
    y: 200 + 85 * Math.sin(index * Math.PI / 16),
  }));
  assert.equal(buildNetworkRegion(ring, width, height).match(/Z/g).length, 2);
});

test("missing samples produce no region and a singleton at the graph edge stays inside the viewport", () => {
  assert.equal(buildNetworkRegion([], 320, 400), "");
  assert.equal(buildNetworkRegion([{ x: NaN, y: 50 }], 320, 400), "");
  const d = buildNetworkRegion([{ x: 2, y: 399 }], 320, 400);
  assert.match(d, /^M[\d .Q]+Z$/);
  const coords = d.match(/[\d.]+/g).map(Number);
  for (let i = 0; i < coords.length; i += 2) {
    assert.ok(coords[i] >= 0 && coords[i] < 20);
    assert.ok(coords[i + 1] > 380 && coords[i + 1] <= 400);
  }
});
