import "./atlas-edges.css";

export default function AtlasEdges({ edges, current }) {
  const interval = Math.max(3, Math.ceil(edges.length / 9));
  return <g className={`atlas-edges${current ? " has-focus" : ""}`} aria-hidden="true" pointerEvents="none">
    {edges.map(({ a, b, d, kind }, index) => {
      const selected = current && (a.playerTag === current.playerTag || b.playerTag === current.playerTag);
      const moving = selected || (!current && index % interval === 0);
      const duration = 3.5 + Math.hypot(a.x - b.x, a.y - b.y) / 100;
      return <g key={`${a.playerTag}:${b.playerTag}`}
        className={`atlas-link atlas-link-${kind}${selected ? " is-selected" : ""}`}>
        <path className="atlas-link-track" d={d} />
        {moving && <g className="atlas-link-flow" style={{
          "--travel-time": `${duration}s`,
          "--travel-offset": `${-duration * ((.23 + index * .618) % 1)}s`,
        }}>
          <path className="atlas-link-trail" d={d} pathLength="100" />
          <path className="atlas-link-pulse" d={d} pathLength="100" />
        </g>}
      </g>;
    })}
  </g>;
}
