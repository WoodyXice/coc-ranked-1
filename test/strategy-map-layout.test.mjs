import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategyMap } from "../src/strategy-map-layout.mjs";

const groups = ["dragon", "bowler", "blimp", "balloon", "yeti", "witch"]
  .map(key => ({ key, name: key, color: "#638cad" }));
const players = Array.from({ length: 200 }, (_, index) => {
  const rank = index + 1;
  const cluster = groups[index % groups.length].key;
  return { rank, playerTag: `#P${rank}`, playerName: `Player ${rank}`, cluster,
    uses: [{ strategy: cluster }, ...(rank % 3 === 0 ? [{ strategy: "dragon" }] : [])],
    stats: { attackCount: rank === 117 ? 16 : rank % 12, threeStarRate: rank === 149 ? 1 : rank % 9 / 10,
      completedDays: rank % 4 === 0 ? 0 : 1, averageDailyNet: rank === 129 ? 280 : rank % 70 - 20 } };
});

test("representatives retain the leaders, every common category and the tail in wide and narrow windows", () => {
  for (const [width, min, max] of [[380, 10, 15], [1000, 24, 30]]) {
    const map = buildStrategyMap(players, groups, width);
    assert.ok(map.nodes.length >= min && map.nodes.length <= max);
    const ranks = map.nodes.map(p => p.rank);
    assert.deepEqual(ranks.slice(0, 3), [1, 2, 3]);
    assert.equal(ranks.at(-1), 200);
    assert.deepEqual(new Set(map.nodes.map(p => p.cluster)), new Set(groups.map(g => g.key)));
    assert.deepEqual([...new Set(ranks)].sort((a, b) => a - b), ranks);
    assert.deepEqual(buildStrategyMap([...players].reverse(), [...groups].reverse(), width), map);
  }
});

test("changing marker size also samples the best eligible performers for that measure", () => {
  for (const [sizeBy, best] of [["sample", 117], ["rate", 149], ["net", 129]]) {
    const { nodes } = buildStrategyMap(players, groups, 380, sizeBy);
    assert.ok(nodes.some(p => p.rank === best), sizeBy);
    assert.deepEqual(nodes.slice(0, 3).map(p => p.rank), [1, 2, 3]);
  }
});

test("nodes use horizontal space and stay separate while official rank has a broad vertical trend", () => {
  for (const width of [240, 375, 519, 520, 799, 800, 1200, 1500]) {
    const { nodes, height, zones } = buildStrategyMap(players, groups, width);
    const xs = nodes.map(p => p.x);
    assert.ok(Math.max(...xs) - Math.min(...xs) > width * .55);
    for (const [i, p] of nodes.entries()) {
      assert.ok(p.x > 10 && p.x < width - 10 && p.y > 10 && p.y < height - 10);
      for (const q of nodes.slice(i + 1)) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 24);
    }
    const meanY = subset => subset.reduce((sum, p) => sum + p.y, 0) / subset.length;
    assert.ok(meanY(nodes.slice(0, 3)) < meanY(nodes.slice(-3)));
    assert.ok(zones.length >= 1 && zones.length <= 4);
    assert.equal(new Set(zones.map(z => z.key)).size, zones.length);
    for (const z of zones) {
      assert.ok(nodes.filter(p => p.cluster === z.key).length >= 2);
      assert.ok(z.x >= 0 && z.x <= width && z.y >= 0 && z.y <= height);
      assert.match(z.d, /^M [\d .]+ Q .+ Z$/);
      assert.doesNotMatch(z.d, /NaN|Infinity/);
    }
  }
});

