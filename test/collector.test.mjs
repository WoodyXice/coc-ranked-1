import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupedPlayerReport, fetchRankedReport } from "../collector.mjs";
import { openDatabase } from "../desktop/database.mjs";

const groupTag = "#MOCKG";
const playerTag = "#MOCK1";
const opponentTag = "#MOCK2";
const week = "2026-11-23";
const seasonId = Date.parse(week + "T05:00:00Z") / 1000;
const times = {
  fractionalAttacks: ["2026-11-24T18:00:05.126Z", "2026-11-24T18:00:49.761Z"],
  roundedAttacks: ["2026-11-24T18:00:05.000Z", "2026-11-24T18:00:50.000Z"],
  fractionalDefense: "2026-11-24T18:10:20.380Z",
  roundedDefense: "2026-11-24T18:10:20.000Z",
};
const attackArmyCodes = ["u9x80", "u10x132"];
const defenseArmyCode = "u6x147";
const members = [
  {
    playerTag, playerName: "Fixture Village", leagueTrophies: 85,
    attackWinCount: 2, attackLoseCount: 0, defenseWinCount: 1, defenseLoseCount: 0,
  },
  {
    playerTag: opponentTag, playerName: "Fixture Opponent", leagueTrophies: 0,
    attackWinCount: 0, attackLoseCount: 0, defenseWinCount: 0, defenseLoseCount: 0,
  },
];

function groupBattle(creationTime, defense = false) {
  return {
    opponentPlayerTag: opponentTag,
    opponentName: "Fixture Opponent",
    stars: defense ? 1 : 2,
    destructionPercentage: defense ? 73 : 89,
    trophies: defense ? 27 : 29,
    creationTime,
  };
}

function cachedBattle(timestamp, { defense = false, armyShareCode = "", ...details } = {}) {
  const attacker = defense ? opponentTag : playerTag;
  const defender = defense ? playerTag : opponentTag;
  const { stars, destructionPercentage: destruction, trophies } = groupBattle(timestamp, defense);
  return {
    id: [attacker, defender, Date.parse(timestamp), stars, destruction].join("|"),
    playerTag: attacker,
    opponentTag: defender,
    timestamp,
    stars,
    destruction,
    trophies,
    armyShareCode,
    ...(armyShareCode ? { armySource: defense ? "defense" : "attack" } : {}),
    ...details,
  };
}

function mockFetch({
  attackTimes = times.roundedAttacks, defenseTime = times.roundedDefense,
  profile, leagueHistory, tierDetails, calls,
} = {}) {
  return async (address) => {
    const url = new URL(address);
    const path = decodeURIComponent(url.pathname);
    calls?.push(path);
    if (path === `/v1/players/${playerTag}`) {
      return Response.json({ currentLeagueGroupTag: groupTag, currentLeagueSeasonId: seasonId, ...profile });
    }
    if (path === `/v1/players/${playerTag}/leaguehistory`) {
      return leagueHistory ? Response.json({ items: leagueHistory }) : new Response(null, { status: 404 });
    }
    if (path.startsWith("/v1/leaguetiers/")) {
      const details = tierDetails?.[path.split("/").at(-1)];
      return details ? Response.json(details) : new Response(null, { status: 404 });
    }
    if (path === `/v1/leaguegroup/${groupTag}/${seasonId}`) {
      const selected = url.searchParams.get("playerTag") === playerTag;
      return Response.json({
        members,
        attackLogs: selected ? attackTimes.map((stamp) => groupBattle(stamp)) : [],
        defenseLogs: selected ? [groupBattle(defenseTime, true)] : [],
      });
    }
    if (path === `/v1/players/${playerTag}/battlelog` || path === `/v1/players/${opponentTag}/battlelog`) {
      return Response.json({ items: [] });
    }
    assert.fail(`Unexpected API request: ${path}`);
  };
}

function collectWithTierFixtures(options) {
  return fetchRankedReport({
    token: "fixture-developer-token", playerTag, week,
    includeBattleViews: true, requestIntervalMs: 0, fetchImpl: mockFetch(options),
  });
}

