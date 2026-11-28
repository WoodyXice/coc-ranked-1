const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const number = n => Number(n.toFixed(4));
const coord = (x, y) => `${number(x)} ${number(y)}`;
const arc = (oval, large, clockwise, x, y) =>
  `A ${coord(oval.rx, oval.ry)} 0 ${large} ${clockwise} ${coord(x, y)}`;
const oval = (cx, cy, rx, ry) => ({ cx, cy, rx, ry });

function ovalPath(o, clockwise = 1) {
  return `M ${coord(o.cx - o.rx, o.cy)} ${arc(o, 0, clockwise, o.cx + o.rx, o.cy)} ${arc(o, 0, clockwise, o.cx - o.rx, o.cy)} Z`;
}

function ovalBounds(o) {
  return { x: o.cx - o.rx, y: o.cy - o.ry, width: o.rx * 2, height: o.ry * 2 };
}

function ovalContains(o, x, y, inset) {
  // Scaling about the centre keeps at least inset pixels of clearance, even
  // at the narrow ends of a very flat ellipse.
  const scale = 1 - inset / Math.min(o.rx, o.ry);
  if (scale <= 0) return false;
  return ((x - o.cx) / o.rx) ** 2 + ((y - o.cy) / o.ry) ** 2 <= scale ** 2;
}

export function overlapContains(region, x, y, pad) {
  return region.inOvals.every(o => ovalContains(o, x, y, pad))
    && !region.outOvals.some(o => ovalContains(o, x, y, -pad));
}

// One area for each actually observed combination. Full set paths are painted
// beneath these exclusive regions so the shared lens blends both set colours.
export function intersectionRegions(counts, width, height) {
  const regions = [], styleShapes = [];
  const count = key => counts.get(key) ?? 0;
  const [a, shared, b] = ["left", "both", "right"].map(count);
  const known = a + shared + b;
  const gap = 8, left = width * .035, w = width - 2 * left;
  const cy = height / 2, ry = height * .44;

  function add(key, d, inside, excluded, bounds, seedX, captionY = cy - ry * .47) {
    regions.push({ key, d, count: count(key), inOvals: inside, outOvals: excluded, bounds,
      seed: { x: seedX, y: cy }, x: seedX, y: captionY });
  }
  function addShape(key, o) {
    styleShapes.push({ key, d: ovalPath(o) });
  }
  function whole(key, o) {
    add(key, ovalPath(o), [o], [], ovalBounds(o), o.cx);
  }
  if (known && !shared) {
    // Separate silhouettes make a zero intersection explicit.
    const usable = w - (a && b ? gap : 0);
    const fraction = a && b ? clamp(a / (a + b), .20, .80) : Number(a > 0);
    const leftW = usable * fraction;
    for (const [key, x, size] of [["left", left, leftW], ["right", left + w - (usable - leftW), usable - leftW]]) {
      if (!count(key)) continue;
      const o = oval(x + size / 2, cy, size / 2, ry);
      whole(key, o);
      addShape(key, o);
    }
  } else if (shared && (!a || !b)) {
    // Nested sets when one strategy is always used by users of the other.
    const outer = oval(left + w / 2, cy, w / 2, ry);
    if (!a && !b) {
      addShape("left", outer);
      addShape("right", outer);
      whole("both", outer);
    } else {
      const sign = a ? 1 : -1;
      const scale = clamp(Math.sqrt(shared / known), .34, .78);
      const inner = oval(outer.cx + sign * .65 * (1 - scale) * outer.rx, cy, outer.rx * scale, ry * scale);
      addShape(a ? "left" : "right", outer);
      addShape(a ? "right" : "left", inner);
      whole("both", inner);
      const sx = ((outer.cx - sign * outer.rx) + (inner.cx - sign * inner.rx)) / 2;
      add(a ? "left" : "right", ovalPath(outer) + " " + ovalPath(inner, 0), [outer], [inner], ovalBounds(outer), sx);
    }
  } else if (shared) {
    const sizes = [a, shared, b].map(n => Math.sqrt(n));
    const total = sizes.reduce((s, n) => s + n);
    const min = Math.min(w * .16, 45);
    const [l, common, r] = sizes.map(n => min + (w - 3 * min) * n / total);
    const A = oval(left + (l + common) / 2, cy, (l + common) / 2, ry);
    const B = oval(left + l + (common + r) / 2, cy, (common + r) / 2, ry);
    addShape("left", A);
    addShape("right", B);
    // The ellipses have a common vertical radius. At both crossing points their
    // horizontal sections just meet, giving the exact endpoints of all SVG arcs.
    const t = (B.cx - A.cx) / (A.rx + B.rx);
    const x = A.cx + A.rx * t, dy = ry * Math.sqrt(1 - t * t);
    const y1 = cy - dy, y2 = cy + dy;
    const path = (down, up) => `M ${coord(x, y1)} ${down} ${up} Z`;
    add("left", path(arc(B, 0, 0, x, y2), arc(A, 1, 1, x, y1)), [A], [B], ovalBounds(A), left + l / 2);
    add("both", path(arc(A, 0, 1, x, y2), arc(B, 0, 1, x, y1)), [A, B], [],
      { x: left + l, y: y1, width: common, height: 2 * dy }, left + l + common / 2, cy - dy * .4);
    add("right", path(arc(B, 1, 1, x, y2), arc(A, 0, 0, x, y1)), [B], [A], ovalBounds(B), left + w - r / 2);
  }

  return { regions, styleShapes };
}
