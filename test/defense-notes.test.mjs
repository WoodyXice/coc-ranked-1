import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDefenseNoteStore } from "../desktop/defense-notes.mjs";

test("defense notes prefer the current ID and can read equivalent legacy IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coc-defense-notes-"));
  const file = join(directory, "notes.json");
  const playerTag = "#MOCK1";
  const contents = JSON.stringify({ version: 1, notes: [
    { playerTag, battleId: "current", note: "Current note" },
    { playerTag, battleId: "legacy-1", note: "First legacy note" },
    { playerTag, battleId: "legacy-2", note: "Second legacy note" },
    { playerTag: "#MOCK2", battleId: "wrong-owner", note: "Other village's note" },
  ] });
  try {
    await writeFile(file, contents, "utf8");
    const store = createDefenseNoteStore(file);
    const result = await store.withNotes({ playerTag, defenses: [
      { id: "current", previousIds: ["legacy-1"] },
      { id: "new", previousIds: [null, "invalid ID", "wrong-owner", "legacy-2", "legacy-1"] },
      { id: "unknown", previousIds: ["wrong-owner"] },
    ] });
    assert.deepEqual(result.defenses.map((battle) => battle.note), ["Current note", "Second legacy note", ""]);
    assert.equal(await readFile(file, "utf8"), contents);
  } finally {
    await rm(file, { force: true });
    await rmdir(directory);
  }
});