async function snapshotFixture(context, attacks, defenses) {
  const database = openDatabase(":memory:");
  context.after(() => database.close());
  const league = { groupTag, seasonId, week };
  database.snapshots.write(league, attacks, defenses);
  return {
    async fetch(options) {
      return fetchRankedReport({
        token: "fixture-developer-token", playerTag, week, snapshots: database.snapshots,
        includeBattleViews: true, requestIntervalMs: 0, fetchImpl: mockFetch(options),
      });
    },
    async saved() {
      return database.snapshots.read(league);
    },
  };
}

function assertCompleteStanding(result) {
  assert.equal(result.standings[0].attackCount, 2);
  assert.equal(result.standings[0].attackStars, 4);
  assert.equal(result.standings[0].attackDestruction, 89);
  assert.equal(result.standings[0].attackTrophies, 58);
  assert.equal(result.standings[0].defenseCount, 1);
  assert.equal(result.standings[0].defenseStars, 1);
  assert.equal(result.standings[0].defenseDestruction, 73);
  assert.equal(result.standings[0].defenseTrophies, 27);
  assert.equal(result.standings[0].trophies, 85);
}

function assertDistinctAttackHistory(result) {
  assert.equal(result.attacks.length, 2);
  assert.equal(result.attacks.filter((battle) => battle.army?.troops.length).length, 2);
  assert.deepEqual(result.attacks.map(({ armyShareCode }) => armyShareCode), [...attackArmyCodes].reverse());
  assert.equal(result.battleViews.attacks.length, 2);
  assert.equal(result.battleViews.defenses.length, 1);
  assert.equal(result.telemetry.collectedAttacks, 2);
  assert.equal(result.telemetry.expectedAttacks, 2);
  assertCompleteStanding(result);
  const member = result.groupBattles[result.standings[0].playerTag];
  assert.equal(member.attacks.length, result.standings[0].attackCount);
  assert.equal(member.defenses.length, result.standings[0].defenseCount);
  assert.equal(member.defenses[0].opponentTag, result.battleViews.defenses[0].opponentTag);
  assert.notEqual(member.defenses[0].opponentTag, result.standings[0].playerTag);
}

test("changing group timestamp precision preserves two real same-minute attacks", async (context) => {
  const oldAttacks = times.fractionalAttacks.map((stamp, index) => cachedBattle(stamp, {
    armyShareCode: attackArmyCodes[index], durationSeconds: [24, 38][index],
  }));
  const oldDefense = cachedBattle(times.fractionalDefense, { defense: true, armyShareCode: defenseArmyCode });
  const fixture = await snapshotFixture(context, oldAttacks, [oldDefense]);
  const result = await fixture.fetch();
  assertDistinctAttackHistory(result);
  assert(result.battleViews.attacks.every((battle) => battle.opponentName === "Fixture Opponent"));
  assert.deepEqual(result.attacks.map(({ durationSeconds }) => durationSeconds), [38, 24]);
  assert.equal(result.standings[0].attackDurationCount, 2);
  assert.equal(result.standings[0].attackDurationAverage, 31);
  assert.equal(result.battleViews.defenses[0].armyShareCode, defenseArmyCode);
  assert.equal((await fixture.saved()).attacks.length, 2);
  assert.equal(result.groupBattles[result.standings[0].playerTag].defenses[0].armyShareCode, defenseArmyCode);
});

test("an already doubled cache collapses both variants and preserves older defense note IDs", async (context) => {
  const fractional = times.fractionalAttacks.map((stamp, index) => cachedBattle(stamp, {
    armyShareCode: attackArmyCodes[index],
  }));
  const rounded = times.roundedAttacks.map((stamp, index) => cachedBattle(stamp, {
    durationSeconds: [24, 38][index], battleTimestamp: stamp,
  }));
  const defensePrecise = cachedBattle(times.fractionalDefense, { defense: true, armyShareCode: defenseArmyCode });
  const defenseRounded = cachedBattle(times.roundedDefense, {
    defense: true, durationSeconds: 167, battleTimestamp: times.roundedDefense,
  });
  const fixture = await snapshotFixture(context, [...rounded, ...fractional], [defenseRounded, defensePrecise]);
  const result = await fixture.fetch({ attackTimes: times.fractionalAttacks, defenseTime: times.fractionalDefense });
  assertDistinctAttackHistory(result);
  assert.deepEqual(result.attacks.map(({ durationSeconds }) => durationSeconds), [38, 24]);
  const [defense] = result.battleViews.defenses;
  assert.equal(defense.durationSeconds, 167);
  assert.equal(defense.armyShareCode, defenseArmyCode);
  assert.deepEqual(new Set([defense.id, ...(defense.previousIds ?? [])]), new Set([
    defensePrecise.id, defenseRounded.id,
  ]));

  const stored = await fixture.saved();
  assert.equal(stored.attacks.length, 2);
  assert.equal(stored.defenses.length, 1);
  const repeated = await fixture.fetch();
  assertDistinctAttackHistory(repeated);
  assert.deepEqual(repeated.attacks.map(({ durationSeconds }) => durationSeconds), [38, 24]);
  assert.deepEqual(new Set([repeated.battleViews.defenses[0].id, ...(repeated.battleViews.defenses[0].previousIds ?? [])]),
    new Set([defensePrecise.id, defenseRounded.id]));
});

