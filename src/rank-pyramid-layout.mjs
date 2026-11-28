// Vertical bands follow actual leaderboard ranks, including gaps in a partial response.
const bands = [
  { first: 4, last: 10, rows: 2, start: .06, end: .19 },
  { first: 11, last: 30, rows: 3, start: .23, end: .40 },
  { first: 31, last: 80, rows: 4, start: .44, end: .65 },
  { first: 81, last: 200, rows: 6, start: .68, end: 1 },
];

// Best-candidate sampling spreads points without putting them on a grid. Each band has
// its own seed so refreshing metrics or missing some players cannot move other bands.
function bandPoints(band, count, top, height, center, shoulder, base) {
  let seed = band.first * 131;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function point(depth, across) {
    const progress = band.start + depth * (band.end - band.start);
    const span = shoulder + (base - shoulder) * progress;
    const drift = (base - shoulder) * .11 * Math.sin(progress * 8);
    const left = span * (1 + .06 * Math.sin(progress * 13));
    const right = span * (1 - .05 * Math.sin(progress * 10));
    return { x: center + drift - left + across * (left + right), y: top + 8 + depth * (height - 16) };
  }
  const points = [point(.67, .01), point(.84, .99)];
  while (points.length < count) {
    let best, bestDistance = -1;
    for (let attempt = 0; attempt < 280; attempt++) {
      const candidate = point(random(), random());
      let nearest = Infinity;
      for (const other of points) {
        const squared = (candidate.x - other.x) ** 2 + (candidate.y - other.y) ** 2;
        nearest = Math.min(nearest, squared);
        if (nearest <= bestDistance) break;
      }
      if (nearest > bestDistance) {
        best = candidate;
        bestDistance = nearest;
      }
      if (attempt >= 19 && bestDistance > 16 ** 2) break;
    }
    points.push(best);
  }
  return points.sort((a, b) => a.y - b.y);
}

// Only trade nearby slots within one rank band. Unknown observations keep their
// original position and a little horizontal mixing reveals overlap between groups.
function arrangeByAffinity(members, points, sliceHeight, width) {
  const placed = points.slice();
  for (let start = 0; start < points.length;) {
    let end = start + 1;
    while (end < points.length && points[end].y < points[start].y + sliceHeight) end++;
    const known = [];
    for (let i = start; i < end; i++) {
      const affinity = members[i]?.affinity;
      if (Number.isFinite(affinity)) {
        known.push({ i, preference: Math.max(0, Math.min(1, affinity)) + .16 * points[i].x / width });
      }
    }
    const slots = known.map(({ i }) => points[i]).sort((a, b) => a.x - b.x);
    known.sort((a, b) => a.preference - b.preference);
    known.forEach(({ i }, j) => { placed[i] = slots[j]; });
    start = end;
  }
  return placed;
}

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

  const rise = Math.max(23, Math.min(31, canvas / 40));
  for (const [index, band] of bands.entries()) {
    const members = slots(band.first, band.last);
    const averageWidth = 2 * shoulder + (base - shoulder) * (band.start + band.end);
    const height = 16 + Math.max(band.rows * rise, members.length * 420 / averageWidth);
    const points = bandPoints(band, members.length, y, height, center, shoulder, base);
    const placed = arrangeByAffinity(members, points, rise * 1.45, canvas);
    members.forEach((row, i) => {
      if (row) players.push({ ...row, ...placed[i], tier: index + 2 });
    });
    y += height;
  }
  const bottom = players.reduce((value, player) => Math.max(value, player.y + (player.tier < 2 ? 55 : 22)), 100);
  return { height: Math.ceil(bottom), players };
}
