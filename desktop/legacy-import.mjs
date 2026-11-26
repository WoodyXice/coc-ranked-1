import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transaction } from "./database.mjs";
import { validDefenseNote } from "./defense-notes.mjs";

const importedKey = "legacy_json_imported";

function readJson(file) {
  try {
    return { data: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return error.code === "ENOENT" ? {} : { unreadable: true };
  }
}

function snapshotFiles(directory) {
  try {
    return readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch (error) {
    return error.code === "ENOENT" ? [] : null;
  }
}

function validBattle(battle) {
  return typeof battle?.id === "string" && battle.id.length > 0;
}

// Keep completed sources marked and leave unreadable sources eligible for a retry.
export function importLegacyJson(database, userDataDir) {
  if (database.getMeta(importedKey)) return { skipped: true, snapshots: 0, notes: 0 };
  const insertNote = database.db.prepare(`
    INSERT INTO defense_notes (player_tag, battle_id, note, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (player_tag, battle_id) DO NOTHING
  `);
  const now = new Date().toISOString();
  let snapshots = 0;
  let notes = 0;
  let skipped = false;
  const warnings = [];

  transaction(database.db, () => {
    if (database.getMeta(importedKey)) {
      skipped = true;
      return;
    }
    const directory = join(userDataDir, "ranked-snapshots");
    const names = snapshotFiles(directory);
    if (!names) warnings.push("无法读取旧版排位记录目录，原文件已保留。");
    for (const name of names ?? []) {
      const sourceKey = `legacy_snapshot_imported:${name}`;
      if (database.getMeta(sourceKey)) continue;
      const { data, unreadable } = readJson(join(directory, name));
      if (unreadable) {
        warnings.push("无法读取一个旧版排位记录文件，原文件已保留。");
        continue;
      }
      const { attacks, defenses = [], ...league } = data ?? {};
      if (!Array.isArray(attacks) || !Array.isArray(defenses)
        || typeof league.groupTag !== "string" || !/^#[A-Z0-9]{2,20}$/.test(league.groupTag)
        || !Number.isSafeInteger(league.seasonId) || league.seasonId < 1e9 || league.seasonId >= 1e10) {
        warnings.push("一个旧版排位记录文件格式无效，原文件已保留。");
        continue;
      }
      const validAttacks = attacks.filter(validBattle);
      const validDefenses = defenses.filter(validBattle);
      database.snapshots.importRows(league, validAttacks, validDefenses);
      if (validAttacks.length === attacks.length && validDefenses.length === defenses.length) {
        database.setMeta(sourceKey, now);
      } else {
        warnings.push("一个旧版排位记录文件含有缺少编号的战斗，原文件已保留。");
      }
      snapshots += 1;
    }

    const notesKey = "legacy_defense_notes_imported";
    if (!database.getMeta(notesKey)) {
      const { data, unreadable } = readJson(join(userDataDir, "defense-notes.json"));
      if (unreadable || (data !== undefined && (data?.version !== 1 || !Array.isArray(data.notes)))) {
        warnings.push("无法读取旧版防守备注，原文件已保留。");
      } else if (data) {
        const validNotes = data.notes.filter(validDefenseNote);
        for (const entry of validNotes) {
          notes += Number(insertNote.run(entry.playerTag, entry.battleId, entry.note, now).changes);
        }
        if (validNotes.length === data.notes.length) database.setMeta(notesKey, now);
        else warnings.push("旧版防守备注包含无效条目，原文件已保留。");
      }
    }
    if (!warnings.length) database.setMeta(importedKey, now);
  });
  const result = { skipped, snapshots, notes };
  if (warnings.length) result.warnings = warnings;
  return result;
}
