import assert from "node:assert/strict";
import test from "node:test";
import { fetchTemporaryGroupDetails } from "../collector.mjs";
import { createTemporaryGroupService } from "../desktop/service.mjs";

const seasonId = Date.parse("2026-11-23T05:00:00Z") / 1000;
const now = new Date("2026-11-26T05:00:00Z");
const scope = { playerTag: "#SECOND", groupTag: "#GROUP1", seasonId, week: "2026-11-23" };
const token = "fixture-token";

function member(playerTag, cups, count) {
  return { playerTag, leagueTrophies: cups, attackWinCount: count, attackLoseCount: 0, defenseWinCount: count, defenseLoseCount: 0 };
}
const members = [member("#FIRST", 68, 1), member("#SECOND", 63, 1), member("#EMPTY", 0, 0)];

function battle(stars, destructionPercentage, trophies) {
  return {
    opponentPlayerTag: "#OUTSIDE", creationTime: "20261125T110000.000Z", stars, destructionPercentage, trophies,
    battleTime: 106, armyShareCode: "u8x8",
  };
}

function fixture({ roster = members, missing, profile = {} } = {}) {
  const calls = [];
  const fetchImpl = async (address) => {
    const url = new URL(address);
    calls.push(decodeURIComponent(url.pathname + url.search));
    if (url.pathname === "/v1/players/%23SECOND") {
      return Response.json({ name: "Selected", currentLeagueGroupTag: scope.groupTag, currentLeagueSeasonId: seasonId,
        leagueTier: { id: 105000035 }, ...profile });
    }
    assert.equal(decodeURIComponent(url.pathname), `/v1/leaguegroup/${scope.groupTag}/${seasonId}`);
    const tag = url.searchParams.get("playerTag");
    if (tag === missing) return new Response(null, { status: 404 });
    const first = tag === "#FIRST";
    const attacks = tag === "#EMPTY" ? [] : [battle(first ? 3 : 2, first ? 100 : 90, first ? 40 : 30)];
    const defenses = tag === "#EMPTY" ? [] : [battle(1, first ? 69 : 50, first ? 28 : 33)];
    const old = { ...battle(3, 100, 40), creationTime: "20261123T045959.000Z" };
    return Response.json({ members: roster, attackLogs: [...attacks, old], defenseLogs: defenses });
  };
  return { calls, options: { now, requestIntervalMs: 0, fetchImpl } };
}

test("expanded weekly standings use each member's ledger, preserving zeros, rank, lineups and time without outsider requests", async () => {
  const { calls, options } = fixture();
  const board = await fetchTemporaryGroupDetails({ ...scope, token }, options);
  assert.equal(board.partial, false);
  assert.deepEqual(board.rows.map((r) => [r.playerTag, r.rank, r.attackTrophies, r.defenseTrophies, r.trophies,
    r.attackStars, r.attackDestruction, r.defenseDestruction, r.attackDurationAverage]), [
    ["#FIRST", 1, 40, 28, 68, 3, 100, 69, 106], ["#SECOND", 2, 30, 33, 63, 2, 90, 50, 106],
    ["#EMPTY", 3, 0, 0, 0, 0, null, null, null],
  ]);
  assert.equal(board.attacks.length, 2);
  assert(board.attacks.every((row) => row.armyShareCode === "u8x8" && row.battleType === "RANKED"));
  assert.equal(board.leagueTier.attackLimit, 30);
  assert.equal(calls.length, 1 + members.length);
  assert.deepEqual(calls.slice(1).map((path) => path.split("?playerTag=")[1]).sort(), members.map((m) => m.playerTag).sort());
});

test("missing member ledgers keep official totals and recover only matching archive evidence", async () => {
  const { options } = fixture({ missing: "#FIRST" });
  const board = await fetchTemporaryGroupDetails({ ...scope, token }, options);
  assert.equal(board.partial, true);
  assert.deepEqual([board.rows[0].attackTrophies, board.rows[0].defenseTrophies, board.rows[0].trophies], [null, null, 68]);
  const row = { id: "saved", playerTag: "#FIRST", opponentTag: "#OUTSIDE", timestamp: "2026-11-24T07:00:00Z",
    battleType: "RANKED", stars: 3, destruction: 100, trophies: 40 };
  const snapshots = { read(key) {
    assert.deepEqual(key, { groupTag: scope.groupTag, week: scope.week, seasonId });
    return { attacks: [row, { ...row, id: "other-week", timestamp: "2026-11-23T04:59:59Z" },
      { ...row, id: "other-mode", battleType: "LEGEND" }], defenses: [] };
  } };
  const restored = await fetchTemporaryGroupDetails({ ...scope, token }, { ...options, snapshots });
  assert.deepEqual([restored.rows[0].attackTrophies, restored.rows[0].defenseTrophies, restored.rows[0].trophies], [40, null, 68]);
  assert.equal(restored.attacks.filter((r) => r.playerTag === "#FIRST").length, 1);
});

test("expansion rejects changed week, season, group, or selected membership before reading the rest of the roster", async () => {
  for (const [input, settings, count] of [
    [{ ...scope, week: "2026-11-16" }, {}, 0],
    [{ ...scope, seasonId: seasonId + 1 }, {}, 1],
    [scope, { profile: { currentLeagueGroupTag: "#MOVED", previousLeagueGroupTag: scope.groupTag, previousLeagueSeasonId: seasonId } }, 1],
    [scope, { profile: { leagueTier: { id: 105000036 } } }, 1],
    [scope, { roster: [members[0]] }, 2],
  ]) {
    const { options, calls } = fixture(settings);
    await assert.rejects(fetchTemporaryGroupDetails({ ...input, token }, options), /重新查询/);
    assert.equal(calls.length, count);
  }
});

