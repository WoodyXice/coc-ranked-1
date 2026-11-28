import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import AtlasPopulation from "./AtlasPopulation.jsx";
import AtlasEdges from "./AtlasEdges.jsx";
import PlayerUsageCard from "./PlayerUsageCard.jsx";
import { buildPopulationLayer } from "./atlas-population.mjs";
import { partitionOverlapPlayers, prepareBoard, unknownStyle } from "./strategy-map-board.mjs";
import { matchesStyleName } from "./strategy-search.mjs";
import { buildStrategyMap, regionContains } from "./strategy-map-layout.mjs";
import { placeMapLabels } from "./strategy-map-labels.mjs";
import { matchesNetworkFilters, measuredValue, netBands, playerRadius, rateBands } from "./network-metrics.mjs";

const strategyStatus = { "no-attacks": "暂无近期进攻", "no-army": "缺少配兵资料", unrecognized: "配兵待识别" };
const primaryLabel = player => player.primary || strategyStatus[player.stats?.strategyStatus] || (player.stats ? "暂无流派样本" : "暂无战报");
const modeNames = { overlap: "流派交集", style: "常用流派", rate: "三星率", net: "日均净杯" };
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const score = new Intl.NumberFormat("zh-CN", { signDisplay: "exceptZero", maximumFractionDigits: 1 });
const emptyFilters = { styles: [], rate: "", net: "", attack: 0, sample: 0, perStyle: false };
const rateOptions = [...rateBands, { id: "at75", label: "至少 75%" }, { id: "perfect", label: "100%" }];
const netOptions = [...netBands, { id: "positive", label: "正净杯（>0）" }, { id: "at40", label: "至少 +40" }];
const attackOptions = [240, 280, 300, 320].map(id => ({ id, label: `至少 +${id}` }));

function drawMap(players, groups, width, mode, sizeBy, netExtent, density) {
  const { nodes, zones, height, edges, regions, styleShapes = [] } = buildStrategyMap(players, groups, width, sizeBy, mode, density);
  const points = nodes.map(node => ({ ...node, radius: playerRadius(node, sizeBy, netExtent) * 1.36 }));
  // Reserve painted zone captions first. Player names can then use any clear side of their marker.
  const reserved = [];
  const territories = zones.map(zone => {
    const group = zone.key === null ? unknownStyle : groups.find(entry => entry.key === zone.key);
    const labelWidth = Array.from(group.name).reduce((w, c) => w + (c.charCodeAt(0) < 128 ? 7 : 12), 4);
    const x = Math.max(9 + labelWidth / 2, Math.min(width - 9 - labelWidth / 2, zone.x));
    let caption;
    for (const shift of [0, -18, 18, -33, 33]) {
      const y = zone.y + shift;
      const box = { x: x - labelWidth / 2, y: y - 12, width: labelWidth, height: 16 };
      if (box.y < 5 || y + 4 > height - 4) continue;
      if ((mode === "style" || mode === "overlap") && ![box.x, box.x + box.width].every(cx =>
        [box.y, box.y + box.height].every(cy => regionContains(zone, cx, cy)))) continue;
      if (points.some(p => Math.abs(p.x - x) < labelWidth / 2 + p.radius + 3 && Math.abs(p.y - y + 4) < p.radius + 10)) continue;
      if (reserved.some(r => Math.abs(r.x + r.width / 2 - x) < (r.width + labelWidth) / 2 + 4 && Math.abs(r.y - box.y) < 19)) continue;
      caption = { x, y };
      reserved.push(box);
      break;
    }
    return { ...zone, group, caption };
  });
  const labels = placeMapLabels(points, width, height, { reserved });
  const excludedBoxes = [...reserved, ...Array.from(labels.values(), label => label.bounds)];
  const population = density === "all" ? buildPopulationLayer(players, points, width, height, regions, excludedBoxes) : null;
  if (population && points.length + population.points.length < players.length) {
    // Give players priority when captions consume a very small region.
    return { height, edges, points, styleShapes, territories: territories.map(zone => ({ ...zone, caption: null })),
      labels: new Map(), population: buildPopulationLayer(players, points, width, height, regions) };
  }
  return { height, edges, points, territories, population, labels, styleShapes };
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

function StylePicker({ styles, selected, onToggle }) {
  const menu = useRef(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const dismiss = event => {
      if (menu.current?.open && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const names = [...new Set([...styles, ...selected])].filter(name => matchesStyleName(name, query));
  return <details ref={menu} className="network-style-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key === "Escape") { menu.current.open = false; menu.current.querySelector("summary").focus(); }
  }}>
    <summary aria-label="筛选流派，可多选">流派 <b>{selected.length ? selected.join(" ∩ ") : "全部"}</b></summary>
    <div className="network-style-options" role="group" aria-label="同时用过的流派">
      <input type="search" aria-label="搜索流派" placeholder="搜流派，如龙、蓝胖" value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && names.length) {
            event.preventDefault(); onToggle(names[0]);
          }
        }} />
      <strong>同时用过</strong>
      {names.map(name => <label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={() => onToggle(name)} />{name}</label>)}
      {!names.length && <span>{query ? "没有匹配的流派" : "暂无已识别流派"}</span>}
    </div>
  </details>;
}

