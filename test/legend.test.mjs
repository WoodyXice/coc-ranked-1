import assert from "node:assert/strict";
import test from "node:test";
import { createLegendBattleLogCollector, fetchLegendLeaderboard, fetchLegendLocations, fetchTemporaryPlayer, mergePlayerHistory } from "../collector.mjs";

const mockToken = "fixture-developer-token";
const country = 32000056;
const globalPath = "/v1/locations/global/rankings/players?limit=200";
const localPath = `/v1/locations/${country}/rankings/players?limit=200`;
const playerTag = "#LEGENDA";
const playerPath = "/v1/players/%23LEGENDA";
const battleLogPath = playerPath + "/battlelog";
const tierId = 105000036;
const currentDate = new Date("2026-11-25T18:00:00Z");
const currentLeagueSeason = Date.parse("2026-11-23T05:00:00Z") / 1000;
const currentLeagueGroup = "#GROUP1";
const currentLeaguePath = `/v1/leaguegroup/%23GROUP1/${currentLeagueSeason}?playerTag=%23LEGENDA`;
const legendTier = {
  id: tierId, name: "Legend League I",
  iconUrls: { small: "https://api-assets.clashofclans.com/leagues/72/fixture.png" },
};

function apiFixture(routes) {
  const calls = [];
  const options = {
    requestIntervalMs: 0,
    fetchImpl: async (address, settings) => {
      const url = new URL(address);
      const path = url.pathname + url.search;
      calls.push({ origin: url.origin, path, authorization: settings.headers.Authorization, redirect: settings.redirect });
      if (!Object.hasOwn(routes, path)) return new Response(null, { status: 404 });
      const body = routes[path];
      return body instanceof Response ? body : Response.json(body);
    },
  };
  return { calls, options };
}

test("the live global board filters explicit Legend I metadata and preserves official ranks", async () => {
  const { calls, options } = apiFixture({
    [globalPath]: { items: [
      { rank: 7, tag: "#SEVEN", trophies: 5950, leagueTier: legendTier },
      { rank: 1, tag: "#LOWER", name: "Lower tier", trophies: 6005, leagueTier: { id: tierId - 1 } },
      { rank: 2, tag: "#NOINFO", name: "Unknown tier", trophies: 6000 },
      { rank: 3, previousRank: 4, tag: playerTag, name: " Test Legend ", trophies: 5980, townHallLevel: 18,
        clan: { name: " Fixture Clan ", tag: "#CLAN1", badgeUrls: {} }, leagueTier: legendTier },
      { rank: 8, tag: "#SEVEN", name: "Duplicate entry", trophies: 5980, leagueTier: legendTier },
      { rank: 0, tag: "#BADRANK", trophies: 6000, leagueTier: legendTier },
    ] },
  });
  const result = await fetchLegendLeaderboard({ token: mockToken }, options);
  assert.equal(result.location, "global");
  assert.equal(result.hasTierData, true);
  assert.equal(Number.isFinite(Date.parse(result.fetchedAt)), true);
  assert.deepEqual(result.rows, [
    { rank: 3, previousRank: 4, playerTag, playerName: "Test Legend", trophies: 5980,
      townHallLevel: 18, clanName: "Fixture Clan", clanTag: "#CLAN1" },
    { rank: 7, previousRank: null, playerTag: "#SEVEN", playerName: "#SEVEN", trophies: 5950,
      townHallLevel: null, clanName: "", clanTag: "" },
  ]);
  assert.deepEqual(calls, [{
    origin: "https://api.clashofclans.com", path: globalPath, authorization: `Bearer ${mockToken}`, redirect: "error",
  }]);
});

test("a legacy local board remains distinguishable when no official tier is available", async () => {
  const { calls, options } = apiFixture({
    [localPath]: { items: [
      { rank: 5, previousRank: 0, tag: "#LEGEND5", name: "Fifth", trophies: 5950, leagueTier: null },
      { rank: 1, tag: "#LEGEND1", name: "First", trophies: 6100 },
    ] },
  });
  const result = await fetchLegendLeaderboard({ token: mockToken, location: String(country) }, options);
  assert.equal(result.location, country);
  assert.equal(result.hasTierData, false);
  assert.deepEqual(result.rows.map(({ rank, playerTag }) => [rank, playerTag]), [[1, "#LEGEND1"], [5, "#LEGEND5"]]);
  assert.equal(result.rows[1].previousRank, null);
  assert.deepEqual(calls.map(({ path }) => path), [localPath]);
});

