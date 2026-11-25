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

test("legacy JSON files are imported once and kept on disk", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coc-ranked-db-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotDir = join(directory, "ranked-snapshots");
  await mkdir(snapshotDir);
  const snapshotFile = join(snapshotDir, "MOCKG-1790000000.json");
  const snapshotJson = JSON.stringify({ ...league, attacks: [battle("a1")], defenses: [battle("d1")] });
  await writeFile(snapshotFile, snapshotJson, "utf8");
  await writeFile(join(snapshotDir, "broken.json"), "{not json", "utf8");
  await writeFile(join(snapshotDir, "wrong-shape.json"), JSON.stringify({ attacks: "nope" }), "utf8");
  await writeFile(join(directory, "defense-notes.json"), JSON.stringify({ version: 1, notes: [
    { playerTag: "#MOCK1", battleId: "d1", note: "Imported note" },
    { playerTag: "lowercase", battleId: "d1", note: "Invalid tag" },
  ] }), "utf8");

  const file = join(directory, "coc-ranked.db");
  const database = openDatabase(file);
  try {
    const result = importLegacyJson(database, directory);
    assert.deepEqual(result, { skipped: false, snapshots: 1, notes: 1 });
    assert.deepEqual(database.snapshots.read(league).attacks.map(({ id }) => id), ["a1"]);
    assert.deepEqual(database.snapshots.read(league).defenses.map(({ id }) => id), ["d1"]);
    const notes = await createDefenseNoteStore(database.db).withNotes({ playerTag: "#MOCK1", defenses: [{ id: "d1" }] });
    assert.equal(notes.defenses[0].note, "Imported note");

    // Newer data written after the import must not be overwritten by a second run.
    database.snapshots.write(league, [battle("a1"), battle("a2")], []);
    assert.equal(importLegacyJson(database, directory).skipped, true);
    assert.equal(database.snapshots.read(league).attacks.length, 2);
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
  assert.equal(cachedReport(null), null);
});
