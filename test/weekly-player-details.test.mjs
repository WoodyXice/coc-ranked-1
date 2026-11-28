import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { weeklyPlayerBattleViews } from "../collector.mjs";
import { openDatabase } from "../desktop/database.mjs";
import { collectTemporaryPlayer } from "../desktop/service.mjs";

const week = "2026-11-23";
const playerTag = "#SELECTED";
const groupTag = "#WEEKLY";
const season = Date.parse(week + "T05:00:00Z") / 1000;
const attackArmy = "u8x110-10x12-3x7";
const defenseArmy = "u3x147";

function fixtureLogs(attack, total, recentCount) {
  const ledger = [];
  const recent = [];
  const first = Date.parse(attack ? "2026-11-24T06:00:00Z" : "2026-11-25T06:00:00Z");
  for (let i = 0; i < total; i++) {
    const time = first + i * 600_000;
    const withRecentDetail = i >= total - recentCount;
    const basic = {
      opponentPlayerTag: (attack ? "#DEF" : "#ATK") + i,
      stars: attack ? 3 : 2, destructionPercentage: attack ? 100 : 80, trophies: attack ? 40 : 12,
    };
    ledger.push({ ...basic, creationTime: new Date(time).toISOString(),
      armyShareCode: withRecentDetail ? "h2e22" : "u8x8" });
    if (withRecentDetail) recent.push({
      ...basic, battleType: "ranked", attack, opponentName: "对手" + i,
      battleTimestamp: new Date(time + 62_000).toISOString(), battleTime: 62,
      armyShareCode: attack ? attackArmy : defenseArmy,
    });
  }
  return { ledger, recent };
}

