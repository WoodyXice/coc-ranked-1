// Vertical bands follow actual leaderboard ranks, including gaps in a partial response.
const bands = [
  { first: 4, last: 10, rows: 2, start: .06, end: .19 },
  { first: 11, last: 30, rows: 3, start: .23, end: .40 },
  { first: 31, last: 80, rows: 4, start: .44, end: .65 },
  { first: 81, last: 200, rows: 6, start: .68, end: 1 },
];

export function buildRankPyramid(rows, width) {
  const canvas = Number.isFinite(width) && width > 0 ? width : 960;
  const center = canvas / 2;
  const margin = Math.min(canvas * .11, 152);
  const base = center - margin;
  const shoulder = Math.max(Math.min(canvas * .20, 85), base * .21);
  const byRank = new Map();
  for (const row of rows) {
    if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > 200) continue;
    if (!byRank.has(row.rank)) byRank.set(row.rank, []);
    byRank.get(row.rank).push(row);
  }
  // Empty slots keep a player's position stable when another rank has no data.
  function slots(first, last) {
    const result = [];
    for (let rank = first; rank <= last; rank++) result.push(...(byRank.get(rank) ?? [null]));
    return result;
  }
  const players = [];
  let y = 24;
  for (const [tier, first, last] of [[0, 1, 1], [1, 2, 3]]) {
    const members = slots(first, last);
    members.forEach((row, index) => {
      const x = members.length === 1 ? center : center + shoulder * (2 * index / (members.length - 1) - 1);
      if (row) players.push({ ...row, x, y, tier });
    });
    y += 63; // Two lines below each podium marker for the player name and tag.
  }

  const rise = Math.max(20, Math.min(27, canvas / 44));
  for (const [index, band] of bands.entries()) {
    const members = slots(band.first, band.last);
    const halfSpan = progress => shoulder + (base - shoulder) * progress;
    const averageWidth = halfSpan((band.start + band.end) / 2) * 2;
    const count = Math.max(band.rows, Math.ceil(members.length / (1 + averageWidth / 19)));
    const spans = Array.from({ length: count }, (_, line) =>
      halfSpan(band.start + (band.end - band.start) * line / (count - 1)));
    // Apportion slots by row width so the base spreads out without squeezing its tips.
    const total = spans.reduce((sum, span) => sum + span, 0);
    let cumulative = 0;
    let start = 0;
    for (const [line, span] of spans.entries()) {
      cumulative += span;
      const end = Math.round(cumulative / total * members.length);
      const size = end - start;
      const spacing = size > 1 ? span * 2 / (size - 1) : 0;
      for (let slot = start; slot < end; slot++) {
        const row = members[slot];
        if (!row) continue;
        const position = slot - start;
        // Small deterministic offsets break vertical alignments while preserving reading order.
        const phase = slot * 2.4 + line * 1.37 + band.first;
        const offsetX = Math.sin(phase) * Math.min(spacing * .08, 4);
        const offsetY = Math.cos(phase * 1.7) * 2.3;
        const x = size > 1 ? center - span + spacing * position + offsetX : center;
        players.push({ ...row, x, y: y + offsetY, tier: index + 2 });
      }
      start = end;
      y += rise;
    }
    y += 5;
  }
  const bottom = players.reduce((value, player) => Math.max(value, player.y + (player.tier < 2 ? 55 : 22)), 100);
  return { height: Math.ceil(bottom), players };
}