test("requested ranking ranges use official ranks and accept an exhausted first page", async () => {
  for (const limit of [37, 237, 863, 1000, 2000, 10000, 12345]) {
    const path = `/v1/locations/global/rankings/players?limit=${limit}`;
    const item = (rank) => ({ rank, tag: `#R${rank}`, trophies: 5000 });
    const { calls, options } = apiFixture({ [path]: { items: [item(limit + 1), item(1), item(limit)] } });
    const board = await fetchLegendLeaderboard({ token: mockToken, limit }, options);
    assert.deepEqual(board.rows.map(row => row.rank), [1, limit]);
    assert.equal(board.requestedLimit, limit);
    assert.equal(board.paginationInterrupted, false);
    assert.equal(calls.length, 1);
  }
  const { calls, options } = apiFixture({});
  for (const limit of [null, 0, -2, 3.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "1000"]) {
    await assert.rejects(fetchLegendLeaderboard({ token: mockToken, limit }, options), { status: 400 });
  }
  assert.equal(calls.length, 0);
});

test("ranking pagination follows opaque official cursors across short pages and filters tiers globally", async () => {
  const path = "/v1/locations/global/rankings/players?limit=1000";
  const next = path + "&after=ab%2B%2F%3D%26x";
  const item = (rank, section) => ({ rank, tag: `#R${rank}`, trophies: 5010, leagueTier: section });
  const { calls, options } = apiFixture({
    [path]: { items: [item(1), item(2)], paging: { cursors: { after: "ab+/=&x" } } },
    [next]: { items: [item(2, legendTier), item(3, legendTier)], paging: { cursors: { after: "last" } } },
    [path + "&after=last"]: { items: [item(3, legendTier), item(4, legendTier)] },
  });
  const board = await fetchLegendLeaderboard({ token: mockToken, limit: 1000 }, options);
  assert.deepEqual(calls.map(call => call.path), [path, next, path + "&after=last"]);
  assert.equal(board.hasTierData, true);
  assert.equal(board.paginationInterrupted, false);
  assert.deepEqual(board.rows.map(row => row.rank), [2, 3, 4]);
});

test("a rejected large page falls back to paged requests and keeps the requested rank ceiling", async () => {
  const large = "/v1/locations/global/rankings/players?limit=10000";
  const entry = rank => ({ rank, tag: "#R" + rank, trophies: 5000 });
  const { calls, options } = apiFixture({
    [large]: new Response(null, { status: 400 }),
    [globalPath]: { items: [entry(1)], paging: { cursors: { after: "p2" } } },
    [globalPath + "&after=p2"]: { items: [entry(10000)], paging: { cursors: { after: "unused" } } },
  });
  const board = await fetchLegendLeaderboard({ token: mockToken, limit: 10000 }, options);
  assert.deepEqual(calls.map(call => call.path), [large, globalPath, globalPath + "&after=p2"]);
  assert.deepEqual(board.rows.map(row => row.rank), [1, 10000]);
  assert.equal(board.requestedLimit, 10000);
});

test("ten thousand distinct ranked players are collected from fifty server-sized pages", async () => {
  const path = "/v1/locations/global/rankings/players?limit=10000";
  const routes = {};
  for (let page = 0; page < 50; page++) {
    const items = Array.from({ length: 200 }, (_, index) => {
      const rank = page * 200 + index + 1;
      return { rank, tag: `#R${rank}`, trophies: 5000, leagueTier: legendTier };
    });
    routes[path + (page ? "&after=p" + page : "")] = {
      items, paging: { cursors: { after: "p" + (page + 1) } },
    };
  }
  const { calls, options } = apiFixture(routes);
  const result = await fetchLegendLeaderboard({ token: mockToken, limit: 10000 }, options);
  assert.equal(result.rows.length, 10000);
  assert.equal(result.rows.at(-1).playerTag, "#R10000");
  assert.equal(result.paginationInterrupted, false);
  assert.equal(calls.length, 50);
});

