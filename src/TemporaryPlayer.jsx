import { useEffect, useId, useMemo, useRef, useState } from "react";
import BattleLog from "./BattleLog.jsx";
import PlayerStrategyStats from "./PlayerStrategyStats.jsx";
import GroupReport from "./GroupReport.jsx";
import EquipmentFilter from "./EquipmentFilter.jsx";
import { formatTime } from "./battle-time.mjs";
import { weeklyStanding } from "./weekly-standing.mjs";
import Standings, { LeagueBadge, scoreText, Trophy } from "./Standings.jsx";
import "./temporary-player.css";

const directions = { attacks: "进攻", defenses: "防守" };
const dailyLimit = 8;
const dayResetOffset = 5 * 60 * 60 * 1000;
const legendOneTierId = 105000036;
const groupLoadMessages = {
  loading: "正在查询组员的攻防数据和阵容…",
  partial: "部分组员的战报暂未取全。",
  error: "组员战报加载失败。",
};

function tagWithoutPrefix(value) {
  return typeof value === "string" ? value.replace(/^\s*#\s*/, "") : "";
}

function normalizeTag(value) {
  const tag = tagWithoutPrefix(value).trim().toUpperCase();
  return /^[A-Z0-9]{2,20}$/.test(tag) ? `#${tag}` : "";
}

function legendDay(value) {
  const epoch = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch - dayResetOffset).toISOString().slice(0, 10) : "";
}

function previousDay(day, offset) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10);
}

function sumRecordedTrophies(rows, loss = false) {
  if (!rows.length) return null;
  let total = 0;
  for (const row of rows) {
    if (Number.isFinite(row.trophyDelta)) {
      total += row.trophyDelta;
    } else if (Number.isFinite(row.trophies)) {
      total += loss ? -Math.abs(row.trophies) : row.trophies;
    } else {
      return null;
    }
  }
  return total;
}

function isLegendReport(result) {
  return !result.groupReport && (result.period === "retained" || result.leagueTier?.id === legendOneTierId);
}

