import { measuredValue } from "./network-metrics.mjs";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const byRank = (a, b) => a.rank - b.rank || a.playerTag.localeCompare(b.playerTag);

function randomFor(tag) {
  let seed = 2166136261;
  for (const c of tag) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function representatives(ranked, categories, limit, sizeBy) {
  if (ranked.length <= limit) return ranked;
  const selected = new Set();
  const add = player => { if (player && selected.size < limit) selected.add(player); };
  const value = player => sizeBy === "sample" ? player.stats?.attackCount : measuredValue(player.stats, sizeBy);
  const priority = sizeBy === "rank" ? ranked : [...ranked].sort((a, b) =>
    (value(b) ?? -Infinity) - (value(a) ?? -Infinity) || byRank(a, b));
  ranked.slice(0, 3).forEach(add);
  if (sizeBy !== "rank") priority.slice(0, 3).forEach(add);
  add(ranked.at(-1));
  const leaders = new Map();
  for (const player of priority) {
    if (!leaders.has(player.cluster)) leaders.set(player.cluster, player);
  }
  for (const { key } of categories) add(leaders.get(key));
  // Retain ranks throughout the table, even when several categories share the same leaders.
  const intervals = Math.max(2, limit - selected.size);
  for (let j = 0; j < intervals; j++) add(ranked[Math.round(j * (ranked.length - 1) / (intervals - 1))]);
  // Fill quantile collisions with another member of the least-represented category.
  while (selected.size < limit) {
    const counts = new Map();
    for (const player of selected) counts.set(player.cluster, (counts.get(player.cluster) ?? 0) + 1);
    let next;
    for (const player of priority) {
      if (selected.has(player)) continue;
      if (!next || (counts.get(player.cluster) ?? 0) < (counts.get(next.cluster) ?? 0)) next = player;
    }
    add(next);
  }
  return [...selected].sort(byRank);
}

// Independent anchors give each category a place on the map. A loose vertical rank bias
// still puts stronger ranks higher without forcing each rank into a prescribed row.
const anchors = [[.76,.28],[.25,.59],[.76,.76],[.29,.23],[.48,.70],[.52,.42],[.87,.52],[.12,.34]];
function positionPlayers(selected, categories, width, height) {
  const insetX = clamp(width * .061, 21, 78);
  const insetY = 33;
  const spanX = width - insetX * 2;
  const spanY = height - insetY * 2;
  const gap = clamp(Math.sqrt(spanX * spanY / selected.length) * .80, 34, 118);
  const centers = new Map(categories.map(({ key }, i) => {
    const anchor = anchors[i] ?? [.15 + ((i * .618) % .70), .18 + ((i * .414) % .64)];
    return [key, categories.length === 1 ? [.5, .5] : anchor];
  }));
  const nodes = [];
  for (const player of selected) {
    const random = randomFor(player.playerTag);
    const center = centers.get(player.cluster);
    const rankFraction = (player.rank - selected[0].rank) / (selected.at(-1).rank - selected[0].rank || 1);
    const targetX = center ? center[0] : .13 + random() * .74;
    const targetY = (center?.[1] ?? .5) * .44 + (.08 + .84 * rankFraction) * .56;
    const spreadX = categories.length < 2 ? .55 : .29;
    const desiredX = insetX + spanX * clamp(targetX + (random() - .5) * spreadX, .03, .97);
    const desiredY = insetY + spanY * clamp(targetY + (random() - .5) * .31, .02, .98);
    let best, lowest = Infinity;
    for (let i = 0; i < 170; i++) {
      const x = i ? insetX + spanX * random() : desiredX;
      const y = i ? insetY + spanY * random() : desiredY;
      let nearestSquared = gap * gap;
      for (const p of nodes) nearestSquared = Math.min(nearestSquared, (p.x - x) ** 2 + (p.y - y) ** 2);
      const clearance = Math.sqrt(nearestSquared);
      const cost = ((x - desiredX) / spanX) ** 2 + ((y - desiredY) / spanY) ** 2
        + 9 * ((gap - clearance) / gap) ** 2;
      if (cost < lowest) { best = { x, y }; lowest = cost; }
    }
    nodes.push({ ...player, ...best });
  }
  return nodes;
}

const outwardness = (p, width, height) => Math.hypot(2 * p.x / width - 1, 2 * p.y / height - 1);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function makeRibbon(a, b, width, height) {
  // The narrow end points back toward the centre. The broad, curved rim is on the
  // periphery, with the two actual members defining its orientation and length.
  if (outwardness(a, width, height) > outwardness(b, width, height)) [a, b] = [b, a];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
  const center = midpoint(a, b);
  const halfLength = length / 2 + Math.min(width * .047, height * .14);
  const breadth = Math.min(width * .097, height * .175, halfLength * .70);
  function local(u, v) {
    return {
      x: Math.round(clamp(center.x + u * halfLength * dx - v * breadth * dy, 4, width - 4)),
      y: Math.round(clamp(center.y + u * halfLength * dy + v * breadth * dx, 4, height - 4)),
    };
  }
  const rim = [[-1.25,-.12],[-.57,-.43],[.17,-.94],[.87,-.96],[1.11,-.32],
    [.97,.71],[.57,.92],[-.05,.54],[-.67,.31]].map(([u, v]) => local(u, v));
  const path = p => `${Math.round(p.x)} ${Math.round(p.y)}`;
  const start = midpoint(rim.at(-1), rim[0]);
  const curves = rim.map((p, i) => `Q ${path(p)} ${path(midpoint(p, rim[(i + 1) % rim.length]))}`);
  return { rim, d: `M ${path(start)} ${curves.join(" ")} Z`, label: local(.28, -.65), center };
}

// Mark only cells inside the proposed tint. Bounding boxes alone reject diagonal
// neighbours that can sit close together without touching.
function ribbonCells(rim, width, height) {
  const cells = [];
  const sx = width / 44, sy = height / 28;
  for (let row = 0; row < 28; row++) {
    const y = (row + .5) * sy;
    const xs = [];
    for (let i = 0; i < rim.length; i++) {
      const a = rim[i], b = rim[(i + 1) % rim.length];
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i += 2) {
      for (let col = Math.ceil(xs[i] / sx - .5); col + .5 < xs[i + 1] / sx; col++) cells.push(row * 44 + col);
    }
  }
  return cells;
}

function territories(categories, nodes, width, height) {
  const painted = new Set();
  const zones = [];
  for (const { key } of categories) {
    const allMembers = nodes.filter(p => p.cluster === key);
    // The tint represents a local pair. Bounded candidates keep one dominant style cheap to lay out.
    const members = allMembers.length <= 18 ? allMembers : Array.from({ length: 18 }, (_, i) =>
      allMembers[Math.round(i * (allMembers.length - 1) / 17)]);
    let best, bestScore = -Infinity;
    for (let i = 0; i < members.length; i++) {
      for (const b of members.slice(i + 1)) {
        const a = members[i];
        const length = Math.hypot(a.x - b.x, a.y - b.y);
        if (length > Math.min(width * .32, height * .78)) continue;
        const ribbon = makeRibbon(a, b, width, height);
        const cells = ribbonCells(ribbon.rim, width, height);
        const covered = cells.filter(cell => painted.has(cell)).length;
        const area = cells.length / (44 * 28);
        if (area < .018 || area > .096 || covered > cells.length * .055) continue;
        const central = cells.filter(cell => Math.abs(cell % 44 + .5 - 22) < 7 && Math.abs(Math.floor(cell / 44) + .5 - 14) < 6).length;
        const score = outwardness(ribbon.center, width, height) - 7 * Math.abs(area - .071)
          - (3 * covered + 1.5 * central) / cells.length;
        if (score > bestScore) { best = { ribbon, cells }; bestScore = score; }
      }
    }
    if (!best) continue;
    const { ribbon, cells } = best;
    cells.forEach(cell => painted.add(cell));
    zones.push({ key, d: ribbon.d, ...ribbon.label });
    if (zones.length >= (width < 520 ? 3 : 4)) break;
  }
  return zones;
}

function mapEdges(nodes, width, height, mode) {
  const uses = nodes.map(node => new Set((node.uses ?? []).map(entry => entry.strategy).filter(Boolean)));
  const pairs = [];
  const maxLength = Math.min(Math.hypot(width, height) * .33, 320);
  const bridgeLength = Math.min(Math.hypot(width, height) * .52, 500);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const same = a.cluster != null && a.cluster === b.cluster;
      const shared = [...uses[i]].some(style => uses[j].has(style));
      if (!(mode === "style" ? shared : same)) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance <= maxLength || (mode === "style" && !same && distance <= bridgeLength)) {
        pairs.push({ i, j, distance, cross: !same });
      }
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);
  const degree = nodes.map(() => 0);
  const edges = [];
  // Preserve room for the player dots as density rises, especially when a popular style connects everyone.
  const edgeLimit = Math.min(Math.ceil(nodes.length * 1.25), width < 520 ? 30 : width < 800 ? 52 : 76);
  function link(pair) {
    const { i, j } = pair;
    edges.push({ a: nodes[i], b: nodes[j] });
    degree[i]++; degree[j]++; pair.used = true;
  }
  if (mode === "style" && nodes.length >= 8) {
    // A few links between different primary styles reveal genuine secondary-style
    // overlaps. Prefer bridges across the open centre, each with its own endpoints.
    const bridges = pairs.filter(pair => pair.cross && pair.distance >= maxLength * .65);
    const cost = pair => outwardness(midpoint(nodes[pair.i], nodes[pair.j]), width, height)
      + .65 * Math.abs(pair.distance / bridgeLength - .80);
    bridges.sort((a, b) => cost(a) - cost(b));
    const linkedGroups = new Set();
    for (const pair of bridges) {
      const key = JSON.stringify([nodes[pair.i].cluster, nodes[pair.j].cluster].sort());
      if (linkedGroups.has(key) || degree[pair.i] || degree[pair.j]) continue;
      link(pair);
      linkedGroups.add(key);
      if (edges.length >= (width < 520 ? 2 : 3)) break;
    }
  }
  // Give remote members their closest eligible link first, then add a few local triangles.
  for (const connectIsolated of [true, false]) {
    for (const pair of pairs) {
      const { i, j } = pair;
      if (pair.distance > maxLength || pair.used || degree[i] >= 3 || degree[j] >= 3) continue;
      if (connectIsolated && degree[i] && degree[j]) continue;
      link(pair);
      if (edges.length >= edgeLimit) return edges;
    }
  }
  return edges;
}