test("failed, nonadvancing or repeated cursor pages leave verified rows visible and mark the interruption", async () => {
  const path = "/v1/locations/global/rankings/players?limit=2000";
  const entry = rank => ({ rank, tag: "#R" + rank, trophies: 5000 });
  for (const [second, expected] of [
    [new Response(null, { status: 404 }), [1]], [{ bad: true }, [1]],
    [{ items: [entry(1)], paging: { cursors: { after: "new-cursor" } } }, [1]],
    [{ items: [entry(2)], paging: { cursors: { after: "page2" } } }, [1, 2]],
  ]) {
    const { calls, options } = apiFixture({
      [path]: { items: [entry(1)], paging: { cursors: { after: "page2" } } },
      [path + "&after=page2"]: second,
    });
    const board = await fetchLegendLeaderboard({ token: mockToken, limit: 2000 }, options);
    assert.deepEqual(board.rows.map(row => row.rank), expected);
    assert.equal(board.paginationInterrupted, true);
    assert.equal(calls.length, 2);
  }
});

test("the location list returns only official countries and safe public fields", async () => {
  const locationPath = "/v1/locations";
  const { calls, options } = apiFixture({
    [locationPath]: { items: [
      { id: country, name: " Fixture Country ", isCountry: true, countryCode: "cn", extra: "omit" },
      { id: country, name: "Duplicate", isCountry: true, countryCode: "CN" },
      { id: 32000057, name: "Continent", isCountry: false },
      { id: 32000058, name: "Malformed country flag", isCountry: "true" },
      { id: 32000059, name: "Unspecified ISO code", isCountry: true, countryCode: "ZZ\n" },
      { id: "https://invalid.example", name: "Invalid ID", isCountry: true, countryCode: "AA" },
    ] },
  });
  assert.deepEqual(await fetchLegendLocations({ token: mockToken }, options), [
    { id: country, name: "Fixture Country", countryCode: "CN" },
    { id: 32000059, name: "Unspecified ISO code", countryCode: "" },
  ]);
  assert.deepEqual(calls.map(({ path }) => path), [locationPath]);
});

test("leaderboard options and malformed upstream responses produce client-safe errors", async () => {
  const { calls, options } = apiFixture({
    [globalPath]: { value: [] },
    [localPath]: { items: [{ name: "No rank, tag or trophies" }] },
    "/v1/locations": { items: "unsupported" },
  });
  for (const location of [0, -1, 2_147_483_648, "global\n", "32000056\n", "../global", "3e4"]) {
    await assert.rejects(fetchLegendLeaderboard({ token: mockToken, location }, options), { status: 400 });
  }
  await assert.rejects(fetchLegendLocations({}, options), { status: 400 });
  assert.equal(calls.length, 0);
  await assert.rejects(fetchLegendLeaderboard({ token: mockToken }, options), { status: 502, message: /传奇排行榜/ });
  await assert.rejects(fetchLegendLeaderboard({ token: mockToken, location: country }, options), { status: 502, message: /传奇排行榜/ });
  await assert.rejects(fetchLegendLocations({ token: mockToken }, options), { status: 502, message: /排行榜地区/ });
  await assert.rejects(fetchLegendLeaderboard({ token: mockToken, location: 888 }, options), { status: 404, message: /地区的排行榜/ });
});

function battleLogRow(timestamp, options = {}) {
  return {
    battleType: "legend", attack: true, opponentPlayerTag: "#OPPONENT", opponentName: "Fixture opponent",
    battleTimestamp: timestamp, stars: 2, destructionPercentage: 80, ...options,
  };
}

