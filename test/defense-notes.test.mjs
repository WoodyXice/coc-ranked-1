import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../desktop/database.mjs";
import { createDefenseNoteStore } from "../desktop/defense-notes.mjs";

function noteStore(context) {
  const database = openDatabase(":memory:");
  context.after(() => database.close());
  return { database, store: createDefenseNoteStore(database.db) };
}

test("defense notes prefer the current ID and can read equivalent legacy IDs", async (context) => {
  const { store } = noteStore(context);
  const playerTag = "#MOCK1";
  store.save({ playerTag, battleId: "current", note: "Current note" });
  store.save({ playerTag, battleId: "legacy-1", note: "First legacy note" });
  store.save({ playerTag, battleId: "legacy-2", note: "Second legacy note" });
  store.save({ playerTag: "#MOCK2", battleId: "wrong-owner", note: "Other village's note" });
  const result = await store.withNotes({ playerTag, defenses: [
    { id: "current", previousIds: ["legacy-1"] },
    { id: "new", previousIds: [null, "invalid ID", "wrong-owner", "legacy-2", "legacy-1"] },
    { id: "unknown", previousIds: ["wrong-owner"] },
  ] });
  assert.deepEqual(result.defenses.map((battle) => battle.note), ["Current note", "Second legacy note", ""]);
});

test("notes can be updated or cleared even when a previous ID still has a note", async (context) => {
  const { database, store } = noteStore(context);
  const playerTag = "#MOCK1";
  const count = () => database.db.prepare("SELECT count(*) AS n FROM defense_notes WHERE battle_id = 'b1' AND note <> ''").get().n;
  const view = async () => (await store.withNotes({ playerTag, defenses: [{ id: "b1", previousIds: ["old"] }] })).defenses[0].note;

  store.save({ playerTag, battleId: "old", note: "Old note" });
  assert.equal(await view(), "Old note");
  assert.equal(store.save({ playerTag: "mock1", battleId: "b1", note: "  first  " }), "first");
  assert.equal(await view(), "first");
  store.save({ playerTag, battleId: "b1", note: "second" });
  assert.equal(await view(), "second");
  assert.equal(count(), 1);
  assert.equal(store.save({ playerTag, battleId: "b1", note: "   " }), "");
  assert.equal(await view(), "");
  assert.equal(count(), 0);
  assert.throws(() => store.save({ playerTag, battleId: "b1", note: "x".repeat(301) }), /300/);
  assert.throws(() => store.save({ playerTag: "?", battleId: "b1", note: "x" }), /村庄标签/);
});
