import { regionContains } from "./strategy-map-layout.mjs";

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
export function buildPopulationLayer(players, anchors, width, height, regions = [], excludedBoxes = []) {
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
  if (regions.length) return populationInRegions(remaining, anchors, width, height, regions, excludedBoxes);
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
  for (const box of excludedBoxes) {
    const margin = radius + step * .25;
    const x0 = Math.max(0, Math.floor((box.x - margin) / step)), x1 = Math.min(columns - 1, Math.floor((box.x + box.width + margin) / step));
    const y0 = Math.max(0, Math.floor((box.y - margin) / step)), y1 = Math.min(rows - 1, Math.floor((box.y + box.height + margin) / step));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * columns + x] = -1;
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
    points.push({ x: px, y: py, playerTag: player.playerTag, known: player.cluster != null, color: player.pointColor ?? "#89969c" });
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

function populationInRegions(players, anchors, width, height, regions, boxes) {
  const groups = Map.groupBy(players, player => player.cluster ?? null);
  const points = [];
  const radius = Math.min(2.9, Math.sqrt(width * height / players.length) * .17);
  for (const region of regions) {
    const members = groups.get(region.key);
    if (!members?.length) continue;
    const bounds = region.bounds;
    // Near an intersection boundary, a neighbouring region's marker can share
    // this region's surface hit target.
    const foreground = anchors.filter(anchor => {
      const padding = Math.max(12, (anchor.radius ?? 8) + 4) + radius;
      return anchor.x + padding >= bounds.x && anchor.x - padding <= bounds.x + bounds.width
        && anchor.y + padding >= bounds.y && anchor.y - padding <= bounds.y + bounds.height;
    });
    const labels = boxes.filter(box => box.x < bounds.x + bounds.width && box.x + box.width > bounds.x
      && box.y < bounds.y + bounds.height && box.y + box.height > bounds.y);
    let step = Math.sqrt(bounds.width * bounds.height / (members.length * 1.8));
    let seats;
    // Reduce the cell size locally if labels and foreground hit targets consume
    // too much of this area. A reserved point never spills into a different colour.
    for (let attempt = 0; attempt < 7; attempt++, step *= .72) {
      seats = [];
      const columns = Math.max(1, Math.ceil(bounds.width / step));
      const rows = Math.max(1, Math.ceil(bounds.height / step));
      const dx = bounds.width / columns, dy = bounds.height / rows;
      const randomSeed = tagHash(String(region.key));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const seed = Math.imul((row * columns + col) ^ randomSeed, 0x9e3779b1) >>> 0;
          const px = bounds.x + (col + .29 + (seed & 255) * .42 / 255) * dx;
          const py = bounds.y + (row + .29 + ((seed >>> 16) & 255) * .42 / 255) * dy;
          if (!regionContains(region, px, py, radius + .1)) continue;
          if (labels.some(box => px >= box.x - radius && px <= box.x + box.width + radius
            && py >= box.y - radius && py <= box.y + box.height + radius)) continue;
          if (foreground.some(anchor => (px - anchor.x) ** 2 + (py - anchor.y) ** 2 < (Math.max(12, (anchor.radius ?? 8) + 4) + radius) ** 2)) continue;
          seats.push({ x: px, y: py, order: seed });
        }
      }
      if (seats.length >= members.length) break;
    }
    seats.sort((a, b) => a.order - b.order);
    const selected = seats.slice(0, members.length).sort((a, b) => a.y - b.y);
    for (const [index, seat] of selected.entries()) {
      const player = members[index];
      points.push({ x: seat.x, y: seat.y, playerTag: player.playerTag, known: region.key !== null, color: player.pointColor ?? "#89969c" });
    }
  }
  const reach = radius + Math.min(2.6, radius * .85);
  const columns = Math.ceil(width / reach);
  const cells = Map.groupBy(points, p => Math.floor(p.y / reach) * columns + Math.floor(p.x / reach));
  function hitTest(x, y) {
    if (!(x >= 0 && y >= 0 && x < width && y < height)) return null;
    const col = Math.floor(x / reach), row = Math.floor(y / reach);
    let closest = reach * reach, tag = null;
    for (let j = Math.max(0, row - 1); j <= row + 1; j++) {
      for (let i = Math.max(0, col - 1); i <= Math.min(columns - 1, col + 1); i++) {
        for (const point of cells.get(j * columns + i) ?? []) {
          const d = (point.x - x) ** 2 + (point.y - y) ** 2;
          if (d < closest) { closest = d; tag = point.playerTag; }
        }
      }
    }
    return tag;
  }
  return { points, radius, hitTest };
}
