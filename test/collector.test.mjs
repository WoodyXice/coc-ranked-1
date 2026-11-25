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

function mockFetch({ attackTimes = times.roundedAttacks, defenseTime = times.roundedDefense } = {}) {
  return async (address) => {
    const url = new URL(address);
    const path = decodeURIComponent(url.pathname);
    if (path === `/v1/players/${playerTag}`) {
      return Response.json({ currentLeagueGroupTag: groupTag, currentLeagueSeasonId: seasonId });
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