test("Legend board collectors request battle logs only and recover archived Legend battles without double counting", async () => {
  const rounded = "20261124T051600.000Z";
  const { calls, options } = apiFixture({
    [battleLogPath]: { items: [
      battleLogRow(rounded),
      battleLogRow(rounded, { battleType: "ranked" }),
      battleLogRow("20261126T050000.000Z"),
      battleLogRow("20261125T060000.000Z", { attack: false, trophies: -13 }),
      battleLogRow("20261125T060000.000Z", { stars: "invalid" }),
    ] },
    "/v1/players/%23LOCKED/battlelog": new Response(null, { status: 403 }),
  });
  const collect = createLegendBattleLogCollector({ token: mockToken }, { ...options, now: currentDate });
  const archived = {
    id: "archived", battleType: "LEGEND", opponentTag: "#OPPONENT", timestamp: "2026-11-24T05:15:59.801Z",
    stars: 2, destruction: 80, trophies: 26, armyShareCode: "u9x80", armySource: "attack",
  };
  const archive = { attacks: [archived, { ...archived, id: "ranked", battleType: "RANKED" }] };
  const result = await collect({ playerTag: "legenda", archive });
  assert.deepEqual(result.attacks.map(({ battleType, id, armyShareCode, trophyDelta }) =>
    [battleType, id, armyShareCode, trophyDelta]), [["LEGEND", "archived", "u9x80", 26]]);
  assert.equal(result.attacks[0].timestamp, archived.timestamp);
  assert.equal(result.defenses[0].trophyDelta, -13);
  assert.equal(result.attacks[0].previousIds.length, 1);

  const missing = await collect({ playerTag: "#MISSING", archive });
  assert.deepEqual(missing.attacks.map(({ id }) => id), ["archived"]);
  await assert.rejects(collect({ playerTag: "#LOCKED" }), { status: 403 });
  await assert.rejects(collect({ playerTag: "../injected" }), { status: 400 });
  assert.deepEqual(calls.map(({ path }) => path), [battleLogPath, "/v1/players/%23MISSING/battlelog", "/v1/players/%23LOCKED/battlelog"]);
});

test("an arbitrary Legend I player gets strictly Legend logs across week reset with precision dedup", async () => {
  const priorWeek = "20261123T045900.000Z";
  const rounded = "20261123T051600.000Z";
  const precise = "20261123T051559.801Z";
  const later = "20261124T060100.000Z";
  const { calls, options } = apiFixture({
    [playerPath]: { name: "Fixture Legend", trophies: 5888, leagueTier: legendTier,
      legendStatistics: { currentSeason: { rank: 31, trophies: 5900 } } },
    [battleLogPath]: { items: [
      battleLogRow(priorWeek, { battleTime: 140, armyShareCode: "u6x147" }),
      battleLogRow(rounded, { battleTime: 168 }),
      battleLogRow(precise, { armyShareCode: "u9x80" }),
      battleLogRow(precise),
      battleLogRow(later, { attack: false, battleTime: 158, armyShareCode: "u10x132" }),
      battleLogRow(later, { battleType: "ranked" }),
      battleLogRow(later, { battleType: "homeVillage" }),
      battleLogRow("missing", { attack: false }),
    ] },
  });
  const data = await fetchTemporaryPlayer({ token: mockToken, playerTag: "legenda" }, { ...options, now: currentDate });
  const { battleViews } = data;
  assert.equal(data.period, "retained");
  assert.equal(data.weekStart, "2026-11-23");
  assert.equal(data.leagueTier.id, tierId);
  assert.equal(data.leagueTier.attackLimit, null);
  assert.equal(Number.isFinite(Date.parse(data.fetchedAt)), true);
  assert.equal(battleViews.playerTag, playerTag);
  assert.equal(battleViews.playerName, "Fixture Legend");
  assert.equal(battleViews.currentLegendRank, 31);
  assert.equal(battleViews.currentLegendTrophies, 5900);
  assert.equal(battleViews.defenseTrophyMode, "lost");
  assert.equal(battleViews.logAvailable, true);
  assert.equal(battleViews.attacks.length, 2);
  assert.equal(battleViews.attacks[0].timestamp, "2026-11-23T05:15:59.801Z");
  assert.equal(battleViews.attacks[0].durationSeconds, 168);
  assert.equal(battleViews.attacks[0].army.troops[0].name, "Super Bowler");
  assert.equal(battleViews.attacks[0].trophyDelta, 26);
  assert.equal(battleViews.attacks[0].previousIds.length, 1);
  assert.equal(battleViews.attacks[1].timestamp, "2026-11-23T04:59:00.000Z");
  assert.equal(battleViews.defenses.length, 1);
  assert.equal(battleViews.defenses[0].trophyDelta, -26);
  assert.equal(battleViews.defenses[0].durationSeconds, 158);
  assert.equal(battleViews.telemetry.defenses.malformed, 1);
  assert.deepEqual(data.history.attacks.map(({ battleType }) => battleType), ["RANKED", "LEGEND", "LEGEND"]);
  assert.deepEqual(calls.map(({ path }) => path), [playerPath, battleLogPath]);
});

