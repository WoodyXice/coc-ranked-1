import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAccountStore, importAccountsJson } from "../desktop/accounts.mjs";
import { openDatabase } from "../desktop/database.mjs";

// Stand-in for Electron safeStorage: reversible, but never stores plain text.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from("enc:" + [...value].reverse().join(""), "utf8"),
  decryptString(buffer) {
    const text = buffer.toString("utf8");
    if (!text.startsWith("enc:")) throw new Error("cannot decrypt");
    return [...text.slice(4)].reverse().join("");
  },
};
const developerToken = "aaaaaaaaaa.bbbbbbbbbb.cccccccccc";

function setup(context) {
  const database = openDatabase(":memory:");
  context.after(() => database.close());
  return { database, store: createAccountStore(database, fakeSafeStorage) };
}

function rawRows(database) {
  return JSON.stringify([
    database.db.prepare("SELECT * FROM accounts").all(),
    database.db.prepare("SELECT * FROM settings").all(),
  ]);
}

test("accounts are saved encrypted except for the village tag", (context) => {
  const { database, store } = setup(context);
  assert.deepEqual(store.list(), { accounts: [], selectedTag: "", hasDeveloperToken: false });

  store.saveAccount({ tag: "#AAA1", name: "主号村庄", clanTag: "#CLAN1", gameToken: "abcd1234" });
  store.saveAccount({ tag: "bbb2", name: "" });
  store.saveDeveloperToken(developerToken);

  assert.deepEqual(store.list(), {
    accounts: [
      { tag: "#AAA1", name: "主号村庄", clanTag: "#CLAN1", hasGameToken: true },
      { tag: "#BBB2", name: "#BBB2", clanTag: "", hasGameToken: false },
    ],
    selectedTag: "#BBB2",
    hasDeveloperToken: true,
  });
  assert.equal(store.getDeveloperToken(), developerToken);

  const raw = rawRows(database);
  for (const secret of ["主号村庄", "#CLAN1", "abcd1234", developerToken]) {
    assert(!raw.includes(secret), `${secret} is stored in plain text`);
  }
  assert(raw.includes("#AAA1"));
});

test("editing, selecting and removing accounts", (context) => {
  const { store } = setup(context);
  store.saveAccount({ tag: "#AAA1", name: "One", gameToken: "abcd1234" });
  store.saveAccount({ tag: "#BBB2", name: "Two" });

  // An edit without a new name or token keeps both.
  store.saveAccount({ tag: "#AAA1", name: "" });
  assert.deepEqual(store.list().accounts[0], { tag: "#AAA1", name: "One", clanTag: "", hasGameToken: true });
  store.saveAccount({ tag: "#AAA1", clearGameToken: true });
  assert.equal(store.list().accounts[0].hasGameToken, false);
  assert.equal(store.list().selectedTag, "#AAA1");

  assert.equal(store.selectAccount("#BBB2").selectedTag, "#BBB2");
  assert.throws(() => store.selectAccount("#NOPE1"), /没有这个村庄/);
  assert.equal(store.removeAccount("#BBB2").selectedTag, "#AAA1");
  assert.deepEqual(store.removeAccount("#AAA1"), { accounts: [], selectedTag: "", hasDeveloperToken: false });

  store.saveDeveloperToken(developerToken);
  assert.equal(store.saveDeveloperToken("").hasDeveloperToken, false);
  assert.equal(store.getDeveloperToken(), "");
  assert.throws(() => store.saveDeveloperToken("short"), /长 API 密钥/);
  assert.throws(() => store.saveAccount({ tag: "?" }), /村庄标签/);
});

test("a key that this Windows user cannot decrypt asks to save it again", (context) => {
  const { database, store } = setup(context);
  database.db.prepare("INSERT INTO settings (key, value, encrypted) VALUES ('developer_token', 'bm9wZQ==', 1)").run();
  assert.throws(() => store.getDeveloperToken(), /重新保存密钥/);
});

