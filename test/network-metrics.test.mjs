import assert from "node:assert/strict";
import test from "node:test";
import { matchesNetworkFilters, measuredValue, netBands, playerRadius, rateBands, valueBand } from "../src/network-metrics.mjs";

const noFilters = { styles: [], rate: "", net: "", attack: 0, sample: 0 };
const stats = { attackCount: 16, threeStarRate: .75, completedDays: 1, averageDailyNet: 40, attackDays: 2, averageDailyAttack: 300 };
const player = { tier: 2, uses: [{ strategy: "龙流", scoredCount: 10 }, { strategy: "蓝胖", scoredCount: 6 }], stats };

test("selected strategies and performance filters all apply to the same player", () => {
  const filters = { styles: ["蓝胖", "龙流"], rate: "at75", net: "at40", attack: 300, sample: 16 };
  assert.ok(matchesNetworkFilters(player, filters));
  for (const change of [{ styles: ["龙流", "雷龙"] }, { rate: "perfect" }, { net: "n80" }, { attack: 320 }]) {
    assert.equal(matchesNetworkFilters(player, { ...filters, ...change }), false);
  }
  assert.equal(matchesNetworkFilters({ ...player, stats: { ...stats, attackCount: 15 } }, filters), false);
  assert.ok(matchesNetworkFilters({ uses: [], stats: null }, noFilters));
});

test("per-style scope checks each selected army's own three-star rate and sample", () => {
  const uses = [
    { strategy: "龙流", scoredCount: 12, threeStarCount: 12 },
    { strategy: "蓝胖", scoredCount: 4, threeStarCount: 2 },
  ];
  const subject = { ...player, stats: { ...stats, threeStarRate: 14 / 16 }, uses };
  const filters = { ...noFilters, styles: ["蓝胖", "龙流"], perStyle: true, rate: "at75" };
  assert.equal(matchesNetworkFilters(subject, filters), false);
  assert.ok(matchesNetworkFilters(subject, { ...filters, perStyle: false }));
  assert.ok(matchesNetworkFilters(subject, { ...filters, styles: ["龙流"], sample: 8 }));
  assert.ok(matchesNetworkFilters(subject, { ...filters, styles: ["蓝胖"], rate: "r50" }));
  assert.equal(matchesNetworkFilters(subject, { ...filters, styles: ["蓝胖"], rate: "r50", sample: 8 }), false);
  assert.ok(matchesNetworkFilters(subject, { ...filters, rate: "", sample: 16 }));
  assert.ok(matchesNetworkFilters(subject, { ...filters, styles: [], sample: 16 }));

  const bothAtThreshold = { ...subject, stats: { ...stats, threeStarRate: 15 / 16 },
    uses: [uses[0], { ...uses[1], threeStarCount: 3 }] };
  assert.ok(matchesNetworkFilters(bothAtThreshold, filters));
  assert.equal(matchesNetworkFilters(bothAtThreshold, { ...filters, rate: "perfect" }), false);
});

test("per-style scope requires a recorded numerator and a positive denominator even in the lowest band", () => {
  const filters = { ...noFilters, perStyle: true, styles: ["蓝胖"], rate: "r0" };
  const withCounts = counts => ({ ...player, uses: [{ strategy: "蓝胖", scoredCount: 4, ...counts }] });
  assert.ok(matchesNetworkFilters(withCounts({ threeStarCount: 0 }), filters));
  for (const counts of [{}, { threeStarCount: null }, { threeStarCount: NaN }, { threeStarCount: 0, scoredCount: 0 }]) {
    assert.equal(matchesNetworkFilters(withCounts(counts), filters), false);
  }
});

test("rate and net bands include their lower edge and preserve zero, negative and missing values", () => {
  for (const [rate, expected] of [[0, "r0"], [.4999, "r0"], [.5, "r50"], [.75, "r75"], [.90, "r90"], [1, "r90"]]) {
    assert.equal(valueBand(rate, rateBands)?.id, expected);
    const subject = { ...player, stats: { ...stats, threeStarRate: rate } };
    assert.ok(matchesNetworkFilters(subject, { ...noFilters, rate: expected }));
    assert.equal(matchesNetworkFilters(subject, { ...noFilters, rate: "perfect" }), rate === 1);
  }
  for (const [net, expected] of [[-12, "loss"], [0, "n0"], [39.5, "n0"], [40, "n40"], [80, "n80"]]) {
    const subject = { ...player, stats: { ...stats, averageDailyNet: net } };
    assert.equal(valueBand(net, netBands)?.id, expected);
    assert.ok(matchesNetworkFilters(subject, { ...noFilters, net: expected }));
    assert.equal(matchesNetworkFilters(subject, { ...noFilters, net: "positive" }), net > 0);
  }
  for (const fields of [{ attackCount: 0 }, { threeStarRate: NaN }]) {
    assert.equal(measuredValue({ ...stats, ...fields }, "rate"), null);
  }
  for (const fields of [{ completedDays: 0 }, { averageDailyNet: null }]) {
    assert.equal(measuredValue({ ...stats, ...fields }, "net"), null);
  }
  assert.equal(matchesNetworkFilters({ uses: [], stats: null }, { ...noFilters, rate: "r0" }), false);
  assert.equal(matchesNetworkFilters({ uses: [], stats: null }, { ...noFilters, net: "n0" }), false);
});

test("daily attack thresholds require a completed attack day independently of defense coverage", () => {
  for (const attack of [240, 280, 300, 320]) {
    const filters = { ...noFilters, attack };
    const complete = { ...stats, completedDays: 0, averageDailyNet: null, attackDays: 1, averageDailyAttack: attack };
    assert.ok(matchesNetworkFilters({ ...player, stats: complete }, filters));
    for (const fields of [{ attackDays: 0 }, { averageDailyAttack: attack - .5 }, { averageDailyAttack: null }, { averageDailyAttack: Infinity }]) {
      assert.equal(matchesNetworkFilters({ ...player, stats: { ...complete, ...fields } }, filters), false);
    }
    assert.equal(matchesNetworkFilters({ ...player, stats: null }, filters), false);
  }
  const zeroCups = { ...stats, averageDailyAttack: 0 };
  assert.equal(measuredValue(zeroCups, "attack"), 0);
  assert.equal(measuredValue({ ...zeroCups, attackDays: 0 }, "attack"), null);
  assert.ok(matchesNetworkFilters({ ...player, stats: zeroCups }, noFilters));
});

test("node sizing uses the chosen observation, its sample coverage and the board net range", () => {
  const radius = (field, altered, extent = [-40, 40]) =>
    playerRadius({ ...player, stats: { ...stats, ...altered } }, field, extent);
  assert.ok(playerRadius({ ...player, tier: 0 }, "rank") > playerRadius({ ...player, tier: 5 }, "rank"));
  assert.ok(radius("rate", { threeStarRate: 1 }) > radius("rate", { threeStarRate: 0 }));
  assert.ok(radius("rate", { threeStarRate: 0 }) > radius("rate", { attackCount: 0 }));
  assert.ok(radius("sample", { attackCount: 16 }) > radius("sample", { attackCount: 8 }));
  assert.ok(radius("sample", { attackCount: 8 }) > radius("sample", { attackCount: 0 }));
  const netSizes = [-40, 0, 40].map(averageDailyNet => radius("net", { averageDailyNet }));
  assert.ok(netSizes[0] < netSizes[1] && netSizes[1] < netSizes[2]);
  assert.ok(netSizes[0] > radius("net", { completedDays: 0 }));
  assert.ok(Number.isFinite(radius("net", { averageDailyNet: -10 }, [-10, -10])));
});