test("a partial official ledger can still recover a distinct archived match", async (context) => {
  const oldAttacks = times.fractionalAttacks.map((stamp, index) => cachedBattle(stamp, {
    armyShareCode: attackArmyCodes[index],
  }));
  const oldDefense = cachedBattle(times.fractionalDefense, { defense: true, armyShareCode: defenseArmyCode });
  const fixture = await snapshotFixture(context, oldAttacks, [oldDefense]);
  const result = await fixture.fetch({ attackTimes: [times.roundedAttacks[0]] });
  assertDistinctAttackHistory(result);
  assert.equal((await fixture.saved()).attacks.length, 2);
});

test("a player opened from the group shows the same official totals and complete captured logs", async (context) => {
  const database = openDatabase(":memory:");
  context.after(() => database.close());
  const league = { groupTag, week, seasonId };
  const firstBattle = Date.parse("2026-11-24T09:00:00Z");
  const battleTime = (index) => new Date(firstBattle + index * 60_000).toISOString();
  const attacks = Array.from({ length: 30 }, (_, index) => cachedBattle(battleTime(index), {
    trophies: index < 3 ? 40 : 36, armyShareCode: index < 16 ? attackArmyCodes[0] : "",
  }));
  const defenses = Array.from({ length: 19 }, (_, index) => cachedBattle(battleTime(40 + index), {
    defense: true, trophies: index === 0 ? 19 : 17, armyShareCode: index < 11 ? defenseArmyCode : "",
  }));
  const standing = {
    playerTag, playerName: "Group player", rank: 3, attackCount: 30, defenseCount: 19,
    attackTrophies: 1092, defenseTrophies: 325, trophies: 1417, lastDefenseAt: defenses.at(-1).timestamp,
  };
  const exactStamp = new Date(Date.parse(defenses.at(-1).timestamp) + 200).toISOString();
  const morePreciseDefense = cachedBattle(exactStamp, { defense: true, durationSeconds: 146, trophies: 17 });
  const laterAttack = cachedBattle(battleTime(61));
  const laterDefense = cachedBattle(battleTime(60), { defense: true });
  const wrongWeekDefense = cachedBattle("2026-11-22T09:00:00Z", { defense: true });
  database.snapshots.write(league, [...attacks, laterAttack], [...defenses, morePreciseDefense, laterDefense, wrongWeekDefense]);
  database.snapshots.write({ ...league, groupTag: "#OTHER" }, [], [cachedBattle(battleTime(20), { defense: true })]);
  const raw = {
    ...league, source: "api", attacks,
    standings: [standing], battleViews: { playerTag: opponentTag, playerName: "Saved report owner", defenses: [] },
  };
  const result = await buildGroupedPlayerReport({
    raw, snapshots: database.snapshots, playerTag: "mock1", fetchedAt: battleTime(62),
  });
  assert.deepEqual(result.groupReport, { groupTag, week });
  assert.equal(result.weekStart, week);
  assert.deepEqual(result.battleViews.standing, standing);
  assert.equal(result.battleViews.attacks.length, 30);
  assert.equal(result.battleViews.defenses.length, 19);
  assert.equal(result.battleViews.telemetry.attacks.recorded, 30);
  assert.equal(result.battleViews.telemetry.attacks.withArmy, 16);
  assert.equal(result.battleViews.telemetry.defenses.recorded, 19);
  assert.equal(result.battleViews.telemetry.defenses.withArmy, 11);
  assert.equal(result.battleViews.defenseTrophyMode, "earned");
  assert.equal(result.battleViews.attacks.reduce((sum, battle) => sum + battle.trophyDelta, 0), 1092);
  assert.equal(result.battleViews.defenses.reduce((sum, battle) => sum + battle.trophyDelta, 0), 325);
  assert(result.battleViews.defenses.every((battle) => battle.opponentTag === opponentTag));
  assert.equal(result.battleViews.defenses[0].durationSeconds, 146);
  assert.deepEqual(result.battleViews.defenses[0].previousIds, [defenses.at(-1).id]);
});

