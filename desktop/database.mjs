import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mergePlayerHistory } from "../collector.mjs";
import { migrations as defaultMigrations } from "./migrations.mjs";

// Runs fn inside one write transaction and rolls back if it throws.
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The failed statement can have already rolled back the transaction.
    }
    throw error;
  }
}

function text(value) {
  return typeof value === "string" ? value : null;
}

function leagueKey(league) {
  return [String(league.groupTag), String(league.seasonId)];
}

function createSnapshotStore(db) {
  const selectBattles = db.prepare(
    "SELECT kind, data FROM battles WHERE group_tag = ? AND season_id = ? ORDER BY rowid",
  );
  const upsertLeague = db.prepare(`
    INSERT INTO leagues (group_tag, season_id, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (group_tag, season_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `);
  const importLeague = db.prepare(`
    INSERT INTO leagues (group_tag, season_id, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (group_tag, season_id) DO NOTHING
  `);
  const deleteBattles = db.prepare("DELETE FROM battles WHERE group_tag = ? AND season_id = ?");
  const insertBattle = db.prepare(`
    INSERT INTO battles (group_tag, season_id, kind, id, player_tag, opponent_tag, timestamp, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (group_tag, season_id, kind, id) DO NOTHING
  `);

  function writeBattles([groupTag, seasonId], attacks, defenses) {
    for (const [kind, rows] of [["attack", attacks], ["defense", defenses]]) {
      for (const battle of rows) {
        insertBattle.run(
          groupTag, seasonId, kind, String(battle.id),
          text(battle.playerTag), text(battle.opponentTag), text(battle.timestamp),
          JSON.stringify(battle),
        );
      }
    }
  }

  return {
    read(league) {
      const attacks = [];
      const defenses = [];
      for (const { kind, data } of selectBattles.all(...leagueKey(league))) {
        (kind === "attack" ? attacks : defenses).push(JSON.parse(data));
      }
      return { attacks, defenses };
    },
    // Replaces the whole group: merging can drop superseded battle IDs.
    write(league, attacks, defenses) {
      transaction(db, () => {
        const key = leagueKey(league);
        upsertLeague.run(...key, JSON.stringify(league), new Date().toISOString());
        deleteBattles.run(...key);
        writeBattles(key, attacks, defenses);
      });
    },
    // The importer holds the transaction. Keep newer data when a file is retried.
    importRows(league, attacks, defenses) {
      const key = leagueKey(league);
      importLeague.run(...key, JSON.stringify(league), new Date().toISOString());
      writeBattles(key, attacks, defenses);
    },
  };
}

// Latest collected report per village, shown again after a restart.
function createReportStore(db) {
  const upsert = db.prepare(`
    INSERT INTO reports (player_tag, fetched_at, data) VALUES (?, ?, ?)
    ON CONFLICT (player_tag) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data
  `);
  const select = db.prepare("SELECT fetched_at, data FROM reports WHERE player_tag = ?");
  return {
    save(playerTag, raw, fetchedAt = new Date().toISOString()) {
      upsert.run(playerTag, fetchedAt, JSON.stringify(raw));
      return fetchedAt;
    },
    load(playerTag) {
      const row = select.get(playerTag);
      return row ? { fetchedAt: row.fetched_at, raw: JSON.parse(row.data) } : null;
    },
  };
}

function historyData(row) {
  const {
    id, previousIds, timestamp, battleTimestamp, durationSeconds, opponentTag, opponentName,
    stars, destruction, trophies, trophyDelta, armyShareCode, armySource, army, battleType, trophySource,
  } = row;
  return JSON.stringify({
    id, previousIds, timestamp, battleTimestamp, durationSeconds, opponentTag, opponentName,
    stars, destruction, trophies, trophyDelta, armyShareCode, armySource, battleType, trophySource,
    ...(!armyShareCode && army ? { army } : {}),
  });
}

function createPlayerHistoryStore(db) {
  const select = db.prepare("SELECT direction, battle_type, id, data FROM player_history WHERE player_tag = ?");
  const upsert = db.prepare(`
    INSERT INTO player_history (player_tag, direction, battle_type, id, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (player_tag, direction, battle_type, id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data
  `);
  const remove = db.prepare(
    "DELETE FROM player_history WHERE player_tag = ? AND direction = ? AND battle_type = ? AND id = ?",
  );
  const key = (direction, battleType, id) => JSON.stringify([direction, battleType, id]);
  return {
    merge(playerTag, recent, fetchedAt = new Date().toISOString()) {
      const tag = typeof playerTag === "string" ? playerTag.trim().toUpperCase().replace(/^#/, "") : "";
      if (!/^[A-Z0-9]{2,20}$/.test(tag)) throw new Error("请输入有效的村庄标签。");
      const player = "#" + tag;
      return transaction(db, () => {
        const archived = { attacks: [], defenses: [] };
        const stored = new Map();
        for (const entry of select.all(player)) {
          stored.set(key(entry.direction, entry.battle_type, entry.id), entry);
          archived[entry.direction].push(JSON.parse(entry.data));
        }
        const merged = mergePlayerHistory(recent, archived);
        for (const [direction, rows] of Object.entries(merged)) {
          for (const row of rows) {
            const id = key(direction, row.battleType, row.id);
            const current = stored.get(id);
            const data = historyData(row);
            if (current?.data !== data) upsert.run(player, direction, row.battleType, row.id, fetchedAt, data);
            stored.delete(id);
          }
        }
        for (const { direction, battle_type: mode, id } of stored.values()) remove.run(player, direction, mode, id);
        return merged;
      });
    },
  };
}

function backupFile(file, version) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${file}.backup-v${version}-${stamp}.db`;
}

// Brings the schema up to the newest migration. PRAGMA user_version holds the
// version that has been applied.
export function migrate(db, { file = ":memory:", migrations = defaultMigrations } = {}) {
  const from = db.prepare("PRAGMA user_version").get().user_version;
  const latest = migrations.at(-1)?.version ?? 0;
  if (from > latest) {
    throw new Error(`数据库版本 v${from} 比当前软件支持的 v${latest} 新，请更新软件后再打开。`);
  }
  const pending = migrations.filter(({ version }) => version > from);
  if (!pending.length) return { from, to: from, backup: null };

  let backup = null;
  if (from > 0 && file !== ":memory:") {
    backup = backupFile(file, from);
    db.prepare("VACUUM INTO ?").run(backup);
  }
  for (const migration of pending) {
    try {
      transaction(db, () => {
        migration.up(db);
        db.exec(`PRAGMA user_version = ${Number(migration.version)}`);
      });
    } catch (error) {
      throw new Error(`数据库升级到 v${migration.version}（${migration.name}）失败：${error.message}`);
    }
  }
  return { from, to: latest, backup };
}

export function openDatabase(file, { migrations } = {}) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    const migration = migrate(db, { file, migrations });
    const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
    const setMeta = db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    );
    let closed = false;
    return {
      db,
      file,
      migration,
      schemaVersion: migration.to,
      snapshots: createSnapshotStore(db),
      reports: createReportStore(db),
      ...(migration.to >= 3 ? { playerHistory: createPlayerHistoryStore(db) } : {}),
      getMeta: (key) => getMeta.get(key)?.value,
      setMeta: (key, value) => setMeta.run(key, String(value)),
      close() {
        if (closed) return;
        db.close();
        closed = true;
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
