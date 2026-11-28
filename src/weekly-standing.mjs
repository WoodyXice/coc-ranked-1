export function weeklyStanding(board, playerTag, details, origin) {
  if (!board || board.battleViews?.playerTag !== playerTag) return null;
  const sameGroup = source => source && source.groupTag === board.groupTag && source.week === board.week
    && String(source.seasonId) === String(board.seasonId);
  const findPlayer = source => source?.rows?.find(row => row.playerTag === playerTag);
  const first = findPlayer(board);
  const current = (sameGroup(details) && findPlayer(details)) || first;
  if (!current) return null;
  // The expanded table can fill a missing split only for the same scoring snapshot.
  const compatible = [current, first, sameGroup(origin) && origin.row].filter(row => row &&
    ["playerTag", "attackCount", "defenseCount", "trophies"].every(key => row[key] === current[key]));
  return { ...current,
    attackTrophies: compatible.find(row => Number.isFinite(row.attackTrophies))?.attackTrophies ?? null,
    defenseTrophies: compatible.find(row => Number.isFinite(row.defenseTrophies))?.defenseTrophies ?? null,
  };
}