test("temporary lookup keeps the weekly summary and exposes history from both competitive modes", async () => {
  const { calls, options } = apiFixture({
    [playerPath]: { name: " Fixture weekly player ", townHallLevel: 18, trophies: 940, currentLeagueGroupTag: "#GROUP1",
      clan: { tag: "#CLAN1", name: " Fixture Clan " }, leagueTier: { id: 105000035 },
      legendStatistics: { currentSeason: { rank: 31, trophies: 5900 } } },
    [battleLogPath]: { items: [
      battleLogRow("20261123T045900.000Z", { battleType: "ranked", armyShareCode: "u10x132" }),
      battleLogRow("20261123T050000.000Z", { battleType: "ranked", battleTime: 135, armyShareCode: "u9x80" }),
      battleLogRow("20261124T070000.000Z", { attack: false, battleType: "ranked", battleTime: 154, armyShareCode: "u6x147" }),
      battleLogRow("20261124T070000.000Z", { attack: false, battleType: "legend", battleTime: 145, armyShareCode: "u10x132" }),
      battleLogRow("20261125T070000.000Z", { battleType: "legend", armyShareCode: "u10x132" }),
      battleLogRow("20261125T070200.000Z", { battleType: "homeVillage" }),
      battleLogRow("20261126T010000.000Z", { battleType: "ranked" }),
    ] },
  });
  const result = await fetchTemporaryPlayer({ token: mockToken, playerTag }, { ...options, now: currentDate });
  assert.equal(result.period, "week");
  assert.equal(result.weekStart, "2026-11-23");
  assert.equal(result.leagueTier.attackLimit, 30);
  assert.equal(result.weeklyLeaderboardStatus, "unavailable");
  assert.equal(result.weeklyLeaderboard, null);
  assert.deepEqual(result.profile, {
    playerTag, playerName: "Fixture weekly player", townHallLevel: 18, trophies: 940,
    clanName: "Fixture Clan", clanTag: "#CLAN1", currentGroupTag: "#GROUP1",
  });
  const { battleViews } = result;
  assert.equal(battleViews.currentLegendRank, undefined);
  assert.equal(battleViews.defenseTrophyMode, "earned");
  assert.deepEqual(battleViews.attacks.map((row) => [row.timestamp, row.trophyDelta]), [["2026-11-23T05:00:00.000Z", 26]]);
  assert.deepEqual(battleViews.defenses.map((row) => [row.battleType, row.trophyDelta]), [["RANKED", 14]]);
  assert.equal(battleViews.standing.rank, null);
  assert.equal(battleViews.standing.attackCount, 1);
  assert.equal(battleViews.standing.defenseTrophies, 14);
  assert.equal(battleViews.standing.trophies, 40);
  assert.deepEqual(result.history.attacks.map(({ battleType, timestamp }) => [battleType, timestamp]), [
    ["LEGEND", "2026-11-25T07:00:00.000Z"],
    ["RANKED", "2026-11-23T05:00:00.000Z"],
    ["RANKED", "2026-11-23T04:59:00.000Z"],
  ]);
  assert.deepEqual(new Map(result.history.defenses.map(({ battleType, trophyDelta }) => [battleType, trophyDelta])),
    new Map([["RANKED", 14], ["LEGEND", -26]]));
  assert.deepEqual(calls.map(({ path }) => path), [playerPath, battleLogPath]);
});

