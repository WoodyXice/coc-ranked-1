import assert from "node:assert/strict";
import test from "node:test";
import { fetchLegendLeaderboard, fetchLegendLocations, fetchTemporaryPlayer } from "../collector.mjs";

const mockToken = "fixture-developer-token";
const country = 32000056;
const globalPath = "/v1/locations/global/rankings/players?limit=200";
const localPath = `/v1/locations/${country}/rankings/players?limit=200`;
const playerTag = "#LEGENDA";
const playerPath = "/v1/players/%23LEGENDA";
const battleLogPath = playerPath + "/battlelog";
const tierId = 105000036;
const currentDate = new Date("2026-11-25T18:00:00Z");
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
  assert.deepEqual(calls.map(({ path }) => path), [playerPath, battleLogPath]);
});

test("temporary lookup for a weekly tier reads only this week's Ranked results and public profile", async () => {
  const { calls, options } = apiFixture({
    [playerPath]: { name: " Fixture weekly player ", townHallLevel: 18, trophies: 940, currentLeagueGroupTag: "#GROUP1",
      clan: { tag: "#CLAN1", name: " Fixture Clan " }, leagueTier: { id: 105000035 },
      legendStatistics: { currentSeason: { rank: 31, trophies: 5900 } } },
    [battleLogPath]: { items: [
      battleLogRow("20261123T045959.999Z", { battleType: "ranked", armyShareCode: "u10x132" }),
      battleLogRow("20261123T050000.000Z", { battleType: "ranked", battleTime: 135, armyShareCode: "u9x80" }),
      battleLogRow("20261124T070000.000Z", { attack: false, battleType: "ranked", battleTime: 154, armyShareCode: "u6x147" }),
      battleLogRow("20261125T070000.000Z", { battleType: "legend", armyShareCode: "u10x132" }),
      battleLogRow("20261125T070200.000Z", { battleType: "homeVillage" }),
      battleLogRow("20261126T010000.000Z", { battleType: "ranked" }),
    ] },
  });
  const result = await fetchTemporaryPlayer({ token: mockToken, playerTag }, { ...options, now: currentDate });
  assert.equal(result.period, "week");
  assert.equal(result.weekStart, "2026-11-23");
  assert.equal(result.leagueTier.attackLimit, 30);
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
  assert.deepEqual(calls.map(({ path }) => path), [playerPath, battleLogPath]);
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
  assert.deepEqual(missing.calls.map(({ path }) => path), [playerPath, battleLogPath]);

  const empty = apiFixture({ [playerPath]: profile, [battleLogPath]: { items: [] } });
  const nothingPlayed = await fetchTemporaryPlayer({ token: mockToken, playerTag }, { ...empty.options, now: currentDate });
  assert.equal(nothingPlayed.battleViews.logAvailable, true);
  assert.equal(nothingPlayed.battleViews.standing.attackCount, 0);
  assert.equal(nothingPlayed.battleViews.standing.defenseCount, 0);

  const unauthorized = apiFixture({ [playerPath]: profile, [battleLogPath]: new Response(null, { status: 403 }) });
  await assert.rejects(fetchTemporaryPlayer({ token: mockToken, playerTag }, unauthorized.options), { status: 403 });
});
