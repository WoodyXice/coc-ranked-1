import { useEffect, useMemo, useRef, useState } from "react";
import { buildStrategyMap } from "./strategy-map-layout.mjs";
import { placeMapLabels } from "./strategy-map-labels.mjs";
import { matchesNetworkFilters, measuredValue, netBands, playerRadius, rateBands, valueBand } from "./network-metrics.mjs";

const tones = ["#7cb8d9", "#ae9ac9", "#e2ad65", "#e69c96", "#8ebdae", "#a1accc"];
const modeNames = { style: "流派", rate: "三星率", net: "日均净杯" };
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const score = new Intl.NumberFormat("zh-CN", { signDisplay: "exceptZero", maximumFractionDigits: 1 });
const emptyFilters = { styles: [], rate: "", net: "", attack: 0, sample: 0, perStyle: false };
const rateOptions = [...rateBands, { id: "at75", label: "至少 75%" }, { id: "perfect", label: "100%" }];
const netOptions = [...netBands, { id: "positive", label: "正净杯（>0）" }, { id: "at40", label: "至少 +40" }];
const attackOptions = [240, 280, 300, 320].map(id => ({ id, label: `至少 +${id}` }));

function prepareBoard(rows, metrics, strategies, mode) {
  const bands = mode === "rate" ? rateBands : netBands;
  const groups = mode === "style"
    ? strategies.map(({ strategy }, i) => ({ key: strategy, name: strategy, color: tones[i % tones.length] }))
    : bands.map(band => ({ key: band.id, name: band.label, color: band.color }));
  const players = rows.filter(row => Number.isInteger(row.rank) && row.rank >= 1 && row.rank <= 200)
    .map(row => {
      const stats = metrics.get(row.playerTag);
      const uses = (stats?.strategies ?? []).filter(entry => entry.scoredCount > 0);
      const primary = (uses.find(entry => entry.strategy === stats?.strategy) ?? uses[0])?.strategy;
      const cluster = mode === "style" ? primary : valueBand(measuredValue(stats, mode), bands)?.id;
      const tier = [1, 3, 10, 30, 80, 200].findIndex(last => row.rank <= last);
      return { ...row, stats, uses, primary, cluster, tier };
    }).sort((a, b) => a.rank - b.rank);
  const nets = players.map(player => measuredValue(player.stats, "net")).filter(value => value !== null);
  return { players, groups, netExtent: nets.length ? [Math.min(...nets), Math.max(...nets)] : [0, 0] };
}