test("a missing archive preserves official group totals and the selected player's saved rows", async () => {
  const attack = cachedBattle(times.fractionalAttacks[0]);
  const archivedDefense = cachedBattle(times.fractionalDefense, { defense: true, armyShareCode: defenseArmyCode });
  const standing = { playerTag, playerName: "Report owner", attackCount: 4, defenseCount: 2, trophies: 237,
    attackTrophies: null, defenseTrophies: 50 };
  const raw = {
    groupTag, seasonId, week, source: "api", attacks: [attack], standings: [standing],
    battleViews: { playerTag, defenses: [{ ...archivedDefense, opponentTag }] },
  };
  const result = await buildGroupedPlayerReport({
    raw, playerTag, fetchedAt: "2026-11-25T00:00:00Z",
    snapshots: { read() { throw Error("archive unreadable"); } },
  });
  assert.deepEqual(result.battleViews.standing, standing);
  assert.equal(result.battleViews.telemetry.attacks.expected, 4);
  assert.equal(result.battleViews.telemetry.defenses.expected, 2);
  assert.equal(result.battleViews.telemetry.defenses.logFailures, 1);
  assert.deepEqual(result.battleViews.attacks.map(({ id }) => id), [attack.id]);
  assert.deepEqual(result.battleViews.defenses.map(({ id, opponentTag: attacker, armyShareCode, trophies }) =>
    [id, attacker, armyShareCode, trophies]), [[archivedDefense.id, opponentTag, defenseArmyCode, 27]]);
});

test("group lookup requires a verified member and matching ranked week", async () => {
  const raw = { groupTag, seasonId, week, source: "api", standings: [{ playerTag }] };
  const snapshots = { read() { assert.fail("should not read an unrelated archive"); } };
  const options = { raw, snapshots, playerTag, fetchedAt: "2026-11-25T00:00:00Z" };
  assert.equal(await buildGroupedPlayerReport({ ...options, playerTag: opponentTag }), null);
  assert.equal(await buildGroupedPlayerReport({ ...options, raw: { ...raw, week: "2026-11-16" } }), null);
  assert.equal(await buildGroupedPlayerReport({ ...options, raw: { ...raw, source: "sample" } }), null);
  assert.equal(await buildGroupedPlayerReport({ ...options, raw: { ...raw, groupTag: "" } }), null);
});

test("an older report without stored group attacks can use its own season archive", async () => {
  const attack = cachedBattle(times.fractionalAttacks[0], { armyShareCode: attackArmyCodes[0] });
  const otherPlayerAttack = cachedBattle(times.fractionalDefense, { defense: true });
  const raw = {
    groupTag, seasonId, week, source: "api",
    standings: [{ playerTag, attackCount: 1, defenseCount: 0 }],
  };
  const snapshots = {
    read(league) {
      assert.deepEqual(league, { groupTag, seasonId, week });
      return { attacks: [attack, otherPlayerAttack], defenses: [] };
    },
  };
  const result = await buildGroupedPlayerReport({ raw, snapshots, playerTag, fetchedAt: "2026-11-25T00:00:00Z" });
  assert.deepEqual(result.battleViews.attacks.map(({ id }) => id), [attack.id]);
  assert.equal(result.battleViews.attacks[0].armyShareCode, attackArmyCodes[0]);
  assert.equal(result.battleViews.defenses.length, 0);
});

const officialIconSmall = "https://api-assets.clashofclans.com/leagues/72/fixture.png";
const officialIconMedium = "https://api-assets.clashofclans.com/leagues/144/fixture.png";

