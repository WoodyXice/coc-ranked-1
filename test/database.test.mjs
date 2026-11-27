import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../desktop/database.mjs";
import { createDefenseNoteStore } from "../desktop/defense-notes.mjs";
import { importLegacyJson } from "../desktop/legacy-import.mjs";
import { cachedReport, sampleReport } from "../desktop/service.mjs";

const league = { groupTag: "#MOCKG", seasonId: 1790000000, week: "2026-11-23" };
const battle = (id, extra = {}) => ({
  id, playerTag: "#MOCK1", opponentTag: "#MOCK2", timestamp: "2026-11-24T18:00:05.000Z", stars: 2, ...extra,
});

const personalBattle = (id, timestamp, fields = {}) => ({
  id, timestamp, opponentTag: "#MOCK2", stars: 2, destruction: 80, trophies: 26, battleType: "RANKED", ...fields,
});

test("partially overlapping player history is preserved across a database reopen", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coc-ranked-history-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "coc-ranked.db");
  const earliest = personalBattle("older", "2026-11-22T04:00:00.000Z");
  const rounded = personalBattle("rounded", "2026-11-24T04:00:00.000Z", {
    armyShareCode: "u9x80", gameToken: "fixture-excluded", note: "fixture-private-note",
  });
  const precise = personalBattle("precise", "2026-11-24T04:00:00.300Z", { durationSeconds: 173 });
  const latestDefense = personalBattle("recent", "2026-11-25T06:00:00.000Z", { battleType: "LEGEND" });

  const initial = openDatabase(file);
  try {
    initial.playerHistory.merge("#MOCK1", { attacks: [earliest, rounded], defenses: [] });
    assert.deepEqual(initial.playerHistory.merge("#MOCK9", {}), { attacks: [], defenses: [] });
    const data = initial.db.prepare("SELECT data FROM player_history WHERE id = 'rounded'").get().data;
    assert.equal(JSON.parse(data).armyShareCode, "u9x80");
    assert.doesNotMatch(data, /"army"|"gameToken"|"note"/);
  } finally {
    initial.close();
  }

  const reopened = openDatabase(file);
  try {
    const newer = { attacks: [precise], defenses: [latestDefense] };
    const result = reopened.playerHistory.merge("mock1", newer, "2026-11-25T12:00:00Z");
    assert.deepEqual(result.attacks.map(({ id }) => id), ["precise", "older"]);
    assert.equal(result.attacks[0].durationSeconds, 173);
    assert.equal(result.attacks[0].army.troops[0].name, "Super Bowler");
    assert.deepEqual(result.attacks[0].previousIds, ["rounded"]);
    assert.deepEqual(result.defenses.map(({ id, trophyDelta }) => [id, trophyDelta]), [["recent", -26]]);
    assert.equal(reopened.db.prepare("SELECT count(*) AS n FROM player_history").get().n, 3);
    assert.deepEqual(reopened.playerHistory.merge("#MOCK1", newer), result);
    assert.deepEqual(reopened.playerHistory.merge("#MOCK9", {}), { attacks: [], defenses: [] });
  } finally {
    reopened.close();
  }
});

test("snapshots round-trip and a later write replaces superseded battles", (context) => {
  const database = openDatabase(":memory:");
  context.after(() => database.close());
  const attacks = [battle("a1", { army: { troops: [1, 2] } }), battle("a2")];
  const defenses = [battle("d1", { playerTag: "#MOCK2", opponentTag: "#MOCK1" })];

  database.snapshots.write(league, attacks, defenses);
  assert.deepEqual(database.snapshots.read(league), { attacks, defenses });
  assert.deepEqual(database.snapshots.read({ ...league, seasonId: 1 }), { attacks: [], defenses: [] });

  database.snapshots.write(league, [battle("a1-merged", { previousIds: ["a1"] }), attacks[1]], []);
  const { attacks: saved, defenses: savedDefenses } = database.snapshots.read(league);
  assert.deepEqual(saved.map(({ id }) => id), ["a1-merged", "a2"]);
  assert.deepEqual(savedDefenses, []);
});

test("a failed write leaves the previous snapshot in place", (context) => {
  const database = openDatabase(":memory:");
  context.after(() => database.close());
  database.snapshots.write(league, [battle("a1")], []);
  const circular = battle("bad");
  circular.self = circular;
  assert.throws(() => database.snapshots.write(league, [battle("a2"), circular], []));
  assert.deepEqual(database.snapshots.read(league).attacks.map(({ id }) => id), ["a1"]);
});

