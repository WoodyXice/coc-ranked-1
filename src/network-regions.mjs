// A local density contour can have several islands and holes. Each sample is one
// player in the requested set regardless of how many battles they contributed.
export function buildNetworkRegion(points, width, height) {
  if (!points.length || !(width > 0 && height > 0) || !Number.isFinite(width + height)) return "";
  const radiusX = Math.max(25, Math.min(58, width * .052));
  const radiusY = radiusX * .8;
  const pitch = radiusX / 6;
  const nx = Math.ceil(width / pitch);
  const ny = Math.ceil(height / pitch);
  const dx = width / nx;
  const dy = height / ny;
  // One empty border around the sampled viewport closes contours at its edges.
  const stride = nx + 3;
  const density = new Float64Array(stride * (ny + 3));
  for (const { x, y } of points) {
    if (!Number.isFinite(x + y) || x < 0 || x > width || y < 0 || y > height) continue;
    const firstX = Math.max(0, Math.ceil((x - radiusX) / dx));
    const lastX = Math.min(nx, Math.floor((x + radiusX) / dx));
    const firstY = Math.max(0, Math.ceil((y - radiusY) / dy));
    const lastY = Math.min(ny, Math.floor((y + radiusY) / dy));
    for (let j = firstY; j <= lastY; j++) {
      const ry = (j * dy - y) / radiusY;
      for (let i = firstX; i <= lastX; i++) {
        const rx = (i * dx - x) / radiusX;
        const weight = Math.max(0, 1 - rx * rx - ry * ry);
        density[(j + 1) * stride + i + 1] += weight * weight;
      }
    }
  }

  // Marching squares. The low bit identifies a vertical grid edge. The
  // remaining bits identify its upper or left endpoint across adjacent cells.
  const threshold = .64;
  const links = new Map();
  function join(a, b) {
    if (links.has(a)) links.get(a).push(b);
    else links.set(a, [b]);
    if (links.has(b)) links.get(b).push(a);
    else links.set(b, [a]);
  }
  for (let j = 0; j < ny + 2; j++) {
    for (let i = 0; i < nx + 2; i++) {
      const top = j * stride + i;
      const bottom = top + stride;
      const tl = density[top] >= threshold, tr = density[top + 1] >= threshold;
      const bl = density[bottom] >= threshold, br = density[bottom + 1] >= threshold;
      if (tl === tr && tl === bl && tl === br) continue;
      const edges = [];
      if (tl !== tr) edges.push(2 * top);
      if (tr !== br) edges.push(2 * (top + 1) + 1);
      if (bl !== br) edges.push(2 * bottom);
      if (tl !== bl) edges.push(2 * top + 1);
      if (edges.length === 4) {
        const center = (density[top] + density[top + 1] + density[bottom] + density[bottom + 1]) / 4;
        if ((center >= threshold) !== tl) edges.push(edges.shift());
        join(edges[2], edges[3]);
      }
      join(edges[0], edges[1]);
    }
  }

  function crossing(edge) {
    const start = Math.floor(edge / 2);
    const vertical = edge % 2 === 1;
    const end = start + (vertical ? stride : 1);
    const t = (threshold - density[start]) / (density[end] - density[start]);
    const x = ((start % stride) - 1 + (vertical ? 0 : t)) * dx;
    const y = (Math.floor(start / stride) - 1 + (vertical ? t : 0)) * dy;
    return [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))];
  }
  const visited = new Set();
  const paths = [];
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const ring = [];
    let previous, edge = start;
    do {
      visited.add(edge);
      ring.push(crossing(edge));
      const [a, b] = links.get(edge);
      [previous, edge] = [edge, previous === a ? b : a];
    } while (edge !== start);
    // Quadratic joins soften grid crossings without carrying the boundary
    // beyond the viewport or introducing sharp corners between nearby players.
    const point = (x, y) => `${+x.toFixed(1)} ${+y.toFixed(1)}`;
    const mid = (a, b) => point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    paths.push("M" + mid(ring.at(-1), ring[0]));
    ring.forEach((p, index) => paths.push("Q" + point(...p) + " " + mid(p, ring[(index + 1) % ring.length])));
    paths.push("Z");
  }
  return paths.join("");
}