test("the current league badge and weekly limit come from the existing player fetch", async () => {
  const calls = [];
  const result = await collectWithTierFixtures({
    profile: { leagueTier: {
      id: 105000035,
      name: "Legend League II",
      iconUrls: { small: officialIconSmall, medium: officialIconMedium },
    } },
    calls,
  });
  assert.deepEqual(result.leagueTier, {
    id: 105000035, name: "传奇 II", iconUrl: officialIconSmall, attackLimit: 30,
  });
  assert.equal(result.standings[0].attackCount, 2);
  assert.equal(calls.some((path) => path.includes("/leaguetiers/") || path.includes("/leaguehistory")), false);
});

test("league icons reject untrusted host, credentials, explicit default port, and malformed URL", async () => {
  const result = await collectWithTierFixtures({
    profile: { leagueTier: {
      id: 105000033,
      name: "Electro League 33",
      iconUrls: {
        small: "https://api-assets.clashofclans.com.invalid/leagues/72/fixture.png",
        medium: "https://token@api-assets.clashofclans.com/leagues/144/fixture.png",
        tiny: "https://api-assets.clashofclans.com:443/leagues/36/fixture.png",
      },
    } },
    tierDetails: { 105000033: {
      id: 105000033,
      iconUrls: {
        small: "https://api-assets.clashofclans.com/leagues/72/%invalid.png",
        medium: "http://api-assets.clashofclans.com/leagues/144/fixture.png",
        tiny: "https://api-assets.clashofclans.com/leagues/36/fixture.png",
      },
    } },
  });
  assert.deepEqual(result.leagueTier, {
    id: 105000033, name: "Electro League 33", attackLimit: 18,
    iconUrl: "https://api-assets.clashofclans.com/leagues/36/fixture.png",
  });
});

const previousGroupProfile = {
  currentLeagueGroupTag: "#NEWGROUP",
  currentLeagueSeasonId: seasonId + 7 * 86_400,
  previousLeagueGroupTag: groupTag,
  previousLeagueSeasonId: seasonId,
  leagueTier: { id: 105000035, name: "Legend League II", iconUrls: { small: officialIconSmall } },
};

test("a previous group uses matching season/group history and its recorded battle limit", async () => {
  const calls = [];
  const result = await collectWithTierFixtures({
    profile: previousGroupProfile,
    leagueHistory: [
      { leagueSeasonId: seasonId, leagueGroupTag: "#WRONG", leagueTierId: 105000033, maxBattles: 18 },
      { leagueSeasonId: seasonId, leagueTierId: 105000035, maxBattles: 30 },
      { leagueSeasonId: seasonId, leagueGroupTag: groupTag, leagueTierId: 105000034, maxBattles: 22 },
    ],
    tierDetails: { 105000034: { id: 105000034, name: "Legend League III", iconUrls: { medium: officialIconMedium } } },
    calls,
  });
  assert.deepEqual(result.leagueTier, {
    id: 105000034, name: "传奇 III", iconUrl: officialIconMedium, attackLimit: 22,
  });
  assert.equal(calls.includes("/v1/leaguetiers/105000034"), true);
  assert.equal(calls.includes("/v1/leaguetiers/105000035"), false);
});

test("unavailable optional league endpoints preserve the battle report", async () => {
  const noHistory = await collectWithTierFixtures({ profile: previousGroupProfile });
  assert.equal(noHistory.leagueTier, null);
  assertCompleteStanding(noHistory);

  const noBadge = await collectWithTierFixtures({
    profile: previousGroupProfile,
    leagueHistory: [{ leagueSeasonId: seasonId, leagueTierId: 105000034 }],
  });
  assert.deepEqual(noBadge.leagueTier, { id: 105000034, name: "传奇 III", iconUrl: null, attackLimit: 24 });
  assertCompleteStanding(noBadge);
});

test("Legend I can show a badge without assigning a weekly attack limit", async () => {
  const result = await collectWithTierFixtures({
    profile: { currentLeagueGroupTag: "#0", leagueTier: {
      id: 105000036, name: "Legend League I", iconUrls: { small: officialIconSmall },
    } },
  });
  assert.deepEqual(result.leagueTier, {
    id: 105000036, name: "传奇 I", iconUrl: officialIconSmall, attackLimit: null,
  });
  assert.equal(result.battleViews.personalOnly, true);
  assert.deepEqual(result.standings, []);  assert.equal(result.groupBattles, undefined);
});
