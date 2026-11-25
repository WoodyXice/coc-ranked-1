import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

export function createAccountStore(file, safeStorage) {
  let queue = Promise.resolve();

  async function read() {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, accounts: [], selectedTag: "", developerToken: "" };
      throw new Error("无法打开本地账号资料。");
    }
    try {
      const data = JSON.parse(text);
      if (data.version !== 1 || !Array.isArray(data.accounts)) throw new Error();
      return data;
    } catch {
      throw new Error("本地账号资料无法读取，请检查 Windows 用户的应用数据。");
    }
  }

  function publicView(data) {
    return {
      accounts: data.accounts.map(({ tag, name, clanTag, gameToken }) => ({
        tag, name, clanTag: clanTag || "", hasGameToken: !!gameToken,
      })),
      selectedTag: data.selectedTag,
      hasDeveloperToken: !!data.developerToken,
    };
  }

  function seal(value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 加密服务暂不可用。");
    return safeStorage.encryptString(value).toString("base64");
  }

  function update(change) {
    const operation = queue.then(async () => {
      const data = await read();
      change(data);
      const staged = file + "." + randomUUID() + ".tmp";
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(staged, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
        await rename(staged, file);
      } catch {
        throw new Error("无法将账号资料保存到当前 Windows 用户。");
      } finally {
        await rm(staged, { force: true }).catch(() => {});
      }
      return publicView(data);
    });
    queue = operation.catch(() => {});
    return operation;
  }

  return {
    async list() {
      await queue;
      return publicView(await read());
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
      return update((data) => {
        const index = data.accounts.findIndex((item) => item.tag === tag);
        const existing = data.accounts[index];
        const account = { tag, name: name || existing?.name || tag, clanTag };
        if (gameToken) account.gameToken = seal(gameToken);
        else if (!input.clearGameToken && existing?.gameToken) account.gameToken = existing.gameToken;
        if (index === -1) data.accounts.push(account);
        else data.accounts[index] = account;
        data.selectedTag = tag;
      });
    },
    selectAccount(value) {
      const tag = normalizeTag(value);
      return update((data) => {
        if (!data.accounts.some((item) => item.tag === tag)) throw new Error("本地账号列表里没有这个村庄。");
        data.selectedTag = tag;
      });
    },
    removeAccount(value) {
      const tag = normalizeTag(value);
      return update((data) => {
        data.accounts = data.accounts.filter((item) => item.tag !== tag);
        if (data.selectedTag === tag) data.selectedTag = data.accounts[0]?.tag || "";
      });
    },
    saveDeveloperToken(value) {
      const token = validateDeveloperToken(value);
      return update((data) => { data.developerToken = token ? seal(token) : ""; });
    },
    async getDeveloperToken() {
      await queue;
      const { developerToken } = await read();
      if (!developerToken) return "";
      try {
        return safeStorage.decryptString(Buffer.from(developerToken, "base64"));
      } catch {
        throw new Error("当前 Windows 用户无法解密已保存的开发者密钥，请重新保存密钥。");
      }
    },
  };
}