function PlayerProfile({ result, onOpenLegend, onLookupPlayer, details, onGroupDetails }) {
  const { battleViews, profile, leagueTier, groupReport, weeklyLeaderboard, weeklyLeaderboardStatus } = result;
  const [rankingOpen, setRankingOpen] = useState(false);
  const [detailStatus, setDetailStatus] = useState("idle");
  const [groupView, setGroupView] = useState("standings");
  const [equipmentFocus, setEquipmentFocus] = useState(null);
  const rankingId = useId();
  const legend = isLegendReport(result);
  const board = details ?? weeklyLeaderboard;
  const hasWeeklyRanking = !legend && board?.rows?.length > 0;
  const weeklyRow = hasWeeklyRanking ? board.rows.find(({ playerTag }) => playerTag === battleViews.playerTag) : null;
  const rank = legend ? battleViews.currentLegendRank : groupReport ? battleViews.standing?.rank : weeklyRow?.rank;
  const hasRank = Number.isSafeInteger(rank) && rank > 0;
  const trophies = legend ? battleViews.currentLegendTrophies : weeklyRow?.trophies ?? profile?.trophies;
  const trophyLabel = legend ? "当前传奇杯" : Number.isFinite(weeklyRow?.trophies) ? "本周总杯数" : "当前奖杯";
  const unavailable = !legend && !groupReport && !hasWeeklyRanking;
  async function loadGroupDetails(force = false) {
    const fetchDetails = window.cocApp?.fetchTemporaryGroupDetails;
    if (detailStatus === "loading") return;
    if (typeof fetchDetails !== "function") { setDetailStatus("error"); return; }
    const { groupTag, seasonId, week } = weeklyLeaderboard;
    const playerTag = battleViews.playerTag;
    setDetailStatus("loading");
    try {
      const next = await fetchDetails({ playerTag, groupTag, seasonId, week, force });
      if (next?.groupTag !== groupTag || next.week !== week || String(next.seasonId) !== String(seasonId)
        || !next.rows?.some((row) => row.playerTag === playerTag)) throw new Error("小组榜单不匹配");
      onGroupDetails(next);
      setDetailStatus(next.partial ? "partial" : "ready");
    } catch {
      setDetailStatus("error");
    }
  }
  function toggleRanking() {
    if (!rankingOpen && detailStatus === "idle") void loadGroupDetails();
    setRankingOpen(!rankingOpen);
  }
  return (
    <>
      <header className="legend-player-profile">
        <div>
          <h3>{battleViews.playerName || battleViews.playerTag}</h3>
          <p className="legend-player-profile-details">
            <span>{battleViews.playerTag}</span>
            {leagueTier ? <LeagueBadge tier={leagueTier} /> : <span>段位未返回</span>}
            {Number.isSafeInteger(profile?.townHallLevel) && profile.townHallLevel > 0 && <span>{profile.townHallLevel} 本</span>}
            {profile?.clanName && <span>{profile.clanName}</span>}
          </p>
        </div>
        <div className="legend-player-ranking">
          <dl>
            <div><dt>榜单</dt><dd>{legend ? "传奇 I 全球榜" : "周排位小组"}</dd></div>
            <div>
              <dt>{legend ? "当前全球排名" : "本周小组排名"}</dt>
              <dd title={legend && !hasRank ? "官方暂未提供全球名次" : undefined}>{hasRank ? `第 ${scoreText(rank)} 名` : "—"}</dd>
            </div>
            {!groupReport && <div><dt>{trophyLabel}</dt><dd>{scoreText(trophies)}</dd></div>}
          </dl>
          {legend && onOpenLegend && <button type="button" onClick={onOpenLegend}>查看全球榜</button>}
          {hasWeeklyRanking && <button type="button" aria-expanded={rankingOpen} aria-controls={rankingId}
            onClick={toggleRanking}>{rankingOpen ? "收起本周小组排名" : "查看本周小组排名"}</button>}
          {unavailable && <p className="legend-player-ranking-message">
            {weeklyLeaderboardStatus === "error" ? "暂时无法读取小组排名，可重新查询。" : "暂无可查询的本周小组排名。"}
          </p>}
        </div>
      </header>
      {hasWeeklyRanking && <div id={rankingId} className="temporary-weekly-ranking" hidden={!rankingOpen}>
        {rankingOpen && <>
          <div className="metric-control group-view-tabs" role="group" aria-label="本周小组战报">
            {Object.entries({ standings: "小组排名", equipment: "装备筛选", meta: "小组流派" }).map(([id, label]) =>
              <button key={id} type="button" aria-pressed={groupView === id}
                onClick={() => { setGroupView(id); setEquipmentFocus(null); }}>{label}</button>)}
          </div>
          {groupLoadMessages[detailStatus] && <div className="temporary-ranking-controls">
            <span role="status">{groupLoadMessages[detailStatus]}</span>
            {(detailStatus === "error" || detailStatus === "partial") &&
              <button type="button" onClick={() => { void loadGroupDetails(true); }}>重新加载组员战报</button>}
          </div>}
          {groupView === "standings" && <Standings rows={board.rows} battleViews={board.battleViews ?? { playerTag: battleViews.playerTag }}
            leagueTier={board.leagueTier ?? leagueTier} groupTag={board.groupTag} week={board.week}
            attacks={board.attacks} onLookupPlayer={onLookupPlayer && (tag => onLookupPlayer(tag, undefined, {
              groupTag: board.groupTag, week: board.week, seasonId: board.seasonId,
              row: board.rows.find(player => player.playerTag === tag),
            }))} focus={equipmentFocus}
            showOwnResults={false} requireFullDefenseRanks />}
          {groupView === "equipment" && details && <EquipmentFilter attacks={details.attacks} standings={details.rows}
            groupTag={details.groupTag} week={details.week} onOpenPlayer={(playerTag, equipment) => {
              setEquipmentFocus({ playerTag, equipment });
              setGroupView("standings");
            }} />}
          {groupView === "meta" && details?.metaReport && <GroupReport report={details.metaReport} battleViews={details.battleViews} />}
          {groupView === "meta" && details && !details.metaReport && <div className="empty-card">暂无小组流派数据</div>}
        </>}
      </div>}
    </>
  );
}

function BattleDirections({ battles, kind, setKind, logId, daily = false, standing }) {
  return (
    <div className="metric-control legend-player-directions" role="group" aria-label="对战方向">
      {Object.entries(directions).map(([direction, label]) => {
        const count = battles[direction]?.length ?? 0;
        const groupCount = standing?.[direction === "attacks" ? "attackCount" : "defenseCount"];
        const total = daily ? `${count === 0 ? "已查到 " : ""}${count}/${dailyLimit}`
          : standing ? `榜单 ${Number.isFinite(groupCount) ? `${scoreText(groupCount)} 场` : "—"} · 明细 ${scoreText(count)} 场`
            : `已收录 ${count} 场`;
        return (
          <button key={direction} type="button" aria-pressed={kind === direction} aria-controls={logId}
            onClick={() => setKind(direction)}>
            {label} <span>{total}</span>
          </button>
        );
      })}
    </div>
  );
}