test("temporary group cache shares loads between opens, enforces the verified player and invalidates changed standings", async () => {
  let clock = now.getTime();
  let calls = 0;
  let fail = false;
  const rows = members.map((m, i) => ({ playerTag: m.playerTag, rank: i + 1, trophies: m.leagueTrophies, attackCount: m.attackWinCount }));
  const preview = (playerTag) => ({ battleViews: { playerTag }, weeklyLeaderboard: { ...scope, rows } });
  const service = createTemporaryGroupService({
    now: () => new Date(clock),
    collect: async () => {
      calls++;
      await new Promise(setImmediate);
      if (fail) throw new Error("temporary upstream failure");
      return { rows: structuredClone(rows), attacks: [], partial: false };
    },
  });
  await assert.rejects(service.fetch(scope, token), /重新查询/);
  service.remember(preview(scope.playerTag));
  const [a, b] = await Promise.all([service.fetch(scope, token), service.fetch({ ...scope, force: true }, token)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  const other = { ...scope, playerTag: "#FIRST" };
  await assert.rejects(service.fetch(other, token), /重新查询/);
  service.remember(preview("#FIRST"));
  assert.equal((await service.fetch(other, token)).battleViews.playerTag, "#FIRST");
  assert.equal(calls, 1);
  clock += 600_000;
  await service.fetch(other, token);
  rows[0].trophies++;
  service.remember(preview("#FIRST"));
  assert.equal((await service.fetch(other, token)).rows[0].trophies, 69);
  assert.equal(calls, 3);
  fail = true;
  await assert.rejects(service.fetch({ ...other, force: true }, token), /upstream/);
  fail = false;
  await service.fetch({ ...other, force: true }, token);
  assert.equal(calls, 5);
  const stale = service.fetch({ ...other, force: true }, token);
  service.reset();
  await assert.rejects(stale, /已切换/);
  await assert.rejects(service.fetch(other, token), /重新查询/);
});

test("a temporary group's ranking, gear and style chart share one load and their own valid sample sizes", async () => {
  let requests = 0;
  const rows = [
    { playerTag: "#FIRST", rank: 1, attackCount: 2 },
    { playerTag: scope.playerTag, rank: 2, attackCount: 1 },
  ];
  const lineup = { armyShareCode: "u8x8", playerTag: "#FIRST", stars: 3, destruction: 100 };
  const service = createTemporaryGroupService({ now: () => now, collect: async () => {
    requests++;
    return { ...scope, rows, partial: true, attacks: [
      { ...lineup, id: "complete" },
      { ...lineup, id: "no-stars", stars: null, destruction: null },
      { id: "no-army", playerTag: scope.playerTag, stars: 2, destruction: 85 },
    ] };
  } });
  service.remember({ battleViews: { playerTag: scope.playerTag }, weeklyLeaderboard: { ...scope, rows } });
  const board = await service.fetch(scope, token);
  assert.deepEqual(board.rows, rows);
  assert.equal(board.attacks.length, 2);
  assert.ok(board.attacks.every(battle => battle.army.troops.length && battle.strategy === "龙流"));
  const summary = board.metaReport;
  assert.equal(summary.groupTag, scope.groupTag);
  assert.equal(summary.week, scope.week);
  assert.equal(summary.total, 2);
  assert.equal(summary.telemetry.expectedAttacks, 3);
  assert.deepEqual(summary.rows.map(r => [r.name, r.count, r.scoredCount, r.threeStarCount, r.threeStarRate]),
    [["龙流", 2, 1, 1, 1]]);
  assert.equal((await service.fetch(scope, token)).metaReport, summary);
  assert.equal(requests, 1);
});

test("returning to a verified village can first expand its group after visiting another village", async () => {
  const other = { ...scope, playerTag: "#OTHER", groupTag: "#GROUP2" };
  const calls = [];
  const service = createTemporaryGroupService({ now: () => now, collect: async ({ playerTag, groupTag }) => {
    calls.push(groupTag);
    return { rows: [{ playerTag }], attacks: [], partial: false };
  } });
  function visit(input, members = [input.playerTag]) {
    service.remember({ battleViews: { playerTag: input.playerTag },
      weeklyLeaderboard: { ...input, rows: members.map(playerTag => ({ playerTag })) } });
  }
  visit(scope);
  visit(other);
  await service.fetch(other, token);
  await service.fetch(scope, token);
  await service.fetch(other, token);
  await service.fetch(scope, token);
  assert.deepEqual(calls, [other.groupTag, scope.groupTag]);
  // A verified membership cannot be reused after a move or an updated roster that excludes it.
  visit({ ...scope, groupTag: "#MOVED" });
  await assert.rejects(service.fetch(scope, token), /重新查询/);
  visit({ ...other, playerTag: "#NEW" });
  await assert.rejects(service.fetch(other, token), /重新查询/);
  service.remember({ battleViews: { playerTag: "#NEW" }, weeklyLeaderboard: null });
  await assert.rejects(service.fetch({ ...other, playerTag: "#NEW" }, token), /重新查询/);
});
