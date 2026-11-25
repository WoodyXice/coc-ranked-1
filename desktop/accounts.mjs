import { readFileSync, rmSync } from "node:fs";
import { transaction } from "./database.mjs";

function normalizeTag(value) {
  const tag = typeof value === "string" ? value.trim().toUpperCase().replace(/^#/, "") : "";
  return /^[A-Z0-9]{2,20}$/.test(tag) ? "#" + tag : "";
}

export function validateDeveloperToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!token) return "";
  if (token.length > 4096 || !/^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(token)) {
    throw new Error("请填写 Supercell 开发者后台生成的长 API 密钥。游戏内的短令牌用于验证村庄归属。");
  }
  return token;
}

// Encrypts with the current Windows user's key (DPAPI via Electron safeStorage).
export function createSealer(safeStorage) {
  return {
    seal(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 加密服务暂不可用。");
      return safeStorage.encryptString(value).toString("base64");
    },
    open(value) {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    },
  };
}

// Accounts live in the database. Everything except the village tag is
// encrypted, so the database file alone does not reveal names or keys.
export function createAccountStore(database, safeStorage) {
  const { db } = database;
  const { seal, open } = createSealer(safeStorage);
  const selectAccounts = db.prepare("SELECT tag, name_enc, clan_tag_enc, game_token_enc FROM accounts ORDER BY rowid");
  const selectAccount = db.prepare("SELECT tag, name_enc, game_token_enc FROM accounts WHERE tag = ?");
  const upsertAccount = db.prepare(`
    INSERT INTO accounts (tag, name_enc, clan_tag_enc, game_token_enc, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (tag) DO UPDATE SET name_enc = excluded.name_enc, clan_tag_enc = excluded.clan_tag_enc,
      game_token_enc = excluded.game_token_enc, updated_at = excluded.updated_at
  `);
  const deleteAccount = db.prepare("DELETE FROM accounts WHERE tag = ?");
  const firstTag = db.prepare("SELECT tag FROM accounts ORDER BY rowid LIMIT 1");
  const getSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
  const setSetting = db.prepare(`
    INSERT INTO settings (key, value, encrypted) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted
  `);
  const deleteSetting = db.prepare("DELETE FROM settings WHERE key = ?");

  function readable(value, fallback) {
    if (!value) return fallback;
    try {
      return open(value);
    } catch {
      return fallback;
    }
  }

  function publicView() {
    return {
      accounts: selectAccounts.all().map((row) => ({
        tag: row.tag,
        name: readable(row.name_enc, row.tag),
        clanTag: readable(row.clan_tag_enc, ""),
        hasGameToken: !!row.game_token_enc,
      })),
      selectedTag: getSetting.get("selected_account")?.value ?? "",
      hasDeveloperToken: !!getSetting.get("developer_token"),
    };
  }

  function update(change) {
    try {
      transaction(db, change);
    } catch (error) {
      // Validation messages pass through; SQLite failures get a plain message.
      if (error?.code === "ERR_SQLITE_ERROR") throw new Error("无法将账号资料保存到当前 Windows 用户。");
      throw error;
    }
    return publicView();
  }

  return {
    list() {
      try {
        return publicView();
      } catch {
        throw new Error("无法打开本地账号资料。");
      }
    },
    saveAccount(input = {}) {
      const tag = normalizeTag(input.tag);
      const clanTag = normalizeTag(input.clanTag);
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const gameToken = typeof input.gameToken === "string" ? input.gameToken.trim() : "";
      if (!tag) throw new Error("请输入有效的村庄标签。");
      if (input.clanTag && !clanTag) throw new Error("请输入有效的部落标签。");
      if (name.length > 60) throw new Error("账号名称最多 60 个字符。");
      if (gameToken && !/^[A-Za-z0-9]{4,64}$/.test(gameToken)) {
        throw new Error("游戏内令牌应是较短的字母和数字组合。");
      }
      return update(() => {
        const existing = selectAccount.get(tag);
        const savedName = name || readable(existing?.name_enc, tag);
        let token = null;
        if (gameToken) token = seal(gameToken);
        else if (!input.clearGameToken) token = existing?.game_token_enc ?? null;
        upsertAccount.run(tag, seal(savedName), clanTag ? seal(clanTag) : null, token, new Date().toISOString());
        setSetting.run("selected_account", tag, 0);
      });
    },
    selectAccount(value) {
      const tag = normalizeTag(value);
      return update(() => {
        if (!tag || !selectAccount.get(tag)) throw new Error("本地账号列表里没有这个村庄。");
        setSetting.run("selected_account", tag, 0);
      });
    },
    removeAccount(value) {
      const tag = normalizeTag(value);
      return update(() => {
        deleteAccount.run(tag);
        if (getSetting.get("selected_account")?.value === tag) {
          const next = firstTag.get()?.tag;
          if (next) setSetting.run("selected_account", next, 0);
          else deleteSetting.run("selected_account");
        }
      });
    },
    saveDeveloperToken(value) {
      const token = validateDeveloperToken(value);
      return update(() => {
        if (token) setSetting.run("developer_token", seal(token), 1);
        else deleteSetting.run("developer_token");
      });
    },
    getDeveloperToken() {
      const sealed = getSetting.get("developer_token")?.value;
      if (!sealed) return "";
      try {
        return open(sealed);
      } catch {
        throw new Error("当前 Windows 用户无法解密已保存的开发者密钥，请重新保存密钥。");
      }
    },
  };
}

// One-time move of the old accounts.json into the database. Its tokens are
// already safeStorage-encrypted and are copied as they are; names and clan
// tags are encrypted now. The file is deleted once the import has committed.
export function importAccountsJson(database, safeStorage, file) {
  const importedKey = "accounts_json_imported";
  if (database.getMeta(importedKey)) return { skipped: true, accounts: 0 };
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      database.setMeta(importedKey, new Date().toISOString());
      return { skipped: false, accounts: 0 };
    }
    console.warn(`Leaving unreadable accounts.json in place: ${error.message}`);
    return { skipped: true, accounts: 0 };
  }
  if (data?.version !== 1 || !Array.isArray(data.accounts)) {
    console.warn("Leaving accounts.json with an unknown format in place.");
    return { skipped: true, accounts: 0 };
  }
  const { seal } = createSealer(safeStorage);
  const { db } = database;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO accounts (tag, name_enc, clan_tag_enc, game_token_enc, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (tag) DO NOTHING
  `);
  const setSetting = db.prepare(`
    INSERT INTO settings (key, value, encrypted) VALUES (?, ?, ?)
    ON CONFLICT (key) DO NOTHING
  `);
  let accounts = 0;
  transaction(db, () => {
    for (const account of data.accounts) {
      const tag = normalizeTag(account?.tag);
      if (!tag) continue;
      const name = typeof account.name === "string" && account.name.trim() ? account.name.trim() : tag;
      const clanTag = normalizeTag(account.clanTag);
      const gameToken = typeof account.gameToken === "string" && account.gameToken ? account.gameToken : null;
      accounts += Number(insert.run(tag, seal(name), clanTag ? seal(clanTag) : null, gameToken, now).changes);
    }
    const selected = normalizeTag(data.selectedTag);
    if (selected) setSetting.run("selected_account", selected, 0);
    if (typeof data.developerToken === "string" && data.developerToken) {
      setSetting.run("developer_token", data.developerToken, 1);
    }
    database.setMeta(importedKey, now);
  });
  try {
    rmSync(file, { force: true });
  } catch (error) {
    console.warn(`Imported accounts.json but could not delete it: ${error.message}`);
  }
  return { skipped: false, accounts };
}