function LookupTime({ fetchedAt, label = "查询时间" }) {
  const time = formatTime(fetchedAt);
  return time === "—" ? null : <p>{label} <time dateTime={fetchedAt}>{time}</time></p>;
}

function HistoryCoverage({ recentCoverage, history, historySaved }) {
  return (
    <dl className="history-coverage" aria-label="战报覆盖范围">
      {Object.entries(directions).map(([kind, label]) => {
        const recent = recentCoverage?.[kind];
        return <div key={kind}>
          <dt>{label}</dt>
          <dd>{recent ? `本次返回 ${scoreText(recent.count)} 场` : "本次近期日志不可用"}
            {recent?.oldestAt && <> · 最早 <time dateTime={recent.oldestAt}>{formatTime(recent.oldestAt)}</time></>}
          </dd>
          <dd>{historySaved ? "本机已收录" : "本次可查看"} {scoreText(history[kind]?.length ?? 0)} 场</dd>
        </div>;
      })}
    </dl>
  );
}

function PlayerHistory({ result, onLookupPlayer, onOpenLegend, origin }) {
  const { battleViews, history = battleViews, fetchedAt, weekStart, recentCoverage, historySaved } = result;
  const defaultMode = isLegendReport(result) ? "LEGEND" : "RANKED";
  const [mode, setMode] = useState(defaultMode);
  const [selectedRange, setSelectedRange] = useState("");
  const [details, setDetails] = useState(null);
  const [kind, setKind] = useState(battleViews.attacks?.length || !battleViews.defenses?.length ? "attacks" : "defenses");
  const logId = useId();
  const today = legendDay(Date.now());
  const recentDays = [today, previousDay(today, 1), previousDay(today, 2)];
  const dateLabels = ["当前", "昨天", "前天"];
  const modes = new Set([defaultMode]);
  const days = new Set(recentDays);
  const archived = { attacks: [], defenses: [] };
  for (const direction of Object.keys(directions)) {
    for (const row of history[direction] ?? []) {
      const day = legendDay(row.battleTimestamp || row.timestamp);
      if (!day || day > today) continue;
      const rowMode = row.battleType || defaultMode;
      modes.add(rowMode);
      if (rowMode !== mode) continue;
      days.add(day);
      archived[direction].push({ row, day });
    }
  }
  const legend = mode === "LEGEND";
  const fallbackRange = legend ? today : "week";
  const range = selectedRange === "week" || selectedRange === "all" || days.has(selectedRange) ? selectedRange : fallbackRange;
  const singleDay = days.has(range);
  const weekly = result.weeklyLeaderboard;
  const weekBoard = mode === "RANKED" && weekly?.week === weekStart &&
    weekly?.battleViews?.playerTag === battleViews.playerTag ? weekly : null;
  const standing = range === "week" ? weeklyStanding(weekBoard, battleViews.playerTag, details, origin) : null;
  const battles = standing ? weekBoard.battleViews : Object.fromEntries(Object.entries(archived).map(([direction, entries]) => [direction,
    entries.filter(({ day }) => range === "all" || (range === "week" ? day >= weekStart : day === range)).map(({ row }) => row),
  ]));
  const attackTrophies = sumRecordedTrophies(battles.attacks);
  const defenseTrophies = sumRecordedTrophies(battles.defenses, legend);
  const netTrophies = attackTrophies === null || defenseTrophies === null ? null : attackTrophies + defenseTrophies;
  const scope = standing ? "本周小组" : singleDay ? "当日" : "已收录";
  const strategyRanges = [
    { key: "recent", label: "本次近期", attacks: (result.recentAttacks ?? []).filter((row) => row.battleType === mode) },
    { key: "week", label: "本周", attacks: weekBoard?.battleViews.attacks ?? archived.attacks.filter(({ day }) => day >= weekStart).map(({ row }) => row) },
    { key: "all", label: "全部已收录", attacks: archived.attacks.map(({ row }) => row) },
  ];

  return (
    <>
      <PlayerProfile result={result} onOpenLegend={onOpenLegend} onLookupPlayer={onLookupPlayer} details={details} onGroupDetails={setDetails} />
      <PlayerStrategyStats ranges={strategyRanges} />
      <div className="legend-player-day-bar legend-player-week-bar query-card">
        <div className="history-controls">
          {modes.size > 1 && <label>对战类型
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              {[...modes].map((item) => <option key={item} value={item}>{item === "LEGEND" ? "传奇 I" : "周排位"}</option>)}
            </select>
          </label>}
          <label>联赛日
            <select value={range} onChange={(event) => setSelectedRange(event.target.value)}>
              {[...days].sort().reverse().map((date) => {
                const index = recentDays.indexOf(date);
                return <option key={date} value={date}>{date}{index >= 0 ? `（${dateLabels[index]}）` : ""}</option>;
              })}
              <option value="week">本周</option>
              <option value="all">全部已收录</option>
            </select>
          </label>
          <BattleDirections battles={battles} kind={kind} setKind={setKind} logId={logId} daily={legend && singleDay} standing={standing} />
        </div>
        <HistoryCoverage recentCoverage={recentCoverage} history={history} historySaved={historySaved} />
        <p>{standing ? `小组 ${weekBoard.groupTag} · ${weekBoard.week} 周 · 场次与得杯取自周榜，明细按已取得的对战显示。`
          : "北京时间 13:00 换日。日期和杯数按已收录的战报统计。"}</p>
        <LookupTime fetchedAt={fetchedAt} />
      </div>
      <dl className="battle-summary legend-player-week-cups" aria-label={`${scope}杯数`}>
        <div><dt>{scope}进攻得杯</dt><dd><Trophy value={standing ? standing.attackTrophies : attackTrophies} /></dd></div>
        <div><dt>{scope}{legend ? "防守扣杯" : "防守得杯"}</dt><dd><Trophy value={standing ? standing.defenseTrophies : defenseTrophies} /></dd></div>
        <div><dt>{scope}{standing ? "总杯数" : legend ? "净杯" : "得杯合计"}</dt><dd><Trophy value={standing ? standing.trophies : netTrophies} change={!standing} /></dd></div>
      </dl>
      <div id={logId}>
        {battles[kind].length ? <BattleLog key={`${mode}-${range}-${kind}`} kind={kind}
          battleViews={{ ...battleViews, ...battles, defenseTrophyMode: legend ? "lost" : "earned" }}
          isSample={false} periodLabel={singleDay ? "当日" : range === "week" ? "本周" : "历史"}
          showStanding={false} officialStanding={standing} recordedOnly={!standing} onLookupPlayer={onLookupPlayer} />
          : <div className="empty-card"><p>这段时间暂无已收录的{directions[kind]}记录。</p></div>}
      </div>
    </>
  );
}

