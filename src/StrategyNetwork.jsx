import { useEffect, useMemo, useRef, useState } from "react";
import { buildRankPyramid } from "./rank-pyramid-layout.mjs";
import { buildNetworkRegion } from "./network-regions.mjs";
import { matchesNetworkFilters, measuredValue, netBands, playerRadius, rateBands, valueBand } from "./network-metrics.mjs";

const tones = ["#227f9f", "#80709e", "#338b79", "#b08239", "#b05f6d", "#4b73af", "#58767b"];
const gray = "#7b8995";
const modeNames = { style: "流派", rate: "三星率", net: "日均净杯" };
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const score = new Intl.NumberFormat("zh-CN", { signDisplay: "exceptZero", maximumFractionDigits: 1 });
const emptyFilters = { styles: [], rate: "", net: "", attack: 0, sample: 0, perStyle: false };
const rateOptions = [...rateBands, { id: "at75", label: "至少 75%" }, { id: "perfect", label: "100%" }];
const netOptions = [...netBands, { id: "positive", label: "正净杯（>0）" }, { id: "at40", label: "至少 +40" }];
const attackOptions = [240, 280, 300, 320].map(id => ({ id, label: `至少 +${id}` }));

function buildNetwork(rows, metrics, strategies, width, mode) {
  const bands = mode === "rate" ? rateBands : netBands;
  const categories = mode === "style"
    ? strategies.map(({ strategy, scoredCount }, i) => ({ key: strategy, name: strategy, scoredCount, color: tones[i % tones.length] }))
    : bands.map(band => ({ key: band.id, name: band.label, color: band.color }));
  const source = rows.map(row => {
    const stats = metrics.get(row.playerTag);
    const uses = (stats?.strategies ?? []).filter(entry => entry.scoredCount > 0);
    const primary = uses.find(entry => entry.strategy === stats?.strategy) ?? uses[0];
    const cluster = mode === "style" ? primary?.strategy : valueBand(measuredValue(stats, mode), bands)?.id;
    const index = categories.findIndex(entry => entry.key === cluster);
    const affinity = index < 0 ? null : (index + .5) / categories.length;
    return { ...row, uses, primary: primary?.strategy, stats, cluster, affinity };
  });
  const { players, height: pyramidHeight } = buildRankPyramid(source, width);
  const height = Math.max(258, pyramidHeight, 80 + Math.ceil(categories.length / 2) * 49);
  const groups = categories.map((category, i) => {
    const right = i % 2 === 1;
    const sideCount = Math.ceil((categories.length - (right ? 1 : 0)) / 2);
    const lane = Math.floor(i / 2);
    const t = (lane + .5) / sideCount;
    // Leave the two podium name/tag rows clear, even for long names on a small screen.
    const compactY = lane < 2 ? 14 + lane * 57 : 146 + (lane - 2) * 38;
    const y = width < 520 ? compactY : 26 + t * (height * .76 - 26);
    const inset = width < 620 ? 8 : 16;
    const labelW = 19 + Array.from(category.name).reduce((span, char) => span + (char.charCodeAt(0) < 128 ? 7.5 : 12), 0);
    const sideX = width < 520 ? inset : Math.max(inset + labelW - 7, width * (.34 - .27 * t));
    return { ...category, x: right ? width - sideX : sideX, y, textLeft: width < 520 ? right : !right, labelW,
      members: [], primaryMembers: [] };
  });
  const groupByKey = new Map(groups.map(group => [group.key, group]));
  const sharedEdges = [];
  const usages = [];
  const nets = [];
  for (const player of players) {
    const primary = groupByKey.get(player.cluster);
    primary?.primaryMembers.push(player);
    player.color = primary?.color ?? gray;
    const net = measuredValue(player.stats, "net");
    if (net !== null) nets.push(net);
    const keys = mode === "style" ? player.uses.map(use => use.strategy) : [player.cluster];
    for (const key of keys) {
      const group = groupByKey.get(key);
      if (!group) continue;
      group.members.push(player);
      const samples = mode === "style" ? player.uses.find(use => use.strategy === key).scoredCount : player.stats.attackCount;
      usages.push({ player, group, samples, distance: Math.hypot(group.x - player.x, group.y - player.y) });
    }
  }
  groups.forEach(group => {
    group.region = buildNetworkRegion(group.members, width, height);
    const others = [];
    for (const player of group.primaryMembers) {
      if (others.length) {
        const near = others.map(other => ({ other, distance: (player.x - other.x) ** 2 + (player.y - other.y) ** 2 }))
          .sort((a, b) => a.distance - b.distance).slice(0, 2);
        for (const { other } of near) sharedEdges.push({ a: player, b: other, group });
      }
      others.push(player);
    }
  });
  // A handful of real examples keeps the base map legible. Selecting either end reveals every match.
  for (const group of groups) {
    const examples = usages.filter(link => link.group === group).sort((a, b) => b.samples - a.samples
      || a.distance - b.distance || a.player.rank - b.player.rank).slice(0, width < 620 ? 2 : 4);
    for (const link of examples) link.example = true;
  }
  return { height, players, groups, sharedEdges, usages, netExtent: nets.length ? [Math.min(...nets), Math.max(...nets)] : [0, 0] };
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
  const graph = useMemo(() => buildNetwork(rows, metricsByTag, strategies, width, mode), [rows, metricsByTag, strategies, width, mode]);
  const [focused, setFocused] = useState("");
  const filtered = Boolean(filters.styles.length || filters.rate || filters.net || filters.attack || filters.sample);
  const matching = useMemo(() => filtered ? graph.players.filter(player => matchesNetworkFilters(player, filters)) : graph.players,
    [graph.players, filters, filtered]);
  const visible = useMemo(() => new Set(matching.map(player => player.playerTag)), [matching]);
  const fewMatches = filtered && matching.length <= (width < 600 ? 4 : 10);
  const canUseStyleRates = filters.styles.length > 0 && Boolean(filters.rate);
  const useStyleRates = canUseStyleRates && filters.perStyle;
  const intersection = useMemo(() => filtered ? buildNetworkRegion(matching, width, graph.height) : "", [filtered, matching, width, graph.height]);
  const current = graph.players.find(player => player.playerTag === focused && visible.has(player.playerTag));
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
    const index = matching.indexOf(player);
    const next = matching[(index + directions[event.key] + matching.length) % matching.length];
    frame.current.querySelector(`[data-player="${CSS.escape(next.playerTag)}"]`)?.focus();
  }
  return <section className="overview-network" aria-label="玩家与流派关系图">
    <header className="network-heading"><h3>排名金字塔</h3>
      <div className="network-modes" role="group" aria-label="色块分区"><span>色块</span>
        {Object.entries(modeNames).map(([key, name]) => <button key={key} type="button" aria-pressed={mode === key}
          onClick={() => { setMode(key); setFocused(""); }}>{name}</button>)}
      </div>
    </header>
    <div className="network-filters" role="group" aria-label="玩家交集筛选">
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
      {filtered && <button className="network-reset" type="button" onClick={() => {setFilters(emptyFilters); setFocused("");}}>清除筛选</button>}
    </div>
    <div ref={frame} className="network-plot">
      <svg className="strategy-network-map" viewBox={`0 0 ${width} ${graph.height}`} aria-label={`全球榜玩家，按${modeNames[mode]}分区`} role="group"
        onPointerLeave={() => setFocused("")}>
        <g aria-hidden="true">{graph.groups.map(group => group.region && <path key={group.key} d={group.region} fillRule="evenodd"
          fill={group.color} stroke={group.color} data-region={group.key} onClick={() => pick(group)}
          className={`network-region${filtered && !selectedGroup(group) ? " network-region-quiet" : ""}`} />)}</g>
        {intersection && <path d={intersection} className="network-intersection" fillRule="evenodd" pointerEvents="none" aria-hidden="true" />}
        <g aria-hidden="true" pointerEvents="none">{graph.sharedEdges.map(({ a, b, group }) =>
          <line key={a.playerTag+b.playerTag} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={group.color}
            className={filtered && !(visible.has(a.playerTag) && visible.has(b.playerTag)) ? "network-faded" : "network-shared"} />)}</g>
        <g aria-hidden="true" pointerEvents="none">{graph.usages.map(({ player, group, example }, i) => {
          const active = player.playerTag === current?.playerTag || (visible.has(player.playerTag) && selectedGroup(group));
          if (!active && !example) return null;
          const faint = !active && (filtered || current);
          const secondary = group.key !== player.cluster;
          return <g key={player.playerTag+group.name}><line x1={player.x} y1={player.y} x2={group.x} y2={group.y} stroke={group.color}
            className={active ? "network-highlight" : faint ? "network-faded" : secondary ? "network-cross" : "network-spoke"} />
            {!faint && (example || i % 17 === 0) && <line x1={player.x} y1={player.y} x2={group.x} y2={group.y} pathLength="100" stroke={group.color}
              className="network-signal" style={{animationDelay: `-${i % 11}s`}} />}</g>;
        })}</g>
        {graph.players.map(player => {
          const active = player === current;
          const inSelection = visible.has(player.playerTag);
          const radius = playerRadius(player, sizeBy, graph.netExtent);
          const name = player.playerName || player.playerTag;
          return <g key={player.playerTag} data-rank={player.rank} data-player={player.playerTag} className={`network-player${inSelection ? "" : " network-muted-player"}`}
            role="button" aria-label={`第 ${player.rank} 名，${name}，${player.playerTag}，查看战报`} aria-hidden={!inSelection || undefined}
            tabIndex={inSelection && player === (current ?? matching[0]) ? 0 : -1}
            onMouseEnter={() => inSelection && setFocused(player.playerTag)} onFocus={() => setFocused(player.playerTag)}
            onBlur={() => setFocused("")} onClick={() => inSelection && from(player)} onKeyDown={event => playerKey(event, player)}>
            <circle r={Math.max(radius+2, width < 620 ? 8 : 6)} cx={player.x} cy={player.y} fill="transparent" />
            {active && <circle cx={player.x} cy={player.y} r={radius+4} className="network-point-ring" stroke={player.color} />}
            <circle r={radius} cx={player.x} cy={player.y} fill={player.color}
              className={filtered && inSelection ? "network-point network-point-match" : "network-point"} />
            <title>{`第 ${player.rank} 名 · ${name} · ${player.playerTag} · ${player.primary || "尚无流派样本"}`}</title>
          </g>;
        })}
        {(fewMatches ? matching : graph.players.filter(player => player.tier < 2 || (width >= 600 && annotatedRanks.has(player.rank)))).map(player => {
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
        {graph.groups.map(group =>
          <g key={group.key} className="network-hub" transform={`translate(${group.x} ${group.y})`} role="button"
            aria-label={`${group.name}，${group.members.length} 名玩家`} aria-pressed={selectedGroup(group)} tabIndex={0} onClick={() => pick(group)}
            onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); pick(group); } }}>
            <rect x={group.textLeft ? 8-group.labelW : -8} y="-11" width={group.labelW} height="22" rx="4" className="network-hub-bg" />
            <path d="M0 -6 6 0 0 6 -6 0Z" fill={group.color} stroke="white" strokeWidth="1.4"/>
            <text x={group.textLeft ? -8 : 8} textAnchor={group.textLeft ? "end" : "start"} dy=".35em">{group.name}</text>
            <title>{group.name} · {group.members.length} 名玩家{mode === "style" && ` · ${group.scoredCount} 场`}</title>
          </g>)}
      </svg>
    </div>
    <footer className="network-footer">
      <div className="network-inspect" aria-live="polite">
        <b className="network-count">{filtered ? `交集 ${matching.length} / ${graph.players.length} 人` : `${graph.players.length} 名玩家`}</b>
        {current ? <><b>#{current.rank} {current.playerName || current.playerTag}</b><span>{current.playerTag}</span>
          <span>{current.primary || "暂无流派样本"} · 总体三星率 {rate === null ? "—" : percent.format(rate)}
          {rate !== null && `（${current.stats.attackCount} 场）`} · 日均进攻杯 {attack === null ? "—" : score.format(attack)} · 日均净杯 {net === null ? "—" : score.format(net)}
          {net !== null && `（${current.stats.completedDays} 日）`}</span>
          {useStyleRates && current.uses.filter(use => filters.styles.includes(use.strategy)).map(use =>
            <span key={use.strategy}>{use.strategy} {percent.format(use.threeStarCount / use.scoredCount)}（{use.threeStarCount}/{use.scoredCount}）</span>)}</>
        : filtered ? !matching.length && <span>暂无符合条件的玩家</span> : <span>{strategies.length} 个流派</span>}</div>
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
