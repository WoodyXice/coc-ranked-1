import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transaction } from "./database.mjs";
import { validDefenseNote } from "./defense-notes.mjs";

const importedKey = "legacy_json_imported";

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Skipping unreadable legacy file ${file}: ${error.message}`);
    return null;
  }
}

function snapshotFiles(directory) {
  try {
    return readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => join(directory, name));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Skipping legacy snapshot folder ${directory}: ${error.message}`);
    return [];
  }
}

// Copies the old ranked-snapshots/*.json and defense-notes.json into the
// database once. The old files are left in place as a backup.
export function importLegacyJson(database, userDataDir) {
  if (database.getMeta(importedKey)) return { skipped: true, snapshots: 0, notes: 0 };
  const insertNote = database.db.prepare(`
    INSERT INTO defense_notes (player_tag, battle_id, note, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (player_tag, battle_id) DO NOTHING
  `);
  const now = new Date().toISOString();
  let snapshots = 0;
  let notes = 0;

  transaction(database.db, () => {
    for (const file of snapshotFiles(join(userDataDir, "ranked-snapshots"))) {
      const snapshot = readJson(file);
      const { attacks, defenses = [], ...league } = snapshot ?? {};
      if (!Array.isArray(attacks) || !Array.isArray(defenses)
        || typeof league.groupTag !== "string" || league.seasonId == null) {
        if (snapshot) console.warn(`Skipping invalid legacy snapshot ${file}`);
        continue;
      }
      const valid = (battle) => battle && battle.id != null;
      database.snapshots.writeRows(league, attacks.filter(valid), defenses.filter(valid));
      snapshots += 1;
    }

    const noteFile = readJson(join(userDataDir, "defense-notes.json"));
    if (noteFile?.version === 1 && Array.isArray(noteFile.notes)) {
      for (const entry of noteFile.notes.filter(validDefenseNote)) {
        notes += Number(insertNote.run(entry.playerTag, entry.battleId, entry.note, now).changes);
      }
    } else if (noteFile) {
      console.warn("Skipping invalid legacy defense-notes.json");
    }
    database.setMeta(importedKey, now);
  });
  return { skipped: false, snapshots, notes };
}
