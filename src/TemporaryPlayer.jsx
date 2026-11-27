import { useEffect, useId, useState } from "react";
import BattleLog from "./BattleLog.jsx";
import PlayerStrategyStats from "./PlayerStrategyStats.jsx";
import { formatTime } from "./battle-time.mjs";
import { LeagueBadge, scoreText, Trophy } from "./Standings.jsx";
import "./temporary-player.css";

const directions = { attacks: "进攻", defenses: "防守" };
const dailyLimit = 8;
const dayResetOffset = 5 * 60 * 60 * 1000;

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

function PlayerProfile({ result, daily }) {
  const { battleViews, profile, leagueTier, groupReport } = result;
  const rank = daily ? battleViews.currentLegendRank : battleViews.standing?.rank;
  const trophies = daily ? battleViews.currentLegendTrophies : profile?.trophies;
  return (
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
      <dl>
        {(daily || groupReport || Number.isSafeInteger(rank) && rank > 0) && <div>
          <dt>{daily ? "当前全球排名" : groupReport ? "小组排名" : "本周小组排名"}</dt>
          <dd>{Number.isSafeInteger(rank) && rank > 0 ? `第 ${scoreText(rank)} 名` : "—"}</dd>
        </div>}
        {!groupReport && <div><dt>{daily ? "当前传奇杯" : "当前奖杯"}</dt><dd>{scoreText(trophies)}</dd></div>}
      </dl>
    </header>
  );
}

function BattleDirections({ battles, kind, setKind, logId, daily = false, groupReport }) {
  return (
    <div className="metric-control legend-player-directions" role="group" aria-label="对战方向">
      {Object.entries(directions).map(([direction, label]) => {
        const count = battles[direction]?.length ?? 0;
        const groupCount = battles.standing?.[direction === "attacks" ? "attackCount" : "defenseCount"];
        const total = daily ? `${count === 0 ? "已查到 " : ""}${count}/${dailyLimit}`
          : groupReport ? `榜单 ${Number.isFinite(groupCount) ? `${scoreText(groupCount)} 场` : "—"} · 明细 ${scoreText(count)} 场`
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

function PlayerHistory({ result, onLookupPlayer }) {
  const { battleViews, history = battleViews, fetchedAt, weekStart, recentCoverage, historySaved } = result;
  const defaultMode = result.period === "retained" ? "LEGEND" : "RANKED";
  const [mode, setMode] = useState(defaultMode);
  const [selectedRange, setSelectedRange] = useState("");
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
  const battles = Object.fromEntries(Object.entries(archived).map(([direction, entries]) => [direction,
    entries.filter(({ day }) => range === "all" || (range === "week" ? day >= weekStart : day === range)).map(({ row }) => row),
  ]));
  const attackTrophies = sumRecordedTrophies(battles.attacks);
  const defenseTrophies = sumRecordedTrophies(battles.defenses, legend);
  const netTrophies = attackTrophies === null || defenseTrophies === null ? null : attackTrophies + defenseTrophies;
  const scope = singleDay ? "当日" : "已收录";
  const strategyRanges = [
    { key: "recent", label: "本次近期", attacks: (result.recentAttacks ?? []).filter((row) => row.battleType === mode) },
    { key: "week", label: "本周", attacks: archived.attacks.filter(({ day }) => day >= weekStart).map(({ row }) => row) },
    { key: "all", label: "全部已收录", attacks: archived.attacks.map(({ row }) => row) },
  ];

  return (
    <>
      <PlayerProfile result={result} daily={defaultMode === "LEGEND"} />
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
          <BattleDirections battles={battles} kind={kind} setKind={setKind} logId={logId} daily={legend && singleDay} />
        </div>
        <HistoryCoverage recentCoverage={recentCoverage} history={history} historySaved={historySaved} />
        <p>北京时间 13:00 换日。日期和杯数按已收录的战报统计。</p>
        <LookupTime fetchedAt={fetchedAt} />
      </div>
      <dl className="battle-summary legend-player-week-cups" aria-label={`${scope}杯数`}>
        <div><dt>{scope}进攻得杯</dt><dd><Trophy value={attackTrophies} /></dd></div>
        <div><dt>{scope}{legend ? "防守扣杯" : "防守得杯"}</dt><dd><Trophy value={defenseTrophies} /></dd></div>
        <div><dt>{scope}{legend ? "净杯" : "得杯合计"}</dt><dd><Trophy value={netTrophies} /></dd></div>
      </dl>
      <div id={logId}>
        {battles[kind].length ? <BattleLog key={`${mode}-${range}-${kind}`} kind={kind}
          battleViews={{ ...battleViews, ...battles, defenseTrophyMode: legend ? "lost" : "earned" }}
          isSample={false} periodLabel={singleDay ? "当日" : range === "week" ? "本周" : "历史"}
          showStanding={false} onLookupPlayer={onLookupPlayer} />
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
        <BattleDirections battles={battleViews} kind={kind} setKind={setKind} logId={logId} groupReport={groupReport} />
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
            periodLabel="小组" showStanding={false} onLookupPlayer={onLookupPlayer} />}
      </div>
    </>
  );
}

export function useTemporaryPlayerLookup({ enabled, tokenRevision }) {
  const [tag, setTag] = useState("");
  const [request, setRequest] = useState(null);
  const [reply, setReply] = useState(null);
  const [validation, setValidation] = useState("");
  const requestEnabled = Boolean(request && (request.group || enabled));
  const revision = request?.group ? null : tokenRevision;
  const currentReply = requestEnabled && reply?.request === request && reply.revision === revision ? reply : null;
  const waiting = requestEnabled && !currentReply;

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
    if (request && normalizeTag(value) !== request.playerTag) {
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

  return { tag, editTag, query, waiting, validation, error: currentReply?.error, result: currentReply?.result };
}

export function TemporaryPlayerSearch({ lookup, disabled, onLookupPlayer }) {
  const feedbackId = useId();
  const { tag, editTag, waiting, validation, error } = lookup;
  const message = validation || error;

  return (
    <form className="legend-player-search" onSubmit={(event) => {
      event.preventDefault();
      if (!disabled && !waiting) onLookupPlayer(tag);
    }}>
      <label>
        临时查村庄
        <span className="legend-tag-field">
          <span className="legend-tag-prefix" aria-hidden="true">#</span>
          <input id="temporary-village-tag" value={tag} onChange={(event) => editTag(event.target.value)} placeholder="2PP8QG"
            autoComplete="off" spellCheck={false} aria-invalid={Boolean(validation)}
            aria-describedby={message ? feedbackId : undefined} />
        </span>
      </label>
      <button type="submit" disabled={disabled || waiting}>临时查询</button>
      {waiting && <p className="editor-help" role="status">正在查询村庄战报…</p>}
      {message && <p id={feedbackId} className="editor-help legend-lookup-error" role="alert">{message}</p>}
    </form>
  );
}

export default function TemporaryPlayer({ lookup, onLookupPlayer }) {
  const headingId = useId();
  const { result, waiting, error } = lookup;
  const groupReport = result?.groupReport;
  const PlayerReport = groupReport ? PlayerWeek : PlayerHistory;

  return (
    <section className="legend-player" aria-labelledby={headingId}>
      <h2 id={headingId}>临时村庄战报</h2>
      {result && <PlayerReport result={result}
        key={[result.battleViews.playerTag, groupReport?.groupTag, groupReport?.week].join(":")} onLookupPlayer={onLookupPlayer} />}
      {!result && !waiting && !error && <div className="empty-card">
        <p>在上方输入玩家标签，或点击榜单和战报中的玩家名称。</p>
      </div>}
    </section>
  );
}