for (const [description, leagueId, attackLimit] of [
  ["Legend II", 105000035, 30],
  ["Legend III", 105000034, 24],
  ["Electro 33", 105000033, 18],
]) {
  test(`temporary ${description} lookup loads the official current group without requesting each member`, async () => {
    const groupBattle = (creationTime, options) => ({
      creationTime, opponentPlayerTag: "#OTHER2", opponentName: "Other member", stars: 3,
      destructionPercentage: 100, trophies: 40, armyShareCode: "u8x8", ...options,
    });
    const { options, calls } = apiFixture({
      [playerPath]: {
        name: "Fixture weekly player", trophies: 1500, leagueTier: { id: leagueId },
        currentLeagueGroupTag: currentLeagueGroup, currentLeagueSeasonId: currentLeagueSeason,
      },
      [battleLogPath]: { items: [
        battleLogRow("20261124T060000.000Z", { battleType: "ranked", armyShareCode: "u9x80" }),
      ] },
      [currentLeaguePath]: {
        members: [
          { playerTag: "#OTHER2", playerName: "Other member", leagueTrophies: 68, attackWinCount: 3, attackLoseCount: 0,
            defenseWinCount: 0, defenseLoseCount: 2, clanTag: " #clan1 ", clanName: " Fixture Clan " },
          { playerTag, leagueTrophies: 68, attackWinCount: 1, attackLoseCount: 0, defenseWinCount: 1, defenseLoseCount: 0 },
          { playerTag: "#OLDER", playerName: "Third", leagueTrophies: 0, attackWinCount: 0, attackLoseCount: 0,
            defenseWinCount: 0, defenseLoseCount: 0 },
        ],
        attackLogs: [
          groupBattle("20261123T045959.999Z"),
          groupBattle("20261123T050000.000Z"),
          groupBattle("20261126T050000.000Z"),
        ],
        defenseLogs: [groupBattle("20261124T074200.000Z", { stars: 1, destructionPercentage: 69, trophies: 28 })],
      },
    });
    const result = await fetchTemporaryPlayer({ token: mockToken, playerTag }, { ...options, now: currentDate });
    assert.equal(result.period, "week");
    assert.equal(result.groupReport, undefined);
    assert.equal(result.leagueTier.attackLimit, attackLimit);
    assert.equal(result.weeklyLeaderboardStatus, "ready");
    const board = result.weeklyLeaderboard;
    assert.deepEqual([board.groupTag, board.seasonId, board.week], [currentLeagueGroup, currentLeagueSeason, "2026-11-23"]);
    assert.deepEqual(board.rows.map(({ rank, playerTag, trophies, attackCount, defenseCount }) =>
      [rank, playerTag, trophies, attackCount, defenseCount]), [
      [1, "#OTHER2", 68, 3, 2],
      [2, playerTag, 68, 1, 1],
      [3, "#OLDER", 0, 0, 0],
    ]);
    assert.equal(board.rows[0].attackTrophies, null);
    assert.equal(board.rows[0].clanTag, "#CLAN1");
    assert.equal(board.rows[0].clanName, "Fixture Clan");
    assert.equal(board.rows[1].playerName, "Fixture weekly player");
    assert.equal(board.rows[1].attackTrophies, 40);
    assert.equal(board.rows[1].defenseTrophies, 28);
    assert.equal(board.battleViews.attacks[0].trophyDelta, 40);
    assert.equal(board.battleViews.defenses[0].trophyDelta, 28);
    assert.deepEqual(board.attacks.map(({ battleType, timestamp }) => [battleType, timestamp]), [
      ["RANKED", "2026-11-23T05:00:00.000Z"],
    ]);
    assert.equal(result.battleViews.standing.rank, 2);
    assert.equal(result.battleViews.attacks[0].armyShareCode, "u9x80");
    assert.equal(result.history.attacks.length, 1);
    assert.deepEqual(calls.map(({ path }) => path), [playerPath, battleLogPath, currentLeaguePath]);
  });
}