test("links are short, sparse and explainable from actual strategy uses or the selected metric band", () => {
  const width = 950;
  const { nodes, edges, height } = buildStrategyMap(players, groups, width);
  assert.ok(edges.length > 5 && edges.length <= Math.ceil(nodes.length * 1.25));
  const seen = new Set();
  const bridges = [];
  for (const { a, b } of edges) {
    assert.ok(nodes.includes(a) && nodes.includes(b) && a !== b);
    assert.ok(a.uses.some(x => b.uses.some(y => y.strategy === x.strategy)));
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(length <= Math.min(500, Math.hypot(width, height) * .52));
    if (length > Math.min(320, Math.hypot(width, height) * .33)) {
      assert.notEqual(a.cluster, b.cluster);
      bridges.push([a, b]);
    }
    const key = [a.rank, b.rank].sort((x, y) => x - y).join("-");
    assert.ok(!seen.has(key));
    seen.add(key);
  }
  assert.ok(bridges.length <= 3);
  assert.equal(new Set(bridges.flat()).size, bridges.length * 2);
  const bandOnly = players.slice(0, 10).map(p => ({ ...p, uses: [], cluster: "r75" }));
  const bands = [{ key: "r75", name: "75–90%" }];
  assert.equal(buildStrategyMap(bandOnly, bands, 375, "rank", "style").edges.length, 0);
  assert.ok(buildStrategyMap(bandOnly, bands, 375, "rank", "rate").edges.length > 0);
  const missing = bandOnly.map(p => ({ ...p, cluster: undefined }));
  assert.equal(buildStrategyMap(missing, bands, 375, "rank", "rate").edges.length, 0);
  const mixedBands = players.slice(0, 12).map((p, i) => ({ ...p,
    cluster: i % 2 ? "r50" : "r75", uses: [{ strategy: "dragon" }] }));
  for (const mode of ["rate", "net"]) {
    const bandMap = buildStrategyMap(mixedBands, [...bands, { key: "r50" }], 375, "rank", mode);
    assert.ok(bandMap.edges.length > 0);
    assert.ok(bandMap.edges.every(({ a, b }) => a.cluster === b.cluster));
  }
});

test("curved tints occupy distinct outer neighbourhoods and leave the centre mostly clear", () => {
  const width = 1012;
  const { zones, height } = buildStrategyMap(players, groups, width);
  const occupied = new Set();
  let overlaps = 0, centerCells = 0;
  for (const zone of zones) {
    const coords = zone.d.match(/\d+/g).map(Number);
    let [x, y] = coords;
    const outline = [];
    for (let i = 2; i < coords.length; i += 4) {
      const [cx, cy, endX, endY] = coords.slice(i, i + 4);
      for (const t of [0, .25, .5, .75]) {
        outline.push([x * (1-t)**2 + 2*cx*t*(1-t) + endX*t*t, y * (1-t)**2 + 2*cy*t*(1-t) + endY*t*t]);
      }
      x = endX; y = endY;
    }
    for (let j = 0; j < 40; j++) {
      const scanY = (j + .5) * height / 40;
      const crossings = [];
      outline.forEach(([x, y], k) => {
        const [toX, toY] = outline[(k + 1) % outline.length];
        if ((y > scanY) !== (toY > scanY)) crossings.push(x + (toX-x) * (scanY-y) / (toY-y));
      });
      crossings.sort((a, b) => a - b);
      for (let k = 0; k < crossings.length; k += 2) {
        for (let col = Math.ceil(crossings[k] * 80 / width - .5); (col + .5) * width / 80 < crossings[k+1]; col++) {
          const cell = j * 80 + col;
          if (occupied.has(cell)) overlaps++;
          else if (col >= 28 && col < 52 && j >= 12 && j < 28) centerCells++;
          occupied.add(cell);
        }
      }
    }
  }
  assert.ok(occupied.size / 3200 > .12 && occupied.size / 3200 < .32);
  assert.ok(overlaps / 3200 < .016);
  assert.ok(centerCells / (24 * 16) < .38);
});

test("empty, single and sparse filtered results keep the real players and original official ranks", () => {
  const empty = buildStrategyMap([], groups, 375);
  assert.deepEqual([empty.nodes, empty.edges, empty.zones], [[], [], []]);
  const one = buildStrategyMap([players[130]], groups, 375);
  assert.ok(one.height >= 160 && one.height <= 200);
  assert.equal(one.nodes[0].playerTag, players[130].playerTag);
  assert.deepEqual([one.edges, one.zones], [[], []]);
  const subset = [players[4], players[26], players[77], players[191]];
  const map = buildStrategyMap(subset, groups, 1200);
  assert.deepEqual(map.nodes.map(({ x, y, ...p }) => p), subset);
  assert.ok(subset.every(p => !("x" in p) && !("y" in p)));
});
