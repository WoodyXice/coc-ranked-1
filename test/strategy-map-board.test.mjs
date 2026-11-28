import assert from "node:assert/strict";
import test from "node:test";
import { legendPlayerMetrics, legendStrategyLeaderboard } from "../insights.mjs";
import { matchesNetworkFilters } from "../src/network-metrics.mjs";
import { prepareBoard, unknownStyle } from "../src/strategy-map-board.mjs";
import { styleColors } from "../src/strategy-search.mjs";

test("recognized armies define a primary even if only a secondary style has scored attacks", () => {
  const now = new Date("2026-11-28T12:00:00Z");
  const attacks = [["龙流", null], ["龙流", null], ["天女蓝胖", 3]].map(([strategy, stars], index) => ({
    battleType: "LEGEND", timestamp: new Date(now.getTime() - index * 60_000).toISOString(), strategy, stars,
  }));
  const rows = [{ rank: 1, playerTag: "#MIXED" }, { rank: 2, playerTag: "#UNSCORED" }];
  const metrics = new Map([
    ["#MIXED", legendPlayerMetrics({ attacks }, now)],
    ["#UNSCORED", legendPlayerMetrics({ attacks: attacks.slice(0, 1) }, now)],
  ]);
  const leaderboard = legendStrategyLeaderboard(rows, metrics);
  const board = prepareBoard(rows, metrics, leaderboard, "style");
  assert.deepEqual(board.styles, ["天女蓝胖", "龙流"]);
  assert.equal(board.groups.find(group => group.key === "龙流").pointColor, styleColors("龙流").pointColor);
  for (const player of board.players) {
    assert.equal(player.cluster, "龙流");
    assert.equal(player.pointColor, styleColors("龙流").pointColor);
    assert.ok(matchesNetworkFilters(player, { styles: ["龙流"] }));
    assert.equal(matchesNetworkFilters(player, { styles: ["龙流"], rate: "perfect", perStyle: true }), false);
  }
  assert.ok(matchesNetworkFilters(board.players[0], { styles: ["龙流", "天女蓝胖"] }));
  assert.equal(metrics.get("#UNSCORED").threeStarRate, null);
  assert.deepEqual(legendStrategyLeaderboard(rows, metrics).map(group => [group.strategy, group.scoredCount]), [["天女蓝胖", 1]]);
  const byRate = prepareBoard(rows, metrics, leaderboard, "rate");
  assert.deepEqual(byRate.styles, board.styles);
  assert.deepEqual(byRate.players.map(player => player.cluster), ["r90", null]);
});

test("unclassified, empty and pending reports remain neutral and match no style", () => {
  const now = new Date("2026-11-28T12:00:00Z");
  const rows = ["#UNKNOWN", "#EMPTY", "#PENDING"].map((playerTag, index) => ({ rank: index + 1, playerTag }));
  const metrics = new Map([
    ["#UNKNOWN", legendPlayerMetrics({ attacks: [{ battleType: "LEGEND", timestamp: now.toISOString(), stars: 3, strategy: "其他" }] }, now)],
    ["#EMPTY", legendPlayerMetrics({}, now)],
  ]);
  const board = prepareBoard(rows, metrics, [], "style");
  assert.deepEqual(board.styles, []);
  for (const player of board.players) {
    assert.equal(player.cluster, null);
    assert.equal(player.pointColor, unknownStyle.pointColor);
    assert.equal(matchesNetworkFilters(player, { styles: ["龙流"] }), false);
  }
});
