// Group-level views shared by the app and the Excel export.

export const DEFENSE_TOP_N = 10;

function averageStarsTaken(row) {
  return Number.isFinite(row.defenseStars) && row.defenseCount > 0 ? row.defenseStars / row.defenseCount : null;
}

// Rank by defense trophies (high first); ties go to fewer stars taken per defense, then the official rank.
export function defenseRanks(standings = []) {
  const ranked = standings.filter((row) => row?.playerTag && Number.isFinite(row.defenseTrophies));
  ranked.sort((a, b) => b.defenseTrophies - a.defenseTrophies
    || (averageStarsTaken(a) ?? Infinity) - (averageStarsTaken(b) ?? Infinity)
    || (a.rank ?? Infinity) - (b.rank ?? Infinity));
  return new Map(ranked.map((row, index) => [row.playerTag, index + 1]));
}
