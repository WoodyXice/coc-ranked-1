import assert from "node:assert/strict";
import test from "node:test";
import { fetchRankedReport } from "../collector.mjs";
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
