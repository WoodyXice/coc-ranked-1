import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openDatabase } from "../desktop/database.mjs";
import { migrations } from "../desktop/migrations.mjs";

const league = { groupTag: "#MOCKG", seasonId: 1790000000, week: "2026-11-23" };
const latest = migrations.at(-1).version;

async function tempFile(context) {
  const directory = await mkdtemp(join(tmpdir(), "coc-ranked-migrate-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file: join(directory, "coc-ranked.db") };
}

function userVersion(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("PRAGMA user_version").get().user_version;
  } finally {
    db.close();
  }
}

function withDatabase(file, options, fn) {
  const database = openDatabase(file, options);
  try {
    return fn(database);
  } finally {
    database.close();
  }
}

test("migration versions are unique and increasing", () => {
  migrations.forEach(({ version, name, up }, index) => {
    assert.equal(version, index + 1);
    assert.equal(typeof name, "string");
    assert.equal(typeof up, "function");
  });
});

test("a new database is created at the latest version without a backup", async (context) => {
  const { directory, file } = await tempFile(context);
  const migration = withDatabase(file, {}, (database) => database.migration);
  assert.deepEqual(migration, { from: 0, to: latest, backup: null });
  assert.equal(userVersion(file), latest);
  // Opening again runs nothing.
  assert.deepEqual(withDatabase(file, {}, (database) => database.migration), { from: latest, to: latest, backup: null });
  assert(!(await readdir(directory)).some((name) => name.includes(".backup-")));
});

test("a later migration backs up the old file, keeps data and bumps the version", async (context) => {
  const { directory, file } = await tempFile(context);
  withDatabase(file, {}, (database) => database.snapshots.write(league, [{ id: "a1", stars: 3 }], []));

  const next = [...migrations, {
    version: latest + 1,
    name: "battles.stars column",
    up(db) {
      db.exec("ALTER TABLE battles ADD COLUMN stars INTEGER");
      db.exec("UPDATE battles SET stars = json_extract(data, '$.stars')");
    },
  }];
  const migration = withDatabase(file, { migrations: next }, (database) => {
    assert.deepEqual(database.snapshots.read(league).attacks, [{ id: "a1", stars: 3 }]);
    assert.equal(database.db.prepare("SELECT stars FROM battles").get().stars, 3);
    return database.migration;
  });
  assert.equal(migration.from, latest);
  assert.equal(migration.to, latest + 1);
  assert.equal(userVersion(file), latest + 1);

  const backups = (await readdir(directory)).filter((name) => name.startsWith(`coc-ranked.db.backup-v${latest}-`));
  assert.equal(backups.length, 1);
  assert.equal(join(directory, backups[0]), migration.backup);
  assert.equal(userVersion(migration.backup), latest);
  withDatabase(migration.backup, {}, (backup) => {
    assert.deepEqual(backup.snapshots.read(league).attacks, [{ id: "a1", stars: 3 }]);
  });
});

test("a failing migration rolls back and leaves the previous version", async (context) => {
  const { file } = await tempFile(context);
  withDatabase(file, {}, (database) => database.snapshots.write(league, [{ id: "a1" }], []));
  const broken = [...migrations, {
    version: latest + 1,
    name: "broken",
    up(db) {
      db.exec("CREATE TABLE half_done (x)");
      throw new Error("boom");
    },
  }];
  assert.throws(() => openDatabase(file, { migrations: broken }), new RegExp(`升级到 v${latest + 1}（broken）失败：boom`));
  assert.equal(userVersion(file), latest);
  withDatabase(file, {}, (database) => {
    assert.equal(database.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'half_done'").get().n, 0);
    assert.equal(database.snapshots.read(league).attacks.length, 1);
  });
});

test("a database from a newer app version is refused and left untouched", async (context) => {
  const { file } = await tempFile(context);
  withDatabase(file, {}, () => {});
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version = ${latest + 5}`);
  db.close();
  assert.throws(() => openDatabase(file), new RegExp(`比当前软件支持的 v${latest} 新`));
  assert.equal(userVersion(file), latest + 5);
});