function MetricFilter({ label, value, options, onChange, title }) {
  return <label className="network-filter" title={title}>{label}
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">不限</option>{options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  </label>;
}

const samples = [{ id: 4, label: "至少 4 场" }, { id: 8, label: "至少 8 场" }, { id: 16, label: "满 16 场" }];

function PlayerRoster({ players, onLookup, details = false }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return players;
    const rank = Number(term.replace(/^#/, ""));
    return players.filter(player => player.rank === rank || player.playerTag.toLowerCase().includes(term)
      || player.playerName?.toLowerCase().includes(term));
  }, [players, query]);
  const pageCount = Math.max(1, Math.ceil(matches.length / 30));
  const current = Math.min(page, pageCount - 1);
  return <>
    <input type="search" aria-label="搜索榜上玩家" placeholder="名次、玩家名或标签" autoFocus value={query}
      onChange={event => { setQuery(event.target.value); setPage(0); }} />
    <div className="atlas-player-list">
      {matches.slice(current * 30, (current + 1) * 30).map(player => <button type="button" key={player.playerTag}
        onClick={() => onLookup(player.playerTag)}>
        <span>#{player.rank} {player.playerName} <small>{player.playerTag}</small></span>
        {details && player.stats && <small>{primaryLabel(player)}</small>}
      </button>)}
      {!matches.length && <p>没有匹配的玩家</p>}
    </div>
    {matches.length > 30 && <div className="legend-pages">
      <button type="button" disabled={!current} onClick={() => setPage(current - 1)}>上一页</button>
      <span>{current + 1} / {pageCount}</span>
      <button type="button" disabled={current + 1 === pageCount} onClick={() => setPage(current + 1)}>下一页</button>
    </div>}
  </>;
}

const outsideGroups = ["其他流派", "暂无近期进攻", "流派未识别", "待取战报", "战报暂缺"];
function OutsideRoster({ outside, onLookup }) {
  const [active, setActive] = useState(null);
  const panelId = useId();
  const container = useRef(null);
  if (!outside.size && !active) return null;
  return <section className="atlas-outside" aria-label="图外玩家" ref={container} onKeyDown={event => {
    if (event.key === "Escape" && active) {
      event.stopPropagation();
      container.current.querySelector('[aria-expanded="true"]')?.focus();
      setActive(null);
    }
  }}>
    <div className="atlas-outside-groups"><strong>图外名单</strong>
      {outsideGroups.filter(group => outside.has(group) || active === group).map(group =>
        <button key={group} type="button" aria-expanded={active === group} aria-controls={panelId}
          onClick={() => setActive(active === group ? null : group)}>
          {group} <b>{outside.get(group)?.length ?? 0}</b><span aria-hidden="true">⌄</span>
        </button>)}
    </div>
    <div id={panelId} hidden={!active} className="atlas-outside-panel">
      {active && <PlayerRoster key={active} players={outside.get(active) ?? []} details onLookup={onLookup} />}
    </div>
  </section>;
}