function PlayerWeek({ result, onLookupPlayer }) {
  const { battleViews, fetchedAt, groupReport } = result;
  const { standing, attacks = [], defenses = [] } = battleViews;
  const [kind, setKind] = useState(attacks?.length || !defenses?.length ? "attacks" : "defenses");
  const logId = useId();
  const { week, groupTag } = groupReport;

  return (
    <>
      <PlayerProfile result={result} />
      <PlayerStrategyStats ranges={[{ key: "week", label: "本周小组", attacks }]} />
      <div className="legend-player-day-bar legend-player-week-bar query-card">
        <BattleDirections battles={battleViews} kind={kind} setKind={setKind} logId={logId} standing={standing} />
        {(week || groupTag) && <p>{[week && `${week} 周`, groupTag && `小组 ${groupTag}`].filter(Boolean).join(" · ")}</p>}
        <p>杯数和场次来自同一份小组排位榜。明细显示战报收录的对战。</p>
        <LookupTime fetchedAt={fetchedAt} label="小组战报时间" />
      </div>
      <dl className="battle-summary legend-player-week-cups" aria-label="小组排位杯数">
        <div><dt>小组进攻得杯</dt><dd><Trophy value={standing?.attackTrophies} /></dd></div>
        <div><dt>小组防守得杯</dt><dd><Trophy value={standing?.defenseTrophies} /></dd></div>
        <div><dt>小组总杯数</dt><dd><Trophy value={standing?.trophies} change={false} /></dd></div>
      </dl>
      <div id={logId}>
        {!battleViews[kind]?.length ? <div className="empty-card"><p>这份小组战报未收录该方向的对战明细。</p></div>
          : <BattleLog key={kind} kind={kind} battleViews={battleViews} isSample={false}
            periodLabel="小组" showStanding={false} officialStanding={standing} onLookupPlayer={onLookupPlayer} />}
      </div>
    </>
  );
}

