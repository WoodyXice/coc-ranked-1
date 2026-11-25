import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("accounts.json is imported once, keeps its encrypted tokens and is deleted", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "coc-ranked-accounts-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "accounts.json");
  const sealed = (value) => fakeSafeStorage.encryptString(value).toString("base64");
  await writeFile(file, JSON.stringify({
    version: 1,
    accounts: [
      { tag: "#AAA1", name: "主号", clanTag: "#CLAN1", gameToken: sealed("abcd1234") },
      { tag: "#BBB2", name: "小号", clanTag: "" },
      { tag: "bad tag", name: "skipped" },
    ],
    selectedTag: "#BBB2",
    developerToken: sealed(developerToken),
  }), "utf8");

  const { database, store } = setup(context);
  assert.deepEqual(importAccountsJson(database, fakeSafeStorage, file), { skipped: false, accounts: 2 });
  assert.equal(existsSync(file), false);
  assert.deepEqual(store.list(), {
    accounts: [
      { tag: "#AAA1", name: "主号", clanTag: "#CLAN1", hasGameToken: true },
      { tag: "#BBB2", name: "小号", clanTag: "", hasGameToken: false },
    ],
    selectedTag: "#BBB2",
    hasDeveloperToken: true,
  });
  assert.equal(store.getDeveloperToken(), developerToken);
  assert(!rawRows(database).includes("主号"));

  // A file that shows up again later is not re-imported over newer data.
  await writeFile(file, JSON.stringify({ version: 1, accounts: [{ tag: "#CCC3", name: "late" }] }), "utf8");
  assert.equal(importAccountsJson(database, fakeSafeStorage, file).skipped, true);
  assert.equal(store.list().accounts.length, 2);
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
  assert.equal(importAccountsJson(broken.database, fakeSafeStorage, file).skipped, true);
  assert.equal(existsSync(file), true);
  assert.equal(broken.database.getMeta("accounts_json_imported"), undefined);
});
