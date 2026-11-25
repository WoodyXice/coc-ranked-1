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

export function createDefenseNoteStore(db) {
  const upsert = db.prepare(`
    INSERT INTO defense_notes (player_tag, battle_id, note, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (player_tag, battle_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `);
  const remove = db.prepare("DELETE FROM defense_notes WHERE player_tag = ? AND battle_id = ?");
  const forPlayer = db.prepare("SELECT battle_id, note FROM defense_notes WHERE player_tag = ?");

  return {
    save({ playerTag: tag, battleId, note: value } = {}) {
      const playerTag = normalizeTag(tag);
      if (!playerTag || !validBattleId(battleId)) throw new Error("这场防守缺少有效的村庄标签或战斗编号。");
      const note = normalizeNote(value);
      try {
        if (note) upsert.run(playerTag, battleId, note, new Date().toISOString());
        else remove.run(playerTag, battleId);
      } catch {
        throw new Error("无法将防守备注保存到当前 Windows 用户。");
      }
      return note;
    },

    async withNotes(battleViews) {
      const playerTag = normalizeTag(battleViews?.playerTag);
      if (!playerTag || !Array.isArray(battleViews.defenses) || !battleViews.defenses.length) return battleViews;
      let notes;
      try {
        notes = new Map(forPlayer.all(playerTag).map((row) => [row.battle_id, row.note]));
      } catch {
        return { ...battleViews, noteLoadError: "无法读取当前 Windows 用户的防守备注。" };
      }
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
    },
  };
}

// Used by the one-time import of the old defense-notes.json file.
export function validDefenseNote(entry) {
  return Boolean(entry && typeof entry.playerTag === "string" && entry.playerTag === normalizeTag(entry.playerTag)
    && validBattleId(entry.battleId) && typeof entry.note === "string" && entry.note.length);
}