export function useTemporaryPlayerLookup({ enabled, tokenRevision }) {
  const [tag, setTag] = useState("");
  const [request, setRequest] = useState(null);
  const [reply, setReply] = useState(null);
  const [validation, setValidation] = useState("");
  const [history, setHistory] = useState([]);
  const [historyRevision, setHistoryRevision] = useState(0);
  const requestEnabled = Boolean(request && (request.group || enabled));
  const revision = request?.group ? null : tokenRevision;
  const currentReply = requestEnabled && reply?.request === request && reply.revision === revision ? reply : null;
  const waiting = requestEnabled && !currentReply;

  useEffect(() => {
    const api = window.cocApp;
    if (typeof api?.getTemporaryQueryHistory !== "function") return;
    let active = true;

    async function loadHistory() {
      try {
        const entries = await api.getTemporaryQueryHistory();
        if (active && Array.isArray(entries)) setHistory(entries);
      } catch {
        // History is optional for opening a player's report.
      }
    }

    void loadHistory();
    return () => { active = false; };
  }, [historyRevision]);

  useEffect(() => {
    if (!requestEnabled) return;
    let active = true;

    async function lookup() {
      try {
        if (typeof window.cocApp?.fetchTemporaryPlayer !== "function") {
          throw new Error("请在桌面应用中查询村庄战报。");
        }
        const result = await window.cocApp.fetchTemporaryPlayer(request);
        if (!result?.battleViews) throw new Error("本次查询未返回村庄战报，请重试。");
        if (!request.group) setHistoryRevision((value) => value + 1);
        if (active) setReply({ request, revision, result });
      } catch (error) {
        const message = String(error?.message || "查询失败，请重试。")
          .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
        if (active) setReply({ request, revision, error: message });
      }
    }

    void Promise.resolve().then(() => { if (active) return lookup(); });
    return () => { active = false; };
  }, [requestEnabled, request, revision]);

  function editTag(value) {
    setTag(tagWithoutPrefix(value));
    setValidation("");
    if ((waiting || currentReply?.error) && normalizeTag(value) !== request?.playerTag) {
      setRequest(null);
      setReply(null);
    }
  }

  function query(value, group) {
    if (!enabled && !group) return false;
    const playerTag = normalizeTag(value);
    if (!playerTag) {
      setValidation("请输入有效的玩家标签，例如 2PP8QG。");
      return false;
    }
    setValidation("");
    setTag(tagWithoutPrefix(playerTag));
    setReply(null);
    setRequest(group ? { playerTag, group } : { playerTag });
    return true;
  }

  function dismiss() {
    setRequest(null);
    setReply(null);
    setValidation("");
  }
  return { tag, editTag, query, dismiss, waiting, validation, history, error: currentReply?.error, result: currentReply?.result };
}

const searchPageSize = 10;
const noBoardRows = [];