function drawMap(players, groups, width, mode, sizeBy, netExtent) {
  const { nodes, zones, height, edges } = buildStrategyMap(players, groups, width, sizeBy, mode);
  const points = nodes.map(node => ({ ...node, radius: playerRadius(node, sizeBy, netExtent) * 1.36 }));
  // Reserve painted zone captions first. Player names can then use any clear side of their marker.
  const reserved = [];
  const territories = zones.map(zone => {
    const group = groups.find(entry => entry.key === zone.key);
    const labelWidth = Array.from(group.name).reduce((w, c) => w + (c.charCodeAt(0) < 128 ? 7 : 12), 4);
    const x = Math.max(9 + labelWidth / 2, Math.min(width - 9 - labelWidth / 2, zone.x));
    let caption;
    for (const shift of [0, -18, 18, -33, 33]) {
      const y = zone.y + shift;
      const box = { x: x - labelWidth / 2, y: y - 12, width: labelWidth, height: 16 };
      if (box.y < 5 || y + 4 > height - 4) continue;
      if (points.some(p => Math.abs(p.x - x) < labelWidth / 2 + p.radius + 3 && Math.abs(p.y - y + 4) < p.radius + 10)) continue;
      if (reserved.some(r => Math.abs(r.x + r.width / 2 - x) < (r.width + labelWidth) / 2 + 4 && Math.abs(r.y - box.y) < 19)) continue;
      caption = { x, y };
      reserved.push(box);
      break;
    }
    return { ...zone, group, caption };
  });
  return { height, edges, points, territories, labels: placeMapLabels(points, width, height, { reserved }) };
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

function StylePicker({ strategies, selected, onToggle }) {
  const menu = useRef(null);
  useEffect(() => {
    const dismiss = event => {
      if (menu.current?.open && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const names = [...new Set([...strategies.map(entry => entry.strategy), ...selected])];
  return <details ref={menu} className="network-style-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key === "Escape") { menu.current.open = false; menu.current.querySelector("summary").focus(); }
  }}>
    <summary aria-label="筛选流派，可多选">流派 <b>{selected.length ? selected.join(" ∩ ") : "全部"}</b></summary>
    <div className="network-style-options" role="group" aria-label="同时用过的流派">
      <strong>同时用过</strong>
      {names.map(name => <label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={() => onToggle(name)} />{name}</label>)}
      {!names.length && <span>暂无已识别流派</span>}
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

export default function StrategyNetwork({ rows, strategies, metricsByTag, onLookupPlayer, onOpenStrategies }) {
  const frame = useRef(null);
  const width = useCanvasWidth(frame);
  const [mode, setMode] = useState("style");
  const [sizeBy, setSizeBy] = useState("rank");
  const [filters, setFilters] = useState(emptyFilters);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [focused, setFocused] = useState("");
  const board = useMemo(() => prepareBoard(rows, metricsByTag, strategies, mode), [rows, metricsByTag, strategies, mode]);
  const filterCount = filters.styles.length + [filters.rate, filters.net, filters.attack, filters.sample].filter(Boolean).length;
  const matching = useMemo(() => filterCount ? board.players.filter(player => matchesNetworkFilters(player, filters)) : board.players,
    [board, filters, filterCount]);
  const graph = useMemo(() => drawMap(matching, board.groups, width, mode, sizeBy, board.netExtent),
    [matching, board, width, mode, sizeBy]);
  const canUseStyleRates = filters.styles.length > 0 && Boolean(filters.rate);
  const useStyleRates = canUseStyleRates && filters.perStyle;
  const current = graph.points.find(player => player.playerTag === focused);
  const from = player => onLookupPlayer?.(player.playerTag);
  const setFilter = (key, value) => { setFilters(previous => ({ ...previous, [key]: value })); setFocused(""); };
  function toggleStyle(name) {
    setFilters(previous => ({ ...previous, styles: previous.styles.includes(name)
      ? previous.styles.filter(style => style !== name) : [...previous.styles, name] }));
    setFocused("");
  }
  const selectedGroup = group => mode === "style" ? filters.styles.includes(group.key) : filters[mode] === group.key;
  function pick(group) {
    if (mode === "style") toggleStyle(group.key);
    else setFilter(mode, selectedGroup(group) ? "" : group.key);
  }
  const rate = measuredValue(current?.stats, "rate");
  const attack = measuredValue(current?.stats, "attack");
  const net = measuredValue(current?.stats, "net");
  function playerKey(event, player) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      from(player);
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
        <div className="network-modes" role="group" aria-label="色块分区">
          {Object.entries(modeNames).map(([key, name]) => <button key={key} type="button" aria-pressed={mode === key}
            onClick={() => { setMode(key); setFocused(""); }}>{name}</button>)}
        </div>
        <button type="button" className="network-filter-toggle" aria-expanded={controlsOpen} onClick={() => setControlsOpen(open => !open)}>
          筛选{filterCount > 0 && ` · ${filterCount}`} <span aria-hidden="true">{controlsOpen ? "▴" : "▾"}</span>
        </button>
      </div>
    </header>
    {controlsOpen && <div className="network-filters" role="group" aria-label="玩家交集筛选">
      <StylePicker strategies={strategies} selected={filters.styles} onToggle={toggleStyle} />
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
      {filterCount > 0 && <button className="network-reset" type="button" onClick={() => { setFilters(emptyFilters); setFocused(""); }}>清除筛选</button>}
    </div>}
    <div ref={frame} className="network-plot">
      {matching.length === 0 ? <p className="network-empty">暂无符合条件的玩家</p> :
        <svg className="strategy-network-map" viewBox={`0 0 ${width} ${graph.height}`} aria-label={`全球榜玩家，按${modeNames[mode]}分区`} role="group"
          onPointerLeave={() => setFocused("")}>
          {graph.territories.map(({ key, d, group, caption }) =>
            <g key={key} className="network-zone" role="button" tabIndex={0} aria-label={`筛选${group.name}`}
              aria-pressed={selectedGroup(group)} onClick={() => pick(group)}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(group); } }}>
              <path d={d} fill={group.color} data-region={key} />
              {caption && <text x={caption.x} y={caption.y} textAnchor="middle">{group.name}</text>}
            </g>)}
          <g aria-hidden="true" pointerEvents="none">{graph.edges.map(({ a, b }, i) => {
            const active = current && (a.playerTag === current.playerTag || b.playerTag === current.playerTag);
            const commonPrimary = mode === "style" && a.primary && a.primary === b.primary;
            return <g key={a.playerTag + ":" + b.playerTag}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`network-edge${commonPrimary ? " same-primary" : ""}${active ? " active" : ""}`} />
              {i % 13 === 0 && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} pathLength="100" className="network-signal"
                style={{ animationDelay: `-${i % 7}s` }} />}
            </g>;
          })}</g>
          {graph.points.map(player => {
            const active = player === current;
            const { radius, x, y } = player;
            const label = graph.labels.get(player.playerTag);
            const name = player.playerName || player.playerTag;
            return <g key={player.playerTag} className="network-player" data-rank={player.rank} data-player={player.playerTag}
              role="button" aria-label={`第 ${player.rank} 名，${name}，${player.playerTag}，查看战报`}
              tabIndex={player === (current ?? graph.points[0]) ? 0 : -1}
              onMouseEnter={() => setFocused(player.playerTag)} onMouseLeave={() => setFocused("")} onFocus={() => setFocused(player.playerTag)}
              onBlur={() => setFocused("")} onClick={() => from(player)} onKeyDown={event => playerKey(event, player)}>
              <circle r={Math.max(radius + 4, 12)} cx={x} cy={y} fill="transparent" />
              {active && <circle r={radius + 3.5} cx={x} cy={y} className="network-point-ring" />}
              <circle r={radius} cx={x} cy={y} className={player.cluster ? "network-point" : "network-point unknown"} data-tier={player.tier} />
              {label && <g className="network-player-label" textAnchor={label.anchor}>
                <text x={label.x} y={label.y}>{label.text}</text>
                {label.tag && <text className="network-tag" x={label.x} y={label.y + 13}>{label.tag}</text>}
              </g>}
              <title>{`第 ${player.rank} 名 · ${name} · ${player.playerTag} · ${player.primary || "暂无流派样本"}`}</title>
            </g>;
          })}
        </svg>}
    </div>
    <footer className="network-footer">
      <div className="network-inspect" aria-live="polite">
        <b className="network-count">{filterCount ? `交集 ${matching.length} / ${board.players.length} 人` : `榜单 ${board.players.length} 人`}</b>
        {current ? <><b>#{current.rank} {current.playerName || current.playerTag}</b><span>{current.playerTag}</span>
          <span>{current.primary || "暂无流派样本"} · 总体三星率 {rate === null ? "—" : percent.format(rate)}
          {rate !== null && `（${current.stats.attackCount} 场）`} · 日均进攻杯 {attack === null ? "—" : score.format(attack)} · 日均净杯 {net === null ? "—" : score.format(net)}
          {net !== null && `（${current.stats.completedDays} 日）`}</span>
          {useStyleRates && current.uses.filter(use => filters.styles.includes(use.strategy)).map(use =>
            <span key={use.strategy}>{use.strategy} {percent.format(use.threeStarCount / use.scoredCount)}（{use.threeStarCount}/{use.scoredCount}）</span>)}</>
        : matching.length > 0 && <><span>图中 {graph.points.length} 人</span><span className="network-edge-key"
          title={mode === "style" ? "连线表示用过同一流派，加粗表示常用流派相同" : undefined}>
          {mode === "style" ? "共用流派" : mode === "rate" ? "同档三星率" : "同档净杯"}</span></>}</div>
      <div className="network-actions"><label>节点大小 <select aria-label="节点大小" value={sizeBy} onChange={event => setSizeBy(event.target.value)}>
        <option value="rank">官方名次</option><option value="rate">三星率</option><option value="net">日均净杯</option><option value="sample">有效进攻</option>
      </select></label>
      <select value="" aria-label="查看榜上玩家战报"
        onChange={event => onLookupPlayer?.(event.target.value)} disabled={!onLookupPlayer || !matching.length}>
        <option value="" disabled>查看玩家</option>
        {matching.map(player => <option key={player.playerTag} value={player.playerTag}>#{player.rank} {player.playerName} · {player.playerTag}</option>)}
      </select>{!!filters.styles.length && <button type="button" onClick={onOpenStrategies}>流派排行 ↗</button>}</div>
    </footer>
  </section>;
}