const PlayerPicker = memo(function PlayerPicker({ players, onLookup }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = event => {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  if (players.length <= 200 && !open) return <select value="" aria-label="查看榜上玩家战报"
    onChange={event => onLookup?.(event.target.value)} disabled={!onLookup || !players.length}>
    <option value="" disabled>查看玩家</option>
    {players.map(player => <option key={player.playerTag} value={player.playerTag}>#{player.rank} {player.playerName} · {player.playerTag}</option>)}
  </select>;
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  return <div className="atlas-player-picker" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); close(true); }
  }}>
    <button type="button" ref={trigger} aria-expanded={open} disabled={!onLookup} onClick={() => setOpen(value => !value)}>查看玩家</button>
    {open && <div className="atlas-player-panel" ref={panel}>
      <PlayerRoster players={players} onLookup={tag => { close(true); onLookup(tag); }} />
    </div>}
  </div>;
});

export default function StrategyNetwork({ rows, strategies, metricsByTag, metricStatuses, pairMemory, onLookupPlayer, onOpenStrategies }) {
  const frame = useRef(null);
  const hoverPoint = useRef(null);
  const width = useCanvasWidth(frame);
  const [mode, setMode] = useState("overlap");
  const [requestedPair, setRequestedPair] = useState(() => pairMemory?.current ?? []);
  const [usageTag, setUsageTag] = useState(null);
  const [sizeBy, setSizeBy] = useState("rank");
  const [density, setDensity] = useState("all");
  const [regionFilter, setRegionFilter] = useState(undefined);
  const [filters, setFilters] = useState(emptyFilters);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [focused, setFocused] = useState("");
  const board = useMemo(() => prepareBoard(rows, metricsByTag, strategies, mode, requestedPair),
    [rows, metricsByTag, strategies, mode, requestedPair]);
  useLayoutEffect(() => {
    if (requestedPair.length < 2 && board.pair.length === 2) {
      if (pairMemory) pairMemory.current = board.pair;
      setRequestedPair(board.pair);
    }
  }, [board.pair, requestedPair, pairMemory]);
  const overlap = mode === "overlap";
  const byStyle = overlap || mode === "style";
  const searchFilterCount = filters.styles.length + [filters.rate, filters.net, filters.attack, filters.sample].filter(Boolean).length;
  const filterCount = searchFilterCount + Number(regionFilter !== undefined);
  const candidates = useMemo(() => searchFilterCount ? board.players.filter(player => matchesNetworkFilters(player, filters)) : board.players,
    [board, filters, searchFilterCount]);
  const matching = useMemo(() => regionFilter === undefined ? candidates : candidates.filter(player => player.cluster === regionFilter),
    [candidates, regionFilter]);
  const counts = useMemo(() => {
    const groups = new Map();
    for (const player of candidates) groups.set(player.cluster, (groups.get(player.cluster) ?? 0) + 1);
    return groups;
  }, [candidates]);
  const legendGroups = byStyle ? (overlap ? board.groups : [...board.groups, unknownStyle])
    .filter(group => counts.has(group.key) || group.key === regionFilter) : board.groups;
  const roster = useMemo(() => overlap ? partitionOverlapPlayers(matching, metricStatuses) : null, [matching, metricStatuses, overlap]);
  const plotted = overlap ? roster.compared : matching;
  const graph = useMemo(() => drawMap(plotted, board.groups, width, mode, sizeBy, board.netExtent, density),
    [plotted, board, width, mode, sizeBy, density]);
  const canUseStyleRates = filters.styles.length > 0 && Boolean(filters.rate);
  const useStyleRates = canUseStyleRates && filters.perStyle;
  const matchingByTag = useMemo(() => new Map(matching.map(player => [player.playerTag, player])), [matching]);
  const current = matchingByTag.get(focused);
  const usagePlayer = usageTag && board.players.find(p => p.playerTag === usageTag);
  const inspectionLabel = player => overlap && player.cluster === "both" ? board.pair.join(" ∩ ") : primaryLabel(player);
  const foreground = graph.points.find(player => player.playerTag === focused);
  const visibleCount = graph.points.length + (graph.population?.points.length ?? 0);
  let emptyMessage = "暂无符合条件的玩家";
  if (overlap && matching.length && !plotted.length) {
    if (roster.outside.has("待取战报")) emptyMessage = "正在读取玩家流派…";
    else if (!metricsByTag.size) emptyMessage = "近期战报暂缺";
    else emptyMessage = board.pair.length ? "暂无所选流派的进攻记录" : "近期战报暂无可识别的流派";
  }
  function backgroundPlayer(event) {
    if (density !== "all" || event.target.closest(".network-player, .network-zone text")) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    hoverPoint.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    return graph.population?.hitTest((event.clientX - bounds.left) * width / bounds.width,
      (event.clientY - bounds.top) * graph.height / bounds.height);
  }
  function openPlayer(tag) {
    if (overlap) setUsageTag(tag);
    else onLookupPlayer?.(tag);
  }
  function setPairSide(index, name) {
    const next = [...board.pair];
    if (next[1 - index] === name) next[1 - index] = next[index];
    next[index] = name;
    if (pairMemory) pairMemory.current = next;
    setRequestedPair(next);
    setRegionFilter(undefined);
    setFocused("");
  }
  const setFilter = (key, value) => { setFilters(previous => ({ ...previous, [key]: value })); setFocused(""); };
  function toggleStyle(name) {
    setFilters(previous => ({ ...previous, styles: previous.styles.includes(name)
      ? previous.styles.filter(style => style !== name) : [...previous.styles, name] }));
    setFocused("");
  }
  const selectedGroup = group => byStyle ? regionFilter === group.key : filters[mode] === group.key;
  function pick(group) {
    if (byStyle) {
      setRegionFilter(selectedGroup(group) ? undefined : group.key);
      setFocused("");
    }
    else setFilter(mode, selectedGroup(group) ? "" : group.key);
  }
  const rate = measuredValue(current?.stats, "rate");
  const attack = measuredValue(current?.stats, "attack");
  const net = measuredValue(current?.stats, "net");
  function playerKey(event, player) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPlayer(player.playerTag);
      return;
    }
    const directions = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in directions)) return;
    event.preventDefault();
    const index = graph.points.indexOf(player);
    const next = graph.points[(index + directions[event.key] + graph.points.length) % graph.points.length];
    frame.current.querySelector(`[data-player="${CSS.escape(next.playerTag)}"]`)?.focus();
  }
  return <section className="overview-network" aria-label="玩家与流派关系图">
    <header className="network-heading"><h3>玩家关系图</h3>
      <div className="network-controls">
        <label className="atlas-density">图上密度 <select aria-label="图上密度" value={density} onChange={event => {
          setDensity(event.target.value); setFocused("");
        }}><option value="all">{overlap ? "流派内全员" : "全员"}</option><optgroup label="代表玩家"><option value="sparse">疏朗</option><option value="standard">标准</option><option value="dense">密集</option></optgroup></select></label>
        <div className="network-modes" role="group" aria-label="色块分区">
          {Object.entries(modeNames).map(([key, name]) => <button key={key} type="button" aria-pressed={mode === key}
            onClick={() => { if (key !== mode) setRegionFilter(undefined); setMode(key); setFocused(""); }}>{name}</button>)}
        </div>
        <button type="button" className="network-filter-toggle" aria-expanded={controlsOpen} onClick={() => setControlsOpen(open => !open)}>
          筛选{filterCount > 0 && ` · ${filterCount}`} <span aria-hidden="true">{controlsOpen ? "▴" : "▾"}</span>
        </button>
      </div>
    </header>
    {overlap && board.pair?.length > 0 && <div className="atlas-pair" role="group" aria-label="对比流派">
      {board.pair.map((name, index) => <label key={index}><i aria-hidden="true"
        style={{ backgroundColor: board.groups.find(group => group.key === (index ? "right" : "left"))?.pointColor }} />
        <select aria-label={index ? "第二种流派" : "第一种流派"} value={name} onChange={event => setPairSide(index, event.target.value)}>
          {board.styles.map(style => <option key={style}>{style}</option>)}
        </select></label>)}
      {board.pair.length === 2 && <span>共同使用 <b>{counts.get("both") ?? 0}</b> 人</span>}
    </div>}
    {controlsOpen && <div className="network-filters" role="group" aria-label="玩家交集筛选">
      <StylePicker styles={board.styles} selected={filters.styles} onToggle={toggleStyle} />
      <MetricFilter label="三星率" title="近两个联赛日，三星进攻占有星数记录的进攻比例" value={filters.rate} options={rateOptions}
        onChange={value => setFilter("rate", value)} />
      <MetricFilter label="日均净杯" title="仅计进攻和防守均有完整 8 场杯数的联赛日" value={filters.net} options={netOptions}
        onChange={value => setFilter("net", value)} />
      <MetricFilter label="日均进攻杯" title="仅计有完整 8 场进攻杯数的联赛日" value={filters.attack || ""} options={attackOptions}
        onChange={value => setFilter("attack", Number(value))} />
      <MetricFilter label={useStyleRates ? "每流派有效进攻" : "有效进攻"} title="近两个联赛日有星数记录的进攻场次" value={filters.sample || ""} options={samples}
        onChange={value => setFilter("sample", Number(value))} />
      {canUseStyleRates && <label className="network-rate-scope" title="每个所选流派的三星率和有效进攻场数均须达标">
        <input type="checkbox" checked={filters.perStyle} onChange={event => setFilter("perStyle", event.target.checked)} />按各流派计算
      </label>}
      {filterCount > 0 && <button className="network-reset" type="button" onClick={() => { setRegionFilter(undefined); setFilters(emptyFilters); setFocused(""); }}>清除筛选</button>}
    </div>}
    <div ref={frame} className="network-plot">
      {plotted.length === 0 ? <p className="network-empty">{emptyMessage}</p> :
        <svg className="strategy-network-map" viewBox={`0 0 ${width} ${graph.height}`} aria-label={`全球榜玩家，按${modeNames[mode]}分区`} role="group"
          onPointerMove={event => {
            if (event.pointerType !== "touch" && !event.target.closest(".network-player")) setFocused(backgroundPlayer(event) || "");
          }} onPointerLeave={() => setFocused("")} onClickCapture={event => {
            if (!event.detail) return;
            const tag = backgroundPlayer(event);
            if (tag) { event.stopPropagation(); openPlayer(tag); }
          }}>
          {graph.styleShapes.map(shape => <path key={shape.key} d={shape.d} data-overlap-set={shape.key}
            fill={board.groups.find(group => group.key === shape.key)?.color} className="atlas-set-shape" aria-hidden="true" pointerEvents="none" />)}
          {graph.territories.map(({ key, d, group, caption }) =>
            <g key={key ?? "unknown"} className={`network-zone${overlap ? " atlas-set-zone" : ""}`}
              role="button" tabIndex={0} aria-label={`筛选${group.name}`}
              aria-pressed={selectedGroup(group)} onClick={() => pick(group)}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(group); } }}>
              <path d={d} fill={group.color} data-region={key ?? "unknown"} />
              {caption && <text x={caption.x} y={caption.y} textAnchor="middle">{group.name}</text>}
            </g>)}
          {graph.population && <AtlasPopulation layer={graph.population} width={width} height={graph.height} />}
          <AtlasEdges edges={graph.edges} current={current} />
          {graph.points.map(player => {
            const active = player === foreground;
            const { radius, x, y } = player;
            const label = graph.labels.get(player.playerTag);
            const name = player.playerName || player.playerTag;
            return <g key={player.playerTag} className="network-player" data-rank={player.rank} data-player={player.playerTag}
              role="button" aria-label={`第 ${player.rank} 名，${name}，${player.playerTag}，${inspectionLabel(player)}，${overlap ? "查看流派战绩" : "查看战报"}`}
              tabIndex={player === (foreground ?? graph.points[0]) ? 0 : -1}
              onMouseEnter={() => setFocused(player.playerTag)} onMouseLeave={() => setFocused("")} onFocus={() => setFocused(player.playerTag)}
              onBlur={() => setFocused("")} onClick={() => openPlayer(player.playerTag)} onKeyDown={event => playerKey(event, player)}>
              <circle r={Math.max(radius + 4, 12)} cx={x} cy={y} fill="transparent" />
              {active && <circle r={radius + 3.5} cx={x} cy={y} className="network-point-ring" />}
              <circle r={radius} cx={x} cy={y} className="network-point" style={{ fill: player.pointColor }} />
              {label && <g className="network-player-label" textAnchor={label.anchor}>
                <text x={label.x} y={label.y}>{label.text}</text>
                {label.tag && <text className="network-tag" x={label.x} y={label.y + 13}>{label.tag}</text>}
              </g>}
              <title>{`第 ${player.rank} 名 · ${name} · ${player.playerTag} · ${inspectionLabel(player)}`}</title>
            </g>;
          })}
        </svg>}
      {current && (foreground || hoverPoint.current) && <span aria-hidden="true" className="atlas-hover-card" style={{
        left: Math.max(4, Math.min(width - Math.min(width - 8, 195), (foreground?.x ?? hoverPoint.current.x) + 12)),
        top: Math.max(3, Math.min(graph.height - 48, (foreground?.y ?? hoverPoint.current.y) + 11)),
      }}><b>#{current.rank} {current.playerName || current.playerTag}</b><span>{overlap && current.cluster === "both" ? "共同使用" : "常用流派"} · {inspectionLabel(current)}</span></span>}
    </div>
    {legendGroups.length > 0 && <div className="network-legend" role="group" aria-label={`${modeNames[mode]}图例`}>
      {byStyle && <strong>{overlap ? "用过的流派" : "常用流派"}</strong>}
      {legendGroups.map(group => <button type="button" key={group.key ?? "unknown"} aria-pressed={selectedGroup(group)}
        onClick={() => pick(group)}><i style={{ backgroundColor: group.pointColor }} />{overlap && ["left", "right"].includes(group.key) ? `${group.name}侧` : group.name}
        {byStyle && <small>{counts.get(group.key) ?? 0} 人</small>}</button>)}
      {!byStyle && counts.has(null) && <span><i style={{ backgroundColor: unknownStyle.pointColor }} />指标暂缺</span>}
    </div>}
    {overlap && <OutsideRoster outside={roster.outside} onLookup={openPlayer} />}
    <footer className="network-footer">
      <div className="network-inspect" aria-live="polite">
        <b className="network-count">{density === "all" ? "图中" : "代表玩家"} {visibleCount} 人</b>
        {filterCount > 0 && <span>符合筛选 {matching.length} 人</span>}
        <span>榜单 {board.players.length} 人</span>
        {current ? <><b>#{current.rank} {current.playerName || current.playerTag}</b><span>{current.playerTag}</span>
          <span>{primaryLabel(current)} · 总体三星率 {rate === null ? "—" : percent.format(rate)}
          {rate !== null && `（${current.stats.attackCount} 场）`} · 日均进攻杯 {attack === null ? "—" : score.format(attack)} · 日均净杯 {net === null ? "—" : score.format(net)}
          {net !== null && `（${current.stats.completedDays} 日）`}</span>
          {useStyleRates && current.uses.filter(use => filters.styles.includes(use.strategy)).map(use =>
            <span key={use.strategy}>{use.strategy} {percent.format(use.threeStarCount / use.scoredCount)}（{use.threeStarCount}/{use.scoredCount}）</span>)}</>
        : graph.edges.length > 0 && <span className="network-edge-key"
          title={byStyle ? "连线表示用过同一流派" : undefined}>
          {byStyle ? "共用流派" : mode === "rate" ? "同档三星率" : "同档净杯"}</span>}</div>
      <div className="network-actions"><label>节点大小 <select aria-label="节点大小" value={sizeBy} onChange={event => setSizeBy(event.target.value)}>
        <option value="rank">官方名次</option><option value="rate">三星率</option><option value="net">日均净杯</option><option value="sample">有效进攻</option>
      </select></label>
      <PlayerPicker players={matching} onLookup={overlap ? openPlayer : onLookupPlayer} />
      {!!filters.styles.length && <button type="button" onClick={onOpenStrategies}>流派排行 ↗</button>}</div>
    </footer>
    {overlap && usagePlayer && <PlayerUsageCard player={usagePlayer} pair={board.pair}
      emptyReason={usagePlayer.stats ? primaryLabel(usagePlayer) : metricStatuses?.has(usageTag) ? "战报暂缺" : "待取战报"}
      onDismiss={() => setUsageTag(null)} onReport={onLookupPlayer} />}
  </section>;
}
