import { useEffect, useMemo, useRef, useState } from "react";
import { buildRankPyramid } from "./rank-pyramid-layout.mjs";

const tones = ["#167d8c", "#3e6ea7", "#367c68", "#796ba6", "#a56b40", "#a65e75", "#526e8d"];
const gray = "#7b8995";

function buildNetwork(rows, metrics, strategies, width) {
  const pyramid = buildRankPyramid(rows, width);
  const height = Math.max(258, pyramid.height, 80 + Math.ceil(strategies.length / 2) * 49);
  const players = pyramid.players.map(row => {
    const stats = metrics.get(row.playerTag);
    const uses = (stats?.strategies ?? []).filter(entry => entry.scoredCount > 0);
    const primary = uses.find(entry => entry.strategy === stats?.strategy) ?? uses[0];
    return { ...row, uses, primary: primary?.strategy ?? "", stats };
  });
  const groups = strategies.map(({ strategy, playerCount, scoredCount }, i) => {
    const right = i % 2 === 1;
    const sideCount = Math.ceil((strategies.length - (right ? 1 : 0)) / 2);
    const t = (Math.floor(i/2) + .5) / sideCount;
    const y = width < 520 ? 14 + t * Math.min(height * .6, Math.max(150, sideCount * 39))
      : 26 + t * (height * .76 - 26);
    const inset = width < 620 ? 8 : 16;
    const labelW = 19 + strategy.length * 12;
    const sideX = width < 520 ? inset : Math.max(inset + labelW - 7, width * (.34 - .27 * t));
    return { name: strategy, playerCount, scoredCount, color: tones[i % tones.length],
      x: right ? width - sideX : sideX, y, textLeft: width < 520 ? right : !right, labelW, members: [] };
  });
  const groupByName = new Map(groups.map(group => [group.name, group]));
  for (const player of players) groupByName.get(player.primary)?.members.push(player);
  const sharedEdges = [];
  const usages = [];
  groups.forEach(group => {
    const others = [];
    for (const player of group.members) {
      if (others.length) {
        const near = others.map(other => ({ other, distance: (player.x - other.x) ** 2 + (player.y - other.y) ** 2 }))
          .sort((a, b) => a.distance - b.distance).slice(0, 2);
        for (const { other } of near) sharedEdges.push({ a: player, b: other, group });
      }
      others.push(player);
    }
  });
  for (const player of players) {
    player.color = groupByName.get(player.primary)?.color ?? gray;
    for (const use of player.uses) {
      const group = groupByName.get(use.strategy);
      if (group) usages.push({ player, group, use, distance: Math.hypot(group.x-player.x,group.y-player.y) });
    }
  }
  // A handful of real examples keeps the base map legible. Selecting either end reveals every match.
  for (const group of groups) {
    const examples = usages.filter(link => link.group === group).sort((a, b) => b.use.scoredCount - a.use.scoredCount
      || a.distance - b.distance || a.player.rank - b.player.rank).slice(0, width < 620 ? 2 : 4);
    for (const link of examples) link.example = true;
  }
  return { height, players, groups, sharedEdges, usages };
}

const annotatedRanks = new Set([4, 6, 9, 14, 21, 33, 51, 74, 96, 123, 159, 181, 198]);

function shortName(name, max) {
  const chars = Array.from(name);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : name;
}

