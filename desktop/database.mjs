import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations as defaultMigrations } from "./migrations.mjs";

// Runs fn inside one write transaction and rolls back if it throws.
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
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
  const deleteBattles = db.prepare("DELETE FROM battles WHERE group_tag = ? AND season_id = ?");
  const insertBattle = db.prepare(`
    INSERT OR REPLACE INTO battles (group_tag, season_id, kind, id, player_tag, opponent_tag, timestamp, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function writeRows(league, attacks, defenses) {
    const [groupTag, seasonId] = leagueKey(league);
    const { attacks: _attacks, defenses: _defenses, ...info } = league;
    upsertLeague.run(groupTag, seasonId, JSON.stringify(info), new Date().toISOString());
    deleteBattles.run(groupTag, seasonId);
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
      transaction(db, () => writeRows(league, attacks, defenses));
    },
    // For callers that already hold a transaction (legacy import).
    writeRows,
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
  let migration;
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    migration = migrate(db, { file, migrations });
  } catch (error) {
    db.close();
    throw error;
  }
  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  return {
    db,
    file,
    migration,
    schemaVersion: migration.to,
    snapshots: createSnapshotStore(db),
    reports: createReportStore(db),
    getMeta: (key) => getMeta.get(key)?.value,
    setMeta: (key, value) => setMeta.run(key, String(value)),
    close() {
      if (db.isOpen) db.close();
    },
  };
}
