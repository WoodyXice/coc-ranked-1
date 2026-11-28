function nearestRank(anchors, rank) {
  let low = 0, high = anchors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].rank < rank) low = middle + 1;
    else high = middle;
  }
  const before = anchors[low - 1], after = anchors[low];
  if (!before) return after;
  if (!after) return before;
  return rank - before.rank <= after.rank - rank ? before : after;
}

function tagHash(tag) {
  let value = 2166136261;
  for (const char of tag) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return (value ^ value >>> 16) >>> 0;
}

// Give every background player a separate cell. Start near a representative with
// the same category and a neighbouring rank, then expand locally to find room.
export function buildPopulationLayer(players, anchors, width, height) {
  if (!anchors.length || !(width > 0 && height > 0)) return { points: [], radius: 0, hitTest: () => null };
  const sorted = [...anchors].sort((a, b) => a.rank - b.rank);
  const groups = new Map();
  for (const anchor of sorted) {
    if (!groups.has(anchor.cluster)) groups.set(anchor.cluster, []);
    groups.get(anchor.cluster).push(anchor);
  }
  const anchorTags = new Set(anchors.map(p => p.playerTag));
  const remaining = players.filter(player => !anchorTags.has(player.playerTag));
  if (!remaining.length) return { points: [], radius: 0, hitTest: () => null };
  const step = Math.min(9, Math.sqrt(width * height / (remaining.length * 2.2)));
  const columns = Math.floor(width / step), rows = Math.floor(height / step);
  const radius = Math.max(.65, Math.min(2.6, step * .31));
  const cells = new Int32Array(columns * rows); // zero = available, -1 = foreground hit target
  function visit(cx, cy, range, callback) {
    for (let y = Math.max(0, cy - range); y <= Math.min(rows - 1, cy + range); y++) {
      for (let x = Math.max(0, cx - range); x <= Math.min(columns - 1, cx + range); x++) {
        callback(x, y, y * columns + x);
      }
    }
  }
  for (const anchor of anchors) {
    const clearance = Math.max(12, (anchor.radius ?? 8) + 4) + radius + step * .25;
    visit(Math.floor(anchor.x / step), Math.floor(anchor.y / step), Math.ceil(clearance / step), (x, y, cell) => {
      if (((x + .5) * step - anchor.x) ** 2 + ((y + .5) * step - anchor.y) ** 2 <= clearance ** 2) cells[cell] = -1;
    });
  }

  const cloud = Math.sqrt(width * height / anchors.length) * .85;
  const points = [];
  for (const player of remaining) {
    const anchor = nearestRank(groups.get(player.cluster) ?? sorted, player.rank);
    const seed = tagHash(player.playerTag);
    const angle = (seed & 65535) / 65536 * Math.PI * 2;
    const distance = Math.sqrt((seed >>> 16) / 65536) * cloud;
    const cx = Math.min(columns - 1, Math.max(0, Math.floor((anchor.x + distance * Math.cos(angle)) / step)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((anchor.y + distance * .76 * Math.sin(angle)) / step)));
    let x = cx, y = cy, cell = cy * columns + cx;
    if (cells[cell] !== 0) {
      // Walk square perimeters. Each candidate cell is checked only once.
      let found = false;
      for (let r = 1; !found && r < Math.max(rows, columns); r++) {
        for (let i = -r; !found && i < r; i++) {
          const offsets = [[i, -r], [r, i], [-i, r], [-r, -i]];
          for (let j = 0; j < 4; j++) {
            const [dx, dy] = offsets[(j + (seed & 3)) % 4];
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
            if (cells[ny * columns + nx] !== 0) continue;
            x = nx; y = ny; cell = ny * columns + nx; found = true; break;
          }
        }
      }
      if (!found) continue;
    }
    // Subcell jitter keeps the field organic without merging identities.
    const px = (x + .3 + ((seed >>> 8) & 255) * .4 / 255) * step;
    const py = (y + .3 + ((seed >>> 16) & 255) * .4 / 255) * step;
    cells[cell] = points.length + 1;
    points.push({ x: px, y: py, playerTag: player.playerTag, known: player.cluster != null });
  }
  function hitTest(x, y) {
    if (!(x >= 0 && y >= 0 && x < width && y < height)) return null;
    const reach = radius + Math.min(step * .33, 2.6);
    let nearest = reach * reach, tag = null;
    visit(Math.floor(x / step), Math.floor(y / step), Math.ceil(reach / step), (_x, _y, cell) => {
      const point = points[cells[cell] - 1];
      if (!point) return;
      const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
      if (distance < nearest) { nearest = distance; tag = point.playerTag; }
    });
    return tag;
  }
  return { points, radius, hitTest };
}