function useCanvasWidth(ref) {
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const update = () => setWidth(Math.max(240, Math.round(ref.current.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export default function StrategyNetwork({ rows, strategies, metricsByTag, onLookupPlayer, onOpenStrategies }) {
  const frame = useRef(null);
  const width = useCanvasWidth(frame);
  const graph = useMemo(() => buildNetwork(rows, metricsByTag, strategies, width), [rows, metricsByTag, strategies, width]);
  const [selected, setSelected] = useState("");
  const [focused, setFocused] = useState("");
  const chosen = graph.groups.find(group => group.name && group.name === selected);
  const matching = chosen ? graph.players.filter(player => player.uses.some(use => use.strategy === selected)) : graph.players;
  const visible = new Set(matching.map(player => player.playerTag));
  const current = graph.players.find(player => player.playerTag === focused && visible.has(player.playerTag));
  const from = player => onLookupPlayer?.(player.playerTag);
  const pick = name => { setSelected(name === selected ? "" : name); setFocused(""); };
  function playerKey(event, player) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      from(player);
      return;
    }
    const directions = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in directions)) return;
    event.preventDefault();
    const index = matching.indexOf(player);
    const next = matching[(index + directions[event.key] + matching.length) % matching.length];
    frame.current.querySelector(`[data-player="${CSS.escape(next.playerTag)}"]`)?.focus();
  }
  return <section className="overview-network" aria-label="玩家与流派关系图">
    <header className="network-heading"><h3>排名金字塔</h3>
      <div className="network-keys"><span className="key-player">玩家</span><span className="key-hub">流派</span><span className="key-line">共用流派</span></div>
    </header>
    <div ref={frame} className="network-plot">
      <svg className="strategy-network-map" viewBox={`0 0 ${width} ${graph.height}`} aria-label="全球榜玩家与近期使用的流派" role="group"
        onPointerLeave={() => setFocused("")}>
        <g aria-hidden="true" pointerEvents="none">
          <path className="network-outline" d={`M ${width/2} 17 L ${width*.91} ${graph.height-16} L ${width*.09} ${graph.height-16} Z`} />
        </g>
        <g aria-hidden="true" pointerEvents="none">{graph.sharedEdges.map(({ a, b, group }) =>
          <line key={a.playerTag+b.playerTag} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={group.color}
            className={chosen && chosen !== group ? "network-faded" : "network-shared"} />)}</g>
        <g aria-hidden="true" pointerEvents="none">{graph.usages.map(({ player, group, example }, i) => {
          const active = player.playerTag === current?.playerTag || group === chosen;
          if (!active && !example) return null;
          const faint = !active && (chosen || current);
          const secondary = group.name !== player.primary;
          return <g key={player.playerTag+group.name}><line x1={player.x} y1={player.y} x2={group.x} y2={group.y} stroke={group.color}
            className={active ? "network-highlight" : faint ? "network-faded" : secondary ? "network-cross" : "network-spoke"} />
            {!faint && (example || i % 17 === 0) && <line x1={player.x} y1={player.y} x2={group.x} y2={group.y} pathLength="100" stroke={group.color}
              className="network-signal" style={{animationDelay: `-${i % 11}s`}} />}</g>;
        })}</g>
        {graph.players.map(player => {
          const active = player === current;
          const inSelection = visible.has(player.playerTag);
          const radius = [8, 6.4, 5.1, 4.2, 3.5, 3][player.tier];
          const name = player.playerName || player.playerTag;
          return <g key={player.playerTag} data-rank={player.rank} data-player={player.playerTag} className={`network-player${inSelection ? "" : " network-muted-player"}`}
            role="button" aria-label={`第 ${player.rank} 名，${name}，${player.playerTag}，查看战报`} aria-hidden={!inSelection || undefined}
            tabIndex={inSelection && player === (current ?? matching[0]) ? 0 : -1}
            onMouseEnter={() => inSelection && setFocused(player.playerTag)} onFocus={() => setFocused(player.playerTag)}
            onBlur={() => setFocused("")} onClick={() => inSelection && from(player)} onKeyDown={event => playerKey(event, player)}>
            <circle r={Math.max(radius+2, width < 620 ? 8 : 6)} cx={player.x} cy={player.y} fill="transparent" />
            {active && <circle cx={player.x} cy={player.y} r={radius+4} className="network-point-ring" stroke={player.color} />}
            <circle r={radius} cx={player.x} cy={player.y} fill={player.color} className="network-point" />
            <title>{`第 ${player.rank} 名 · ${name} · ${player.playerTag} · ${player.primary || "尚无流派样本"}`}</title>
          </g>;
        })}
        {graph.players.filter(player => player.tier < 2 || (width >= 600 && annotatedRanks.has(player.rank))).map(player => {
          const podium = player.tier < 2;
          const y = player.y + (podium ? 19 : -7);
          const name = shortName(player.playerName || player.playerTag, podium ? width < 520 ? 7 : 13 : 7);
          const available = visible.has(player.playerTag);
          return <g key={player.playerTag} aria-hidden="true" pointerEvents={available ? "bounding-box" : "none"}
            onMouseEnter={() => available && setFocused(player.playerTag)} onClick={() => available && from(player)}
            className={`network-player-label${podium ? " podium" : ""}`} opacity={available ? 1 : .24} textAnchor="middle" transform={`translate(${player.x} ${y})`}>
            <text>{`#${player.rank} ${name}`}</text>{podium && <text className="network-tag" y="13">{player.playerTag}</text>}
          </g>;
        })}
        {graph.groups.filter(group => group.name).map(group =>
          <g key={group.name} className="network-hub" transform={`translate(${group.x} ${group.y})`} role="button"
            aria-label={`${group.name}，${group.playerCount} 人使用`} aria-pressed={chosen === group} tabIndex={0} onClick={() => pick(group.name)}
            onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); pick(group.name); } }}>
            <rect x={group.textLeft ? 8-group.labelW : -8} y="-11" width={group.labelW} height="22" rx="4" className="network-hub-bg" />
            <path d="M0 -6 6 0 0 6 -6 0Z" fill={group.color} stroke="white" strokeWidth="1.4"/>
            <text x={group.textLeft ? -8 : 8} textAnchor={group.textLeft ? "end" : "start"} dy=".35em">{group.name}</text><title>{group.name} · {group.playerCount} 名玩家 · {group.scoredCount} 场</title>
          </g>)}
      </svg>
    </div>
    <footer className="network-footer">
      <div className="network-inspect" aria-live="polite">{current ? <><b>#{current.rank} {current.playerName || current.playerTag}</b><span>{current.playerTag} · {current.primary || "尚无流派样本"}</span></>
        : chosen ? <><b>{chosen.name}</b><span>{chosen.playerCount} 人 · {chosen.scoredCount} 场</span>
          <button type="button" onClick={() => pick(chosen.name)} aria-label="显示全部玩家">×</button></>
        : <><b>{graph.players.length} 名玩家</b><span>{strategies.length} 个流派</span></>}</div>
      <div className="network-actions"><select value="" aria-label={chosen ? `查看${chosen.name}玩家战报` : "查看榜上玩家战报"}
        onChange={event => onLookupPlayer?.(event.target.value)} disabled={!onLookupPlayer || !matching.length}>
        <option value="" disabled>查看玩家</option>
        {matching.map(player => <option key={player.playerTag} value={player.playerTag}>#{player.rank} {player.playerName} · {player.playerTag}</option>)}
      </select>{chosen && <button type="button" onClick={onOpenStrategies}>流派排行 ↗</button>}</div>
    </footer>
  </section>;
}
