import { useEffect, useId, useState } from "react";
import BattleLog from "./BattleLog.jsx";
import { formatTime } from "./battle-time.mjs";
import { scoreText } from "./Standings.jsx";
import "./legend-player.css";

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

function groupByDay(battleViews, today) {
  const days = new Map([[today, { attacks: [], defenses: [] }]]);
  for (const kind of Object.keys(directions)) {
    for (const row of battleViews[kind] ?? []) {
      const day = legendDay(row.battleTimestamp || row.timestamp);
      if (!day || day > today) continue;
      if (!days.has(day)) days.set(day, { attacks: [], defenses: [] });
      days.get(day)[kind].push(row);
    }
  }
  return days;
}

function PlayerDay({ result }) {
  const [selectedDay, setSelectedDay] = useState("");
  const [kind, setKind] = useState("attacks");
  const logId = useId();
  const { battleViews, leagueTier, fetchedAt } = result;
  const today = legendDay(Date.now());
  const battlesByDay = groupByDay(battleViews, today);
  const days = [...battlesByDay.keys()].sort().reverse();
  const day = battlesByDay.has(selectedDay) ? selectedDay : today;
  const battles = battlesByDay.get(day);
  const rank = battleViews.currentLegendRank;
  const fetchedTime = formatTime(fetchedAt);

  return (
    <>
      <header className="legend-player-profile">
        <div>
          <h3>{battleViews.playerName || battleViews.playerTag}</h3>
          <p>{[battleViews.playerTag, leagueTier?.name].filter(Boolean).join(" · ")}</p>
        </div>
        <dl>
          <div><dt>当前全球排名</dt><dd>{Number.isSafeInteger(rank) && rank > 0 ? `第 ${scoreText(rank)} 名` : "—"}</dd></div>
          <div><dt>当前传奇杯</dt><dd>{scoreText(battleViews.currentLegendTrophies)}</dd></div>
        </dl>
      </header>
      <div className="legend-player-day-bar query-card">
        <label>
          联赛日
          <select value={day} onChange={(event) => setSelectedDay(event.target.value)}>
            {days.map((date) => <option key={date} value={date}>{date}{date === today ? "（当前）" : ""}</option>)}
          </select>
        </label>
        <div className="metric-control legend-player-directions" role="group" aria-label="对战方向">
          {Object.entries(directions).map(([direction, label]) => {
            const count = battles[direction].length;
            return (
              <button key={direction} type="button" aria-pressed={kind === direction} aria-controls={logId}
                onClick={() => setKind(direction)}>
                {label} <span>{count === 0 ? "已查到 " : ""}{count}/{dailyLimit}</span>
              </button>
            );
          })}
        </div>
        <p>北京时间 13:00 换日。官方 API 仅返回近期日志，场次按查到的记录统计。</p>
        {fetchedTime !== "—" && <p>查询时间 <time dateTime={fetchedAt}>{fetchedTime}</time></p>}
      </div>
      <div id={logId}>
        <BattleLog key={`${day}-${kind}`} kind={kind} battleViews={{ ...battleViews, ...battles }}
          isSample={false} periodLabel="当日" showStanding={false} />
      </div>
    </>
  );
}

export default function LegendPlayer({ hasDeveloperToken, accountLoading, initialTag = "" }) {
  const [tag, setTag] = useState(() => tagWithoutPrefix(initialTag));
  const [request, setRequest] = useState(() => {
    const playerTag = normalizeTag(initialTag);
    return playerTag ? { playerTag } : null;
  });
  const [reply, setReply] = useState(null);
  const [validation, setValidation] = useState("");
  const headingId = useId();
  const canLookup = hasDeveloperToken && !accountLoading;
  const currentReply = canLookup && reply?.request === request ? reply : null;
  const waiting = Boolean(canLookup && request && !currentReply);

  useEffect(() => {
    if (!canLookup || !request) return;
    let active = true;
    setReply(null);

    async function lookup() {
      try {
        if (typeof window.cocApp?.fetchLegendPlayer !== "function") {
          throw new Error("请在桌面应用中查询传奇战报。");
        }
        const result = await window.cocApp.fetchLegendPlayer(request);
        if (!result?.battleViews) throw new Error("本次查询未返回传奇战报，请重试。");
        if (active) setReply({ request, result });
      } catch (error) {
        const message = String(error?.message || "查询失败，请重试。")
          .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
        if (active) setReply({ request, error: message });
      }
    }

    void Promise.resolve().then(() => { if (active) return lookup(); });
    return () => { active = false; };
  }, [canLookup, request]);

  function editTag(value) {
    setTag(tagWithoutPrefix(value));
    setValidation("");
    if (request && normalizeTag(value) !== request.playerTag) {
      setRequest(null);
      setReply(null);
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!canLookup || waiting) return;
    const playerTag = normalizeTag(tag);
    if (!playerTag) {
      setValidation("请输入有效的玩家标签，例如 2PP8QG。");
      return;
    }
    setValidation("");
    setTag(tagWithoutPrefix(playerTag));
    setReply(null);
    setRequest({ playerTag });
  }

  const error = validation || currentReply?.error;
  const result = currentReply?.result;
  return (
    <section className="legend-player" aria-labelledby={headingId}>
      <h2 id={headingId}>传奇 I 玩家战报</h2>
      <form className="query-card legend-player-search" onSubmit={submit}>
        <label>
          玩家标签
          <span className="legend-tag-field">
            <span className="legend-tag-prefix" aria-hidden="true">#</span>
            <input value={tag} onChange={(event) => editTag(event.target.value)} placeholder="2PP8QG"
              autoComplete="off" spellCheck={false} aria-invalid={Boolean(validation)}
              aria-describedby={validation ? `${headingId}-feedback` : undefined} />
          </span>
        </label>
        <button className="primary" type="submit" disabled={!canLookup || waiting}>查询</button>
        <p className="editor-help">临时查询的标签只在本次使用。</p>
      </form>
      {accountLoading && <p className="feedback" role="status">正在读取令牌状态…</p>}
      {!accountLoading && !hasDeveloperToken && <p className="feedback" role="status">请先在「管理令牌」保存开发者 API 令牌。</p>}
      {waiting && <p className="feedback" role="status">正在查询传奇 I 玩家战报…</p>}
      {error && <p id={`${headingId}-feedback`} className="feedback error" role="alert">{error}</p>}
      {result && <PlayerDay result={result} key={result.battleViews.playerTag} />}
    </section>
  );
}
