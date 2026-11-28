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

test("overlap uses all recognized armies, counts unscored hits and preserves the leaderboard denominator", () => {
  const now = new Date("2026-11-28T12:00:00Z");
  const attacks = [["龙流", 3], ["龙流", null], ["龙流", 2], ["天女蓝胖", null], ["雷龙流", 0]]
    .map(([strategy, stars], i) => ({ battleType: "LEGEND", timestamp: new Date(now - i * 60_000).toISOString(), strategy, stars }));
  const rows = [{ rank: 1, playerTag: "#MIXED" }];
  const metrics = new Map([["#MIXED", legendPlayerMetrics({ attacks }, now)]]);
  const leaderboard = legendStrategyLeaderboard(rows, metrics);
  const board = prepareBoard(rows, metrics, leaderboard, "overlap", ["龙流", "天女蓝胖"]);
  assert.deepEqual(board.pair, ["龙流", "天女蓝胖"]);
  assert.equal(board.players[0].cluster, "both");
  const uses = new Map(board.players[0].uses.map(use => [use.strategy, [use.count, use.scoredCount, use.threeStarCount]]));
  assert.deepEqual(uses.get("龙流"), [3, 2, 1]);
  assert.deepEqual(uses.get("天女蓝胖"), [1, 0, 0]);
  assert.deepEqual(uses.get("雷龙流"), [1, 1, 0]);
  assert.deepEqual(leaderboard.map(s => [s.strategy, s.threeStarRate]), [["龙流", .5], ["雷龙流", 0]]);
});

test("default pair maximizes distinct shared players and switching sides preserves the full roster", () => {
  const [a, b, c] = ["龙流", "天女蓝胖", "雷龙流"];
  const stylesByPlayer = [[a, b], [a, b, c], [a, b], [a], [b], [c], [c], [c], [c], [c], []];
  const rows = stylesByPlayer.map((_, i) => ({ playerTag: "#P" + i, rank: i + 1 }));
  const metrics = new Map(rows.map(({ playerTag }, i) => [playerTag, {
    strategies: stylesByPlayer[i].map(strategy => ({ strategy, count: 1, scoredCount: 0, threeStarCount: 0 })),
  }]));
  const auto = prepareBoard(rows, metrics, [], "overlap");
  assert.deepEqual(new Set(auto.pair), new Set([a, b]));
  const board = prepareBoard(rows, metrics, [], "overlap", [a, b]);
  assert.deepEqual(board.pair, [a, b]);
  assert.deepEqual(board.players.map(p => p.cluster), ["both", "both", "both", "left", "right", "other", "other", "other", "other", "other", null]);
  const reversed = prepareBoard(rows, metrics, [], "overlap", [b, a]);
  assert.deepEqual(reversed.players.slice(2, 5).map(p => p.cluster), ["both", "right", "left"]);
  assert.deepEqual(prepareBoard(rows, metrics, [], "overlap", ["旧流派", a]).pair, [b, a]);
  assert.deepEqual(prepareBoard(rows, metrics, [], "overlap", [a, a]).pair, [a, b]);
  assert.deepEqual(prepareBoard([], new Map(), [], "overlap").pair, []);
  const solo = prepareBoard([rows[3]], metrics, [], "overlap", [a, b]);
  assert.deepEqual(solo.pair, [a]);
  assert.equal(solo.players[0].cluster, "left");
});

test("legacy scored-only metrics use known primary totals without inventing secondary totals", () => {
  const rows = [{ playerTag: "#OLD", rank: 1 }];
  const stats = { strategy: "龙流", strategyCount: 7, strategies: [
    { strategy: "龙流", scoredCount: 5, threeStarCount: 2 },
    { strategy: "天女蓝胖", scoredCount: 3, threeStarCount: 0 },
  ] };
  const board = prepareBoard(rows, new Map([["#OLD", stats]]), [], "overlap");
  assert.equal(board.players[0].cluster, "both");
  assert.deepEqual(board.players[0].uses.map(use => [use.count, use.scoredCount, use.threeStarCount]), [[7, 5, 2], [null, 3, 0]]);
  assert.equal(stats.strategies[0].count, undefined);
});
