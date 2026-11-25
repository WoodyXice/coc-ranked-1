// Database schema migrations for coc-ranked.db.
//
// Rules for changing the schema:
// - Only append a new entry with the next version number. Never edit or
//   reorder an entry that has shipped in a release: users' databases have
//   already run it and will not run it again.
// - Each `up(db)` runs inside one transaction together with the version bump,
//   so a failed migration leaves the database at the previous version.
// - Before migrating an existing database, a copy is saved next to it as
//   coc-ranked.db.backup-v<old version>-<time>.db.
// - Battle and report rows keep the full object in a JSON `data` column, so
//   new battle fields usually need no migration. Add a column only when the
//   app needs to query or index that field.
//
// Example of a later migration:
//   {
//     version: 2,
//     name: "battles.stars column",
//     up(db) {
//       db.exec("ALTER TABLE battles ADD COLUMN stars INTEGER");
//       db.exec("UPDATE battles SET stars = json_extract(data, '$.stars')");
//     },
//   },

export const migrations = [
  {
    version: 1,
    name: "initial schema",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS leagues (
          group_tag TEXT NOT NULL,
          season_id TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (group_tag, season_id)
        );
        CREATE TABLE IF NOT EXISTS battles (
          group_tag TEXT NOT NULL,
          season_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('attack', 'defense')),
          id TEXT NOT NULL,
          player_tag TEXT,
          opponent_tag TEXT,
          timestamp TEXT,
          data TEXT NOT NULL,
          PRIMARY KEY (group_tag, season_id, kind, id)
        );
        CREATE INDEX IF NOT EXISTS battles_player ON battles (player_tag);
        CREATE INDEX IF NOT EXISTS battles_opponent ON battles (opponent_tag);
        CREATE TABLE IF NOT EXISTS defense_notes (
          player_tag TEXT NOT NULL,
          battle_id TEXT NOT NULL,
          note TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (player_tag, battle_id)
        );
        CREATE TABLE IF NOT EXISTS reports (
          player_tag TEXT PRIMARY KEY,
          fetched_at TEXT NOT NULL,
          data TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: "encrypted accounts",
    up(db) {
      // *_enc columns hold Windows (DPAPI) encrypted text from Electron
      // safeStorage, base64 encoded. Only the village tag stays readable.
      db.exec(`
        CREATE TABLE accounts (
          tag TEXT PRIMARY KEY,
          name_enc TEXT NOT NULL,
          clan_tag_enc TEXT,
          game_token_enc TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1))
        );
      `);
    },
  },
];