test("legacy JSON files remain on disk and unreadable files can be retried without overwriting newer results", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coc-ranked-db-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotDir = join(directory, "ranked-snapshots");
  await mkdir(snapshotDir);
  const snapshotFile = join(snapshotDir, "MOCKG-1790000000.json");
  const snapshotJson = JSON.stringify({ ...league, attacks: [battle("a1")], defenses: [battle("d1")] });
  await writeFile(snapshotFile, snapshotJson, "utf8");
  const unreadable = join(snapshotDir, "MOCKH-1790000000.json");
  const invalid = join(snapshotDir, "wrong-shape.json");
  const noteFile = join(directory, "defense-notes.json");
  const legacyNote = { playerTag: "#MOCK1", battleId: "d1", note: "Imported note" };
  await writeFile(unreadable, "{not json", "utf8");
  await writeFile(invalid, JSON.stringify({ attacks: "nope" }), "utf8");
  await writeFile(noteFile, JSON.stringify({ version: 1, notes: [
    legacyNote,
    { playerTag: "lowercase", battleId: "d1", note: "Invalid tag" },
  ] }), "utf8");

  const file = join(directory, "coc-ranked.db");
  const database = openDatabase(file);
  try {
    const result = importLegacyJson(database, directory);
    assert.equal(result.skipped, false);
    assert.equal(result.snapshots, 1);
    assert.equal(result.notes, 1);
    assert.equal(result.warnings.length, 3);
    assert.deepEqual(database.snapshots.read(league).attacks.map(({ id }) => id), ["a1"]);
    assert.deepEqual(database.snapshots.read(league).defenses.map(({ id }) => id), ["d1"]);
    const noteStore = createDefenseNoteStore(database.db);
    const view = { playerTag: "#MOCK1", defenses: [{ id: "d1" }] };
    const notes = await noteStore.withNotes(view);
    assert.equal(notes.defenses[0].note, "Imported note");

    // An incomplete import must not overwrite a newer capture, including a cleared note.
    database.snapshots.write(league, [battle("a1"), battle("a2")], []);
    const repairedLeague = { ...league, groupTag: "#MOCKH" };
    database.snapshots.write(repairedLeague, [battle("r1", { durationSeconds: 175 })], []);
    noteStore.save({ ...legacyNote, note: "" });
    await writeFile(unreadable, JSON.stringify({ ...repairedLeague, attacks: [battle("r1"), battle("r2")] }), "utf8");
    await rm(invalid);
    await writeFile(noteFile, JSON.stringify({ version: 1, notes: [legacyNote] }), "utf8");
    assert.deepEqual(importLegacyJson(database, directory), { skipped: false, snapshots: 1, notes: 0 });
    assert.equal(importLegacyJson(database, directory).skipped, true);
    assert.equal(database.snapshots.read(league).attacks.length, 2);
    assert.deepEqual(database.snapshots.read(repairedLeague).attacks, [battle("r1", { durationSeconds: 175 }), battle("r2")]);
    assert.equal((await noteStore.withNotes(view)).defenses[0].note, "");
  } finally {
    database.close();
  }

  // Reopening the file keeps the data and the import marker.
  const reopened = openDatabase(file);
  try {
    assert.equal(importLegacyJson(reopened, directory).skipped, true);
    assert.equal(reopened.snapshots.read(league).attacks.length, 2);
  } finally {
    reopened.close();
  }
  assert.equal(await readFile(snapshotFile, "utf8"), snapshotJson);
});

test("the latest report per village survives a reopen and is reused only in the same ranked week", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coc-ranked-report-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "coc-ranked.db");
  const { raw, report } = sampleReport();
  const fetchedAt = "2026-11-24T10:00:00.000Z";

  const database = openDatabase(file);
  database.reports.save("#DEMO1", { ...raw, week: "old" }, "2026-11-23T06:00:00.000Z");
  database.reports.save("#DEMO1", raw, fetchedAt);
  database.close();

  const reopened = openDatabase(file);
  let saved;
  try {
    saved = reopened.reports.load("#DEMO1");
    assert.equal(reopened.reports.load("#OTHER"), null);
  } finally {
    reopened.close();
  }
  assert.deepEqual(saved, { fetchedAt, raw });

  const sameWeek = cachedReport(saved, new Date("2026-11-30T04:59:00Z"));
  assert.deepEqual(sameWeek.report, report);
  assert.equal(sameWeek.fetchedAt, fetchedAt);
  assert.equal(cachedReport(saved, new Date("2026-11-30T05:00:00Z")), null);
  const completedNextWeek = { ...saved, fetchedAt: "2026-11-30T05:00:01Z" };
  assert.equal(cachedReport(completedNextWeek, new Date("2026-11-30T05:00:02Z")), null);
  assert.equal(cachedReport(null), null);
});

test("a cached report reclassifies saved personal battles with the current rules", () => {
  const stale = battle("s1", { armyShareCode: "h1e16_17-7e59_60u4x80s3x35", strategy: "隐龙蓝胖" });
  const saved = {
    raw: { ...sampleReport().raw, battleViews: { ...sampleReport().raw.battleViews, attacks: [stale], defenses: [] } },
    fetchedAt: "2026-11-24T00:00:00.000Z",
  };
  const cached = cachedReport(saved, new Date("2026-11-25T00:00:00Z"));
  assert.equal(cached.raw.battleViews.attacks[0].strategy, "天女蓝胖");
});
