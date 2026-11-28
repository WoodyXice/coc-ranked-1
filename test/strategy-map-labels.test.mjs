import assert from "node:assert/strict";
import test from "node:test";
import { placeMapLabels } from "../src/strategy-map-labels.mjs";

function player(rank, x, y, name = "Ana") {
  return { rank, x, y, playerName: name, playerTag: "#P" + rank, radius: 6 };
}

test("spreads a limited number of names across ranks, and labels all the podium on a roomy plot", () => {
  const players = Array.from({ length: 72 }, (_, i) => player(i + 1, 145 + i % 8 * 124, 36 + Math.floor(i / 8) * 41));
  const labels = placeMapLabels(players, 1160, 400);
  assert.equal(labels.size, 14);
  for (const top of players.slice(0, 3)) assert.equal(labels.get(top.playerTag).tag, top.playerTag);
  assert.ok([...labels.keys()].some(tag => Number(tag.slice(2)) >= 65));
  assert.deepEqual([...labels], [...placeMapLabels([...players].reverse(), 1160, 400)]);
  const sparse = players.filter((_, i) => i % 9 === 0);
  assert.equal(placeMapLabels(sparse, 1160, 400).size, sparse.length);
});

test("respects map edges, occupied titles, other labels and circles without labels", () => {
  const nodes = [player(10, 6, 27), player(11, 350, 23), player(12, 145, 76), player(13, 184, 77), player(14, 195, 94)];
  const reserved = [{ x: 58, y: 1, width: 54, height: 57 }];
  const obstacles = [{ x: 230, y: 77, radius: 10 }, { x: 92, y: 75, radius: 8 }];
  const labels = placeMapLabels(nodes, 362, 158, { reserved, obstacles });
  assert.ok(labels.size >= 3);
  assert.ok(labels.has("#P11"));
  const boxes = [...reserved];
  for (const { text, x, y, anchor, bounds } of labels.values()) {
    // All names in this fixture are ASCII, with no second line.
    const width = text.length * 7;
    const rect = { x: x - (anchor === "start" ? 0 : anchor === "end" ? width : width / 2), y: y - 10, width, height: 13 };
    const right = rect.x + width;
    const bottom = rect.y + rect.height;
    assert.ok(bounds.x <= rect.x && bounds.x + bounds.width >= right);
    assert.ok(bounds.y <= rect.y && bounds.y + bounds.height >= bottom);
    assert.ok(rect.x >= 0 && right <= 362 && rect.y >= 0 && bottom <= 158);
    for (const box of boxes) {
      assert.ok(rect.x >= box.x + box.width || right <= box.x || rect.y >= box.y + box.height || bottom <= box.y);
    }
    for (const circle of [...nodes, ...obstacles]) {
      const nearestX = Math.max(rect.x - circle.x, 0, circle.x - right);
      const nearestY = Math.max(rect.y - circle.y, 0, circle.y - bottom);
      assert.ok(Math.hypot(nearestX, nearestY) >= circle.radius);
    }
    boxes.push(rect);
  }
  assert.equal(placeMapLabels(nodes, 362, 158, { reserved: [{ x: 0, y: 0, width: 362, height: 158 }] }).size, 0);
});

test("preserves grapheme clusters in truncated names and puts a single # on a podium tag", () => {
  const family = "👩‍🚀";
  const top = { ...player(1, 180, 64, "胜" + family.repeat(14)), playerTag: "Q2P80" };
  const result = placeMapLabels([top], 360, 150).get(top.playerTag);
  assert.equal(result.tag, "#Q2P80");
  assert.ok(result.bounds.y + result.bounds.height > result.y + 13);
  assert.match(result.text, /^#1 胜(?:👩‍🚀)+…$/u);
  const tagsOnly = placeMapLabels([player(1, 180, 64, " ")], 360, 150).get("#P1");
  assert.equal(tagsOnly.text, "#1 #P1");
  assert.equal(tagsOnly.tag, undefined);
});

test("drops the optional tag when a low plot fits one line and limits names on narrow plots", () => {
  const shortPlot = placeMapLabels([player(1, 68, 14)], 200, 28);
  assert.ok(shortPlot.has("#P1"));
  assert.equal(shortPlot.get("#P1").tag, undefined);
  const many = Array.from({ length: 30 }, (_, i) => player(i + 1, 30 + i % 3 * 100, 35 + Math.floor(i / 3) * 45));
  assert.equal(placeMapLabels(many, 320, 500).size, 6);
  assert.equal(placeMapLabels(many, 3, 3).size, 0);
});