const densityLimits = {
  sparse: [12, 19, 28],
  standard: [20, 36, 56],
  dense: [30, 60, 92],
  all: [12, 19, 28],
};

export function buildStrategyMap(players, groups, width, sizeBy = "rank", mode = "style", density = "standard") {
  const band = width < 520 ? 0 : width < 800 ? 1 : 2;
  const limit = (densityLimits[density] ?? densityLimits.standard)[band];
  const visible = Math.min(players.length, limit);
  const extraHeight = Math.max(0, visible - densityLimits.sparse[band]) * (band === 0 ? 6 : 2.5);
  // All-player mode keeps a few foreground anchors; its canvas needs space for everyone else.
  const canvasHeight = density === "all" ? Math.min(160, Math.max(0, players.length - limit) / 2) : 0;
  const height = players.length <= 3 ? 140 + 20 * players.length :
    Math.round(clamp(width * .34, 320, 450) + Math.max(extraHeight, canvasHeight));
  if (!players.length) return { nodes: [], height, zones: [], edges: [] };
  const ranked = [...players].sort(byRank);
  const counts = new Map();
  for (const player of ranked) counts.set(player.cluster, (counts.get(player.cluster) ?? 0) + 1);
  const categories = groups.filter(group => counts.has(group.key))
    .sort((a, b) => counts.get(b.key) - counts.get(a.key) || a.key.localeCompare(b.key));
  const nodes = positionPlayers(representatives(ranked, categories, limit, sizeBy), categories, width, height);
  const zones = territories(categories, nodes, width, height);
  return { nodes, height, zones, edges: mapEdges(nodes, width, height, mode) };
}