test("accounts.json stays readable by the old app and the new database reopens with both encrypted tokens", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coc-ranked-accounts-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "accounts.json");
  const sealed = (value) => fakeSafeStorage.encryptString(value).toString("base64");
  const legacy = JSON.stringify({
    version: 1,
    accounts: [
      { tag: "#AAA1", name: "主号", clanTag: "#CLAN1", gameToken: sealed("abcd1234") },
      { tag: "#BBB2", name: "小号", clanTag: "" },
      { tag: "bad tag", name: "skipped" },
    ],
    selectedTag: "#BBB2",
    developerToken: sealed(developerToken),
  });
  await writeFile(file, legacy, "utf8");
  const expected = {
    accounts: [
      { tag: "#AAA1", name: "主号", clanTag: "#CLAN1", hasGameToken: true },
      { tag: "#BBB2", name: "小号", clanTag: "", hasGameToken: false },
    ],
    selectedTag: "#BBB2",
    hasDeveloperToken: true,
  };
  const sqlFile = join(directory, "coc-ranked.db");
  const database = openDatabase(sqlFile);
  try {
    const imported = importAccountsJson(database, fakeSafeStorage, file);
    assert.equal(imported.skipped, false);
    assert.equal(imported.accounts, 2);
    assert.equal(imported.warnings.length, 1);
    assert.equal(await readFile(file, "utf8"), legacy);
    assert.deepEqual(createAccountStore(database, fakeSafeStorage).list(), expected);
    assert(!rawRows(database).includes("主号"));
  } finally {
    database.close();
  }

  const reopened = openDatabase(sqlFile);
  try {
    const store = createAccountStore(reopened, fakeSafeStorage);
    assert.deepEqual(store.list(), expected);
    assert.equal(store.getDeveloperToken(), developerToken);
    const row = reopened.db.prepare("SELECT game_token_enc FROM accounts WHERE tag = ?").get("#AAA1");
    assert.equal(row.game_token_enc, sealed("abcd1234"));
    assert.equal(fakeSafeStorage.decryptString(Buffer.from(row.game_token_enc, "base64")), "abcd1234");
    store.removeAccount("#AAA1");
    store.saveDeveloperToken("");
    assert.equal(importAccountsJson(reopened, fakeSafeStorage, file).skipped, true);
    assert.equal(store.list().accounts.length, 1);
    assert.equal(store.getDeveloperToken(), "");
    assert.equal(await readFile(file, "utf8"), legacy);
  } finally {
    reopened.close();
  }
});

test("a missing accounts.json is marked done and a broken one is left in place", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coc-ranked-accounts-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "accounts.json");

  const fresh = setup(context);
  assert.deepEqual(importAccountsJson(fresh.database, fakeSafeStorage, file), { skipped: false, accounts: 0 });
  assert.equal(importAccountsJson(fresh.database, fakeSafeStorage, file).skipped, true);

  await writeFile(file, "{broken", "utf8");
  const broken = setup(context);
  const result = importAccountsJson(broken.database, fakeSafeStorage, file);
  assert.equal(result.skipped, true);
  assert.equal(result.warnings.length, 1);
  assert.equal(existsSync(file), true);
  assert.equal(broken.database.getMeta("accounts_json_imported"), undefined);
});

test("a failed encryption rolls back the import and can be retried", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coc-ranked-accounts-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "accounts.json");
  await writeFile(file, JSON.stringify({
    version: 1,
    accounts: [{ tag: "#AAA1", name: "First" }, { tag: "#BBB2", name: "Second" }],
    selectedTag: "#BBB2",
  }), "utf8");
  const { database, store } = setup(context);
  const brokenStorage = {
    ...fakeSafeStorage,
    encryptString(value) {
      if (value === "Second") throw new Error("encryption unavailable");
      return fakeSafeStorage.encryptString(value);
    },
  };
  assert.throws(() => importAccountsJson(database, brokenStorage, file), /encryption unavailable/);
  assert.deepEqual(store.list().accounts, []);
  assert.equal(database.getMeta("accounts_json_imported"), undefined);
  assert.equal(importAccountsJson(database, fakeSafeStorage, file).accounts, 2);
  assert.equal(store.list().selectedTag, "#BBB2");
});