test("temporary lookup skips stale and previous weekly groups and keeps Legend I on the global board", async () => {
  const currentWeek = { currentLeagueGroupTag: currentLeagueGroup, currentLeagueSeasonId: currentLeagueSeason };
  const previousWeek = { previousLeagueGroupTag: "#GROUP2", previousLeagueSeasonId: currentLeagueSeason };
  for (const profile of [
    { ...previousWeek, leagueTier: { id: tierId - 1 } },
    { ...currentWeek, ...previousWeek, currentLeagueSeasonId: currentLeagueSeason - 7 * 86_400, leagueTier: { id: tierId - 2 } },
    { ...currentWeek, leagueTier: legendTier },
  ]) {
    const { options, calls } = apiFixture({ [playerPath]: profile, [battleLogPath]: { items: [] } });
    const result = await fetchTemporaryPlayer({ token: mockToken, playerTag }, { ...options, now: currentDate });
    assert.equal(result.weeklyLeaderboardStatus, "unavailable");
    assert.equal(result.weeklyLeaderboard, null);
    assert.deepEqual(calls.map(({ path }) => path), [playerPath, battleLogPath]);
  }
});

test("optional weekly-group failures leave the personal battlelog available", async () => {
  const profile = { currentLeagueGroupTag: currentLeagueGroup, currentLeagueSeasonId: currentLeagueSeason, leagueTier: { id: tierId - 1 } };
  for (const [group, status] of [
    [new Response(null, { status: 404 }), "unavailable"],
    [new Response(null, { status: 429 }), "error"],
    [new Response(null, { status: 500 }), "error"],
    [{ bad: "response" }, "error"],
    [{ members: [{ playerTag: "#OTHER2" }] }, "unavailable"],
  ]) {
    const { options, calls } = apiFixture({
      [playerPath]: profile, [currentLeaguePath]: group,
      [battleLogPath]: { items: [battleLogRow("20261124T060000.000Z", { battleType: "ranked" })] },
    });
    const result = await fetchTemporaryPlayer({ token: mockToken, playerTag }, { ...options, now: currentDate });
    assert.equal(result.weeklyLeaderboardStatus, status);
    assert.equal(result.weeklyLeaderboard, null);
    assert.equal(result.battleViews.standing.attackCount, 1);
    assert.equal(result.battleViews.standing.rank, null);
    assert.equal(result.history.attacks.length, 1);
    assert.deepEqual(calls.map(({ path }) => path), [playerPath, battleLogPath, currentLeaguePath]);
  }
});

test("an unknown tier requires recent current-week Legend evidence to use the retained-day view", async () => {
  const pastLegend = battleLogRow("20261123T045900.000Z", { armyShareCode: "u6x147" });
  const currentLegend = battleLogRow("20261124T070000.000Z", { attack: false, armyShareCode: "u10x132" });
  const olderRanked = battleLogRow("20261123T180000.000Z", { battleType: "ranked" });
  const latestRanked = battleLogRow("20261125T070000.000Z", { battleType: "ranked" });
  const lookup = (profile, items) => {
    const { options } = apiFixture({ [playerPath]: profile, [battleLogPath]: { items } });
    return fetchTemporaryPlayer({ token: mockToken, playerTag }, { ...options, now: currentDate });
  };

  const observed = await lookup({ trophies: 5123, currentLeagueGroupTag: "#0" }, [pastLegend, olderRanked, currentLegend]);
  assert.equal(observed.leagueTier, null);
  assert.equal(observed.period, "retained");
  assert.equal(observed.battleViews.currentLegendTrophies, null);
  assert.equal(observed.battleViews.attacks.length, 1);
  assert.equal(observed.battleViews.defenses[0].trophyDelta, -26);

  const oldOnly = await lookup({}, [pastLegend]);
  assert.equal(oldOnly.period, "week");
  assert.equal(oldOnly.battleViews.attacks.length, 0);
  assert.equal(oldOnly.battleViews.logAvailable, true);
  assert.equal(oldOnly.history.attacks[0].battleType, "LEGEND");

  const activeWeekly = await lookup({}, [currentLegend, latestRanked]);
  assert.equal(activeWeekly.period, "week");
  assert.equal(activeWeekly.battleViews.attacks[0].battleType, "RANKED");
  assert.equal(activeWeekly.battleViews.defenses.length, 0);

  const assignedWeekly = await lookup({ currentLeagueGroupTag: "#GROUP1" }, [olderRanked, currentLegend]);
  assert.equal(assignedWeekly.period, "week");
  assert.equal(assignedWeekly.profile.currentGroupTag, "#GROUP1");
  assert.equal(assignedWeekly.battleViews.attacks.length, 1);
});

