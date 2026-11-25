import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const maxNoteLength = 300;

function normalizeTag(value) {
  const tag = typeof value === "string" ? value.trim().toUpperCase().replace(/^#/, "") : "";
  return /^[A-Z0-9]{2,20}$/.test(tag) ? "#" + tag : "";
}

function validBattleId(value) {
  return typeof value === "string" && /^[A-Za-z0-9#|_-]{1,160}$/.test(value);
}

function normalizeNote(value) {
  if (typeof value !== "string") throw new Error("请输入防守备注。");
  const note = value.replace(/\r\n?/g, "\n").trim();
  if (note.length > maxNoteLength) throw new Error("防守备注最多 300 个字符。");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(note)) {
    throw new Error("防守备注包含无法保存的控制字符。");
  }
  return note;
}

export function createDefenseNoteStore(file) {
  let queue = Promise.resolve();

  async function read() {
    try {
      const data = JSON.parse(await readFile(file, "utf8"));
      if (data?.version !== 1 || !Array.isArray(data.notes) || !data.notes.every((entry) =>
        entry && entry.playerTag === normalizeTag(entry.playerTag) && entry.playerTag
        && validBattleId(entry.battleId) && typeof entry.note === "string"
      )) throw new Error();
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, notes: [] };
      throw new Error("无法读取当前 Windows 用户的防守备注文件。");
    }
  }

  async function write(data) {
    const staged = file + "." + randomUUID() + ".tmp";
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(staged, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(staged, file);
    } catch {
      throw new Error("无法将防守备注保存到当前 Windows 用户。");
    } finally {
      await rm(staged, { force: true }).catch(() => {});
    }
  }

  return {
    save({ playerTag: tag, battleId, note: value } = {}) {
      const playerTag = normalizeTag(tag);
      if (!playerTag || !validBattleId(battleId)) throw new Error("这场防守缺少有效的村庄标签或战斗编号。");
      const note = normalizeNote(value);
      const operation = queue.then(async () => {
        const data = await read();
        const index = data.notes.findIndex((entry) => entry.playerTag === playerTag && entry.battleId === battleId);
        if (index < 0 && !note) return "";
        if (index < 0) data.notes.push({ playerTag, battleId, note });
        else if (note) data.notes[index].note = note;
        else data.notes.splice(index, 1);
        await write(data);
        return note;
      });
      queue = operation.catch(() => {});
      return operation;
    },

    async withNotes(battleViews) {
      const playerTag = normalizeTag(battleViews?.playerTag);
      if (!playerTag || !Array.isArray(battleViews.defenses) || !battleViews.defenses.length) return battleViews;
      try {
        await queue;
        const data = await read();
        const notes = new Map(data.notes.filter((entry) => entry.playerTag === playerTag)
          .map((entry) => [entry.battleId, entry.note]));
        return {
          ...battleViews,
          defenses: battleViews.defenses.map((battle) => {
            let note = notes.get(battle.id);
            if (note === undefined && Array.isArray(battle.previousIds)) {
              const previousId = battle.previousIds.find((id) => validBattleId(id) && notes.has(id));
              note = notes.get(previousId);
            }
            return { ...battle, note: note ?? "" };
          }),
        };
      } catch (error) {
        return { ...battleViews, noteLoadError: error.message };
      }
    },
  };
}