export function TemporaryPlayerSearch({ lookup, accounts, boardRows = noBoardRows, disabled, onLookupPlayer, onSelectSaved, onManageVillages }) {
  const feedbackId = useId();
  const historyId = useId();
  const field = useRef(null);
  const input = useRef(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [boardPage, setBoardPage] = useState(0);
  const { tag, editTag, waiting, validation, error, history = [] } = lookup;
  const message = validation || error;
  const live = accounts?.hasDeveloperToken ?? true;
  const query = filtering ? tag.trim().toUpperCase() : "";
  const showHistory = historyOpen && !disabled && !waiting;
  const matches = (name, playerTag) => !query || [name, playerTag].some(value => value?.toUpperCase().includes(query));
  const saved = (accounts?.accounts ?? []).filter(({ name, tag: key }) => matches(name, key));
  const matchingHistory = history.filter(({ playerName, playerTag }) => matches(playerName, playerTag));
  const visibleHistory = expanded ? matchingHistory : matchingHistory.slice(0, 5);
  const visibleSaved = saved.filter(({ tag: key }) => !visibleHistory.some(({ playerTag }) => playerTag === key));
  const boardMatches = useMemo(() => {
    if (!showHistory || !query) return [];
    const exact = [], partial = [];
    const seen = new Set();
    for (const row of boardRows) {
      const key = normalizeTag(row.playerTag);
      if (!key || seen.has(key)) continue;
      const name = row.playerName?.trim().toUpperCase() ?? "";
      if (!name.includes(query) && !key.includes(query)) continue;
      seen.add(key);
      (name === query || key === normalizeTag(query) ? exact : partial).push(row);
    }
    return exact.concat(partial);
  }, [boardRows, query, showHistory]);
  const shownTags = new Set([...visibleSaved.map(a => normalizeTag(a.tag)), ...visibleHistory.map(a => normalizeTag(a.playerTag))]);
  const boardChoices = boardMatches.filter(row => !shownTags.has(normalizeTag(row.playerTag)));
  const boardPages = Math.ceil(boardChoices.length / searchPageSize);
  const currentBoardPage = Math.min(boardPage, Math.max(0, boardPages - 1));
  const visibleBoard = boardChoices.slice(currentBoardPage * searchPageSize, (currentBoardPage + 1) * searchPageSize);

  function closeHistory() {
    setHistoryOpen(false);
    setExpanded(false);
    setFiltering(false);
    setBoardPage(0);
  }

  useEffect(() => {
    if (!showHistory) return;
    function dismissOutside(event) {
      if (!field.current?.contains(event.target)) closeHistory();
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [showHistory]);

  function submit(value, savedTag) {
    closeHistory();
    if (disabled || waiting) return;
    if (savedTag && onSelectSaved) onSelectSaved(savedTag);
    else if (live) onLookupPlayer(value);
    else onManageVillages?.();
  }

  function submitInput() {
    const term = tag.trim().toUpperCase();
    if (term) {
      const exactTag = normalizeTag(tag);
      const savedTag = saved.find(a => normalizeTag(a.tag) === exactTag);
      if (exactTag && (savedTag || matchingHistory.some(row => normalizeTag(row.playerTag) === exactTag)
        || boardMatches.some(row => normalizeTag(row.playerTag) === exactTag))) {
        return submit(exactTag, !live && savedTag?.tag);
      }
      const names = new Map();
      for (const { tag: key, name } of saved) {
        if (name?.trim().toUpperCase() === term) names.set(normalizeTag(key), key);
      }
      for (const { playerTag, playerName } of [...matchingHistory, ...boardMatches]) {
        const key = normalizeTag(playerTag);
        if (playerName?.trim().toUpperCase() === term && !names.has(key)) names.set(key, null);
      }
      if (names.size === 1) {
        const [key, savedKey] = names.entries().next().value;
        return submit(key, savedKey);
      }
      if (names.size > 1 || (!exactTag && (visibleBoard.length || saved.length || matchingHistory.length))) {
        setFiltering(true);
        setHistoryOpen(true);
        input.current?.focus();
        return;
      }
    }
    submit(tag);
  }

  return (
    <form className="legend-player-search" role="search" aria-label="查询村庄" ref={field}
        onSubmit={(event) => { event.preventDefault(); submitInput(); }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) closeHistory();
        }}
        onKeyDown={(event) => {
          if (!showHistory) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            input.current?.focus();
            closeHistory();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const choices = [input.current, ...field.current.querySelectorAll(".legend-query-history button:enabled")];
            const index = choices.indexOf(event.target);
            if (index < 0) return;
            event.preventDefault();
            choices[(index + (event.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length].focus();
          }
        }}>
          <label className="legend-tag-field">
            <span className="legend-tag-prefix" aria-hidden="true">#</span>
            <input id="temporary-village-tag" ref={input} value={tag}
              onChange={(event) => { editTag(event.target.value); setFiltering(true); setExpanded(false); setBoardPage(0); setHistoryOpen(true); }}
              placeholder="搜索村庄" aria-label="搜索村庄名称或玩家标签" maxLength={64} disabled={disabled}
              onFocus={(event) => { setHistoryOpen(true); event.target.select(); }} onClick={() => setHistoryOpen(true)}
              autoComplete="off" spellCheck={false} aria-invalid={Boolean(validation)}
              aria-describedby={message ? feedbackId : undefined} aria-controls={showHistory ? historyId : undefined} />
          </label>
          <button className="village-submit" type="submit" aria-label="查询村庄" disabled={disabled || waiting}>
            <span className="village-search-icon" aria-hidden="true" /></button>
      {(showHistory || waiting || message) && <div className="lookup-popover">
        {waiting && <p className="lookup-status" role="status">正在查询…</p>}
        {message && <p id={feedbackId} className="lookup-status legend-lookup-error" role="alert">{message}</p>}
        {showHistory && <section className="legend-query-history" id={historyId} aria-label="村庄搜索结果">
          {visibleHistory.length > 0 && <><p className="legend-query-history-heading">最近查询</p>
          <ul className="legend-query-history-list" id={`${historyId}-entries`}>
            {visibleHistory.map(({ playerTag, playerName }) => <li key={playerTag}>
              <button type="button" disabled={!live && !saved.some(a => a.tag === playerTag)}
                onClick={() => submit(playerTag, !live && playerTag)}>
                {playerName && playerName !== playerTag && <span className="legend-query-history-name" title={playerName}>{playerName}</span>}
                <span className="legend-query-history-tag">{playerTag}</span>
              </button>
            </li>)}
          </ul></>}
          {matchingHistory.length > 5 && <div className="legend-query-history-footer">
            <button type="button" className="text-button" aria-expanded={expanded} aria-controls={`${historyId}-entries`}
              onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "展开更多"}</button>
          </div>}
          {visibleSaved.length > 0 && <><p className="legend-query-history-heading">常用村庄</p>
            <ul className="legend-query-history-list">{visibleSaved.map(a => <li key={a.tag}>
              <button type="button" onClick={() => submit(a.tag, a.tag)}>
                {a.name && a.name !== a.tag && <span className="legend-query-history-name">{a.name}</span>}
                <span className="legend-query-history-tag">{a.tag}</span>
              </button>
            </li>)}</ul></>}
          {visibleBoard.length > 0 && <><p className="legend-query-history-heading">榜单玩家</p>
            <ul className="legend-query-history-list" aria-label="匹配的榜单玩家">{visibleBoard.map(row =>
              <li key={row.playerTag}><button type="button" disabled={!live} onClick={() => submit(row.playerTag)}>
                <span className="legend-query-history-name" title={row.playerName}>#{row.rank} {row.playerName}</span>
                <span className="legend-query-history-tag">{row.playerTag}</span>
              </button></li>)}</ul>
            {boardPages > 1 && <div className="legend-query-history-footer">
              <button type="button" className="text-button" disabled={!currentBoardPage} onClick={() => setBoardPage(currentBoardPage - 1)}>上一页</button>
              <span>{currentBoardPage + 1} / {boardPages}</span>
              <button type="button" className="text-button" disabled={currentBoardPage + 1 === boardPages} onClick={() => setBoardPage(currentBoardPage + 1)}>下一页</button>
            </div>}</>}
          {!live && <button className="lookup-settings" type="button" onClick={() => { closeHistory(); onManageVillages?.(); }}>设置 API 令牌</button>}
          {live && !visibleSaved.length && !visibleHistory.length && !visibleBoard.length && (!query
            ? <p className="legend-query-history-empty">暂无查询记录</p>
            : normalizeTag(tag) ? <button className="lookup-settings" type="button" onClick={() => submit(tag)}>查询 {normalizeTag(tag)}</button>
              : <p className="legend-query-history-empty">无匹配村庄</p>)}
        </section>}
      </div>}
    </form>
  );
}

export default function TemporaryPlayer({ lookup, onLookupPlayer, onOpenLegend, origin }) {
  const headingId = useId();
  const { result, waiting, error } = lookup;
  const groupReport = result?.groupReport;
  const PlayerReport = groupReport ? PlayerWeek : PlayerHistory;

  return (
    <section className="legend-player" aria-labelledby={headingId}>
      <h2 id={headingId}>村庄战报</h2>
      {result && <PlayerReport result={result} origin={origin}
        key={[result.battleViews.playerTag, groupReport?.groupTag ?? result.weeklyLeaderboard?.groupTag,
          groupReport?.week ?? result.weeklyLeaderboard?.week, result.weeklyLeaderboard?.seasonId].join(":")}
        onLookupPlayer={onLookupPlayer} onOpenLegend={onOpenLegend} />}
      {!result && !waiting && !error && <div className="empty-card">
        <p>暂无战报</p>
      </div>}
    </section>
  );
}