test("an unranked profile is still available when official logs are empty or unavailable", async () => {
  const profile = { name: "Unranked fixture", townHallLevel: 7, leagueTier: { id: 105000000 } };
  const missing = apiFixture({ [playerPath]: profile });
  const publicOnly = await fetchTemporaryPlayer({ token: mockToken, playerTag }, { ...missing.options, now: currentDate });
  assert.equal(publicOnly.profile.playerName, "Unranked fixture");
  assert.equal(publicOnly.profile.townHallLevel, 7);
  assert.equal(publicOnly.leagueTier.name, "未进入联赛");
  assert.equal(publicOnly.battleViews.logAvailable, false);
  assert.equal(publicOnly.battleViews.standing, null);
  assert.deepEqual(publicOnly.battleViews.attacks, []);
  assert.deepEqual(publicOnly.history, { attacks: [], defenses: [] });
  assert.deepEqual(missing.calls.map(({ path }) => path), [playerPath, battleLogPath]);

  const empty = apiFixture({ [playerPath]: profile, [battleLogPath]: { items: [] } });
  const nothingPlayed = await fetchTemporaryPlayer({ token: mockToken, playerTag }, { ...empty.options, now: currentDate });
  assert.equal(nothingPlayed.battleViews.logAvailable, true);
  assert.equal(nothingPlayed.battleViews.standing.attackCount, 0);
  assert.equal(nothingPlayed.battleViews.standing.defenseCount, 0);

  const unauthorized = apiFixture({ [playerPath]: profile, [battleLogPath]: new Response(null, { status: 403 }) });
  await assert.rejects(fetchTemporaryPlayer({ token: mockToken, playerTag }, unauthorized.options), { status: 403 });
});

test("stored player history keeps old battles and merges rounded copies within the same mode and direction", () => {
  const base = { opponentTag: "#OPPONENT", stars: 2, destruction: 80 };
  const day = "2026-11-24T07:00:00";
  const recentDefense = {
    ...base, id: "recent-precise", battleType: "RANKED", timestamp: day + ".163Z",
    trophies: 14, trophyDelta: 14, trophySource: "calculated", durationSeconds: 154,
  };
  const archivedDefense = {
    ...base, id: "archive-rounded", battleType: "RANKED", timestamp: day + ".000Z",
    trophies: 15, trophySource: "group", armyShareCode: "u9x80", armySource: "attack",
  };
  const otherMode = {
    ...recentDefense, battleType: "LEGEND", trophies: 26, trophyDelta: -26, trophySource: "api",
  };
  const pastAttack = {
    ...base, id: "archive-previous-week", battleType: "RANKED", timestamp: "2026-11-22T09:00:00Z", trophies: 26,
  };
  const history = mergePlayerHistory(
    { attacks: [], defenses: [recentDefense, otherMode] },
    { attacks: [pastAttack], defenses: [archivedDefense] },
  );
  assert.deepEqual(history.attacks.map(({ id, trophyDelta }) => [id, trophyDelta]), [[pastAttack.id, 26]]);
  assert.equal(history.defenses.length, 2);
  const grouped = history.defenses.find(({ battleType }) => battleType === "RANKED");
  assert.equal(grouped.id, recentDefense.id);
  assert.equal(grouped.timestamp, recentDefense.timestamp);
  assert.equal(grouped.trophyDelta, 15);
  assert.equal(grouped.trophySource, "group");
  assert.equal(grouped.durationSeconds, 154);
  assert.equal(grouped.army.troops[0].name, "Super Bowler");
  assert.deepEqual(grouped.previousIds, [archivedDefense.id]);
  assert.equal(history.defenses.find(({ battleType }) => battleType === "LEGEND").trophyDelta, -26);
});
