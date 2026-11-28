const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const fontFamily = 'Arial, "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';

function textMeasurer() {
  const context = globalThis.document?.createElement("canvas").getContext("2d");
  const cache = new Map();
  return (text, size) => {
    const key = size + text;
    if (cache.has(key)) return cache.get(key);
    let width = 0;
    if (context) {
      context.font = `${size === 11 ? 600 : 500} ${size}px ${fontFamily}`;
      const metrics = context.measureText(text);
      width = Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight);
    } else {
      for (const { segment } of graphemes.segment(text)) {
        const em = /^[ilI., '!]$/.test(segment) ? .4 : /^[\x20-\x7e]$/.test(segment) ? .76 : 1.1;
        width += size * em;
      }
    }
    cache.set(key, width);
    return width;
  };
}

function fittedName(prefix, name, maxWidth, measure) {
  if (measure(prefix + name, 11) <= maxWidth) return prefix + name;
  let kept = "";
  for (const { segment } of graphemes.segment(name)) {
    if (measure(prefix + kept + segment + "…", 11) > maxWidth) break;
    kept += segment;
  }
  return prefix + kept + "…";
}

function positions(node, width, withTag) {
  const { x, y, radius } = node;
  const offset = radius + 6;
  const belowBaseline = withTag ? 16 : 3;
  const sideY = y + (11 - belowBaseline) / 2;
  const right = [x + offset, sideY, "start"];
  const left = [x - offset, sideY, "end"];
  const positions = x < width / 2 ? [right, left] : [left, right];
  positions.push([x, y - offset - belowBaseline, "middle"], [x, y + offset + 11, "middle"]);
  for (const sign of [1, -1]) {
    const sideX = x + sign * offset * .72;
    const anchor = sign === 1 ? "start" : "end";
    positions.push([sideX, y - offset * .72 - belowBaseline, anchor], [sideX, y + offset * .72 + 11, anchor]);
  }
  return positions;
}

function isFree(box, width, height, occupied, circles) {
  if (box.left < 2 || box.right > width - 2 || box.top < 2 || box.bottom > height - 2) return false;
  if (occupied.some(rect => box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top)) return false;
  return !circles.some(({ x, y, radius }) => {
    const dx = Math.max(box.left - x, 0, x - box.right);
    const dy = Math.max(box.top - y, 0, y - box.bottom);
    return dx * dx + dy * dy < (radius + 1) ** 2;
  });
}

function placeOne(node, width, height, measure, occupied, circles) {
  const tag = node.playerTag.startsWith("#") ? node.playerTag : "#" + node.playerTag;
  const name = node.playerName?.trim() || tag;
  const prefix = `#${node.rank} `;
  const wide = fittedName(prefix, name, width < 560 ? 92 : 126, measure);
  const short = fittedName(prefix, name, width < 560 ? 62 : 78, measure);
  const variants = [];
  if (node.rank <= 3 && name !== tag) variants.push([wide, tag]);
  variants.push([wide], ...(wide === short ? [] : [[short]]));

  for (const [text, secondLine] of variants) {
    const lineWidth = Math.max(measure(text, 11), secondLine ? measure(secondLine, 10) : 0);
    for (const [x, y, anchor] of positions(node, width, !!secondLine)) {
      const left = anchor === "start" ? x : anchor === "end" ? x - lineWidth : x - lineWidth / 2;
      const box = { left: left - 2, right: left + lineWidth + 2, top: y - 13, bottom: y + (secondLine ? 18 : 5) };
      if (isFree(box, width, height, occupied, circles)) {
        occupied.push(box);
        return secondLine ? { x, y, anchor, text, tag: secondLine } : { x, y, anchor, text };
      }
    }
  }
}

// x/y are first-line SVG baselines. An optional tag uses the same anchor at y + 13.
export function placeMapLabels(nodes, width, height, { reserved = [], obstacles = [] } = {}) {
  const labels = new Map();
  if (!(width > 0 && height > 0)) return labels;
  const validPoint = node => Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.radius) && node.radius >= 0;
  const circles = [...nodes, ...obstacles].filter(validPoint);
  const pending = nodes.filter(node => validPoint(node) && node.playerTag && Number.isFinite(node.rank))
    .sort((a, b) => a.rank - b.rank || (a.playerTag < b.playerTag ? -1 : a.playerTag > b.playerTag ? 1 : 0));
  const occupied = reserved.map(rect => ({ left: rect.x - 2, top: rect.y - 2, right: rect.x + rect.width + 2, bottom: rect.y + rect.height + 2 }));
  const measure = textMeasurer();
  const limit = width < 420 ? 6 : width < 680 ? 8 : width < 1000 ? 11 : 14;
  const distance = new Map(pending.map(node => [node, Infinity]));

  while (pending.length && labels.size < limit) {
    // Place the podium first, then spread names across the map instead of labelling just the apex.
    let index = 0;
    if (pending[0].rank > 3) {
      for (let i = 1; i < pending.length; i++) {
        if (distance.get(pending[i]) > distance.get(pending[index])) index = i;
      }
    }
    const [node] = pending.splice(index, 1);
    if (labels.has(node.playerTag)) continue;
    const label = placeOne(node, width, height, measure, occupied, circles);
    if (!label) continue;
    labels.set(node.playerTag, label);
    for (const other of pending) {
      const separation = ((node.x - other.x) / width) ** 2 + ((node.y - other.y) / height) ** 2;
      distance.set(other, Math.min(distance.get(other), separation));
    }
  }
  return labels;
}