test("opening a weekly player shows and archives 22 attacks and 19 defenses when the personal API retained only 16 and 18", async context => {
  const attacks = fixtureLogs(true, 22, 16);
  const defenses = fixtureLogs(false, 19, 18);
  const routes = {
    "/v1/players/#SELECTED": { name: "Selected player", leagueTier: { id: 105000035 },
      currentLeagueSeasonId: season, currentLeagueGroupTag: groupTag },
    "/v1/players/#SELECTED/battlelog": { items: [...attacks.recent, ...defenses.recent] },
    [`/v1/leaguegroup/#WEEKLY/${season}?playerTag=#SELECTED`]: {
      members: [{ playerTag, leagueTrophies: 1108, attackWinCount: 22, attackLoseCount: 0,
        defenseWinCount: 19, defenseLoseCount: 0 }],
      attackLogs: attacks.ledger, defenseLogs: defenses.ledger,
    },
  };
  const requests = [];
  const input = { playerTag, token: "test-only-token" };
  const options = {
    now: new Date("2026-11-27T19:30:00Z"), requestIntervalMs: 0,
    fetchImpl: async address => {
      const url = new URL(address);
      const route = decodeURIComponent(url.pathname + url.search);
      requests.push(route);
      assert(Object.hasOwn(routes, route), route);
      return Response.json(routes[route]);
    },
  };
  const dir = await mkdtemp(join(tmpdir(), "coc-weekly-details-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "fixture.db");
  const db = openDatabase(path);
  let data;
  try {
    data = await collectTemporaryPlayer(input, { ...options, playerHistory: db.playerHistory });
  } finally {
    db.close();
  }
  assert.deepEqual(requests.sort(), Object.keys(routes).sort());
  assert.equal(data.weeklyLeaderboardStatus, "ready");
  const views = data.weeklyLeaderboard.battleViews;
  assert.equal(views.playerTag, playerTag);
  assert.deepEqual([views.standing.attackCount, views.standing.defenseCount, views.standing.trophies], [22, 19, 1108]);
  assert.deepEqual([data.recentCoverage.attacks.count, data.recentCoverage.defenses.count], [16, 18]);
  assert.equal(data.recentAttacks.length, 16);
  assert.equal(data.historySaved, true);
  for (const [rows, count, withDetail, recentArmy, strategy, trophies] of [
    [views.attacks, 22, 16, attackArmy, "根蔓武神", 880], [views.defenses, 19, 18, defenseArmy, "超级大雪怪", 228],
  ]) {
    assert.equal(rows.length, count);
    assert.equal(new Set(rows.map(row => row.id)).size, count);
    assert.equal(rows.reduce((sum, row) => sum + row.trophyDelta, 0), trophies);
    assert.equal(rows.filter(row => row.armyShareCode === recentArmy && row.strategy === strategy
      && row.durationSeconds === 62 && row.opponentName.startsWith("对手")).length, withDetail);
    assert.equal(rows.filter(row => row.armyShareCode === "u8x8" && row.strategy === "龙流").length, count - withDetail);
  }
  assert.deepEqual(data.history.attacks.map(r => r.id), views.attacks.map(r => r.id));
  assert.deepEqual(data.history.defenses.map(r => r.id), views.defenses.map(r => r.id));
  const memory = await collectTemporaryPlayer(input, options);
  assert.deepEqual(memory.history, data.history);

  const reopened = openDatabase(path);
  try {
    // The stable official IDs supersede their rounded copies even across a restart.
    attacks.ledger[0].creationTime = attacks.ledger[0].creationTime.replace(".000Z", ".843Z");
    for (const boardAvailable of [true, false]) {
      const result = await collectTemporaryPlayer(input, { ...options, playerHistory: reopened.playerHistory,
        fetchImpl: async url => decodeURIComponent(new URL(url).pathname).startsWith("/v1/leaguegroup/") && !boardAvailable
          ? new Response(null, { status: 404 }) : options.fetchImpl(url) });
      const onDisk = reopened.playerHistory.read(playerTag);
      assert.deepEqual([onDisk.attacks.length, onDisk.defenses.length], [22, 19]);
      assert.deepEqual(result.history.attacks.map(row => row.id), onDisk.attacks.map(row => row.id));
      assert.equal(onDisk.attacks.some(row => row.timestamp.endsWith(".843Z")), true);
      assert.equal(result.recentCoverage.attacks.count, 16);
    }
  } finally {
    reopened.close();
  }
});

test("only same-week ranked details supplement partial ledgers and ambiguous matches leave official rows distinct", () => {
  const row = (id, timestamp, fields = {}) => ({
    id, timestamp, opponentTag: "#RIVAL", battleType: "RANKED", stars: 3, destruction: 100, ...fields,
  });
  const a = row("first", "2026-11-25T12:00:00Z");
  const b = row("second", "2026-11-25T12:04:00Z");
  const board = { week, battleViews: { playerTag, attacks: [a, b], defenses: [a],
    standing: { attackCount: 3, defenseCount: 2 } } };
  const result = weeklyPlayerBattleViews(board, {
    attacks: [row("ambiguous", "2026-11-25T12:02:00Z", { armyShareCode: attackArmy })],
    defenses: [
      row("more", "2026-11-23T05:00:00Z"), row("previous-week", "2026-11-23T04:59:59Z"),
      row("next-week", "2026-11-30T05:00:00Z"), row("wrong-mode", a.timestamp, { battleType: "LEGEND" }),
    ],
  });
  assert.deepEqual(result.attacks.map(({ id, armyShareCode }) => [id, armyShareCode]), [["second", undefined], ["first", undefined]]);
  assert.deepEqual(result.defenses.map(({ id }) => id), ["first", "more"]);
});

test("an ambiguous personal observation stays archived until a later official row resolves it", context => {
  const db = openDatabase(":memory:");
  context.after(() => db.close());
  const row = (id, time, extra) => ({ id, timestamp: time, opponentTag: "#REPEAT", battleType: "RANKED",
    stars: 2, destruction: 87, ...extra });
  const personal = row("personal", "2026-11-24T12:02:00Z", { durationSeconds: 90, armyShareCode: "u8x8" });
  const first = row("g1", "2026-11-24T12:00:00Z");
  const second = row("g2", "2026-11-24T12:04:00Z");
  const lastWeek = row("old", "2026-11-21T12:02:00Z");
  const legend = { ...personal, id: "legend", battleType: "LEGEND" };
  db.playerHistory.merge(playerTag, { attacks: [personal, lastWeek, legend] });
  const board = { week, groupTag, seasonId: season,
    battleViews: { playerTag, attacks: [first, second], defenses: [], standing: { attackCount: 3, defenseCount: 0 } } };
  const firstRead = db.playerHistory.merge(playerTag, {}, "2026-11-25T12:10:00Z", board);
  assert.deepEqual(new Set(firstRead.attacks.map(r => r.id)), new Set(["g1", "g2", "old", "legend"]));
  const untouched = db.db.prepare("SELECT id FROM player_history WHERE player_tag = ? ORDER BY id").all(playerTag);
  assert.deepEqual(untouched.map(row => row.id), ["legend", "old", "personal"]);
  board.battleViews.attacks = [row("g3", "2026-11-24T12:02:40Z")];
  const resolved = db.playerHistory.merge(playerTag, {}, "2026-11-26T12:10:00Z", board);
  assert.deepEqual(new Set(resolved.attacks.map(r => r.id)), new Set(["g1", "g2", "g3", "old", "legend"]));
  assert.equal(resolved.attacks.find(r => r.id === "g3").durationSeconds, 90);
  assert.deepEqual(db.playerHistory.read("#UNRELATED"), { attacks: [], defenses: [] });
});
