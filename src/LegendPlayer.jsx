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

function sumDailyTrophies(rows, loss = false) {
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

function PlayerDay({ result, onLookupPlayer }) {
  const [selectedDay, setSelectedDay] = useState("");
  const [kind, setKind] = useState("attacks");
  const logId = useId();
  const { battleViews, leagueTier, fetchedAt } = result;
  const today = legendDay(Date.now());
  const battlesByDay = groupByDay(battleViews, today);
  const days = [...battlesByDay.keys()].sort().reverse();
  const day = battlesByDay.has(selectedDay) ? selectedDay : today;
  const battles = battlesByDay.get(day);
  const attackTrophies = sumDailyTrophies(battles.attacks);
  const defenseTrophies = sumDailyTrophies(battles.defenses, true);
  const netTrophies = attackTrophies === null || defenseTrophies === null ? null : attackTrophies + defenseTrophies;
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
        <p>北京时间 13:00 换日。杯数和场次按官方 API 返回的近期记录统计。</p>
        {fetchedTime !== "—" && <p>查询时间 <time dateTime={fetchedAt}>{fetchedTime}</time></p>}
      </div>
      <div id={logId}>
        <BattleLog key={`${day}-${kind}`} kind={kind} battleViews={{ ...battleViews, ...battles }}
          isSample={false} periodLabel="当日" showStanding={false} onLookupPlayer={onLookupPlayer}
          dailyTrophies={{ attack: attackTrophies, defense: defenseTrophies, net: netTrophies }} />
      </div>
    </>
  );
}

export function useLegendPlayerLookup({ enabled, tokenRevision }) {
  const [tag, setTag] = useState("");
  const [request, setRequest] = useState(null);
  const [reply, setReply] = useState(null);
  const [validation, setValidation] = useState("");
  const currentReply = enabled && reply?.request === request && reply.tokenRevision === tokenRevision ? reply : null;
  const waiting = Boolean(enabled && request && !currentReply);

  useEffect(() => {
    if (!enabled || !request) return;
    let active = true;

    async function lookup() {
      try {
        if (typeof window.cocApp?.fetchLegendPlayer !== "function") {
          throw new Error("请在桌面应用中查询传奇战报。");
        }
        const result = await window.cocApp.fetchLegendPlayer(request);
        if (!result?.battleViews) throw new Error("本次查询未返回传奇战报，请重试。");
        if (active) setReply({ request, tokenRevision, result });
      } catch (error) {
        const message = String(error?.message || "查询失败，请重试。")
          .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
        if (active) setReply({ request, tokenRevision, error: message });
      }
    }

    void Promise.resolve().then(() => { if (active) return lookup(); });
    return () => { active = false; };
  }, [enabled, request, tokenRevision]);

  function editTag(value) {
    setTag(tagWithoutPrefix(value));
    setValidation("");
    if (request && normalizeTag(value) !== request.playerTag) {
      setRequest(null);
      setReply(null);
    }
  }

  function query(value) {
    if (!enabled) return false;
    const playerTag = normalizeTag(value);
    if (!playerTag) {
      setValidation("请输入有效的玩家标签，例如 2PP8QG。");
      return false;
    }
    setValidation("");
    setTag(tagWithoutPrefix(playerTag));
    setReply(null);
    setRequest({ playerTag });
    return true;
  }

  return { tag, editTag, query, waiting, validation, error: currentReply?.error, result: currentReply?.result };
}

export function LegendPlayerSearch({ lookup, disabled, onLookupPlayer }) {
  const feedbackId = useId();
  const { tag, editTag, waiting, validation, error } = lookup;
  const message = validation || error;

  return (
    <form className="legend-player-search" onSubmit={(event) => {
      event.preventDefault();
      if (!disabled && !waiting) onLookupPlayer(tag);
    }}>
      <label>
        临时查村庄（传奇 I）
        <span className="legend-tag-field">
          <span className="legend-tag-prefix" aria-hidden="true">#</span>
          <input value={tag} onChange={(event) => editTag(event.target.value)} placeholder="2PP8QG"
            autoComplete="off" spellCheck={false} aria-invalid={Boolean(validation)}
            aria-describedby={message ? feedbackId : undefined} />
        </span>
      </label>
      <button type="submit" disabled={disabled || waiting}>临时查询</button>
      {waiting && <p className="editor-help" role="status">正在查询传奇 I 玩家战报…</p>}
      {message && <p id={feedbackId} className="editor-help legend-lookup-error" role="alert">{message}</p>}
    </form>
  );
}

export default function LegendPlayer({ lookup, onLookupPlayer }) {
  const headingId = useId();
  const { result, waiting, error } = lookup;

  return (
    <section className="legend-player" aria-labelledby={headingId}>
      <h2 id={headingId}>传奇 I 玩家战报</h2>
      {result && <PlayerDay result={result} key={result.battleViews.playerTag} onLookupPlayer={onLookupPlayer} />}
      {!result && !waiting && !error && <div className="empty-card">
        <p>在上方输入玩家 Tag，或点击传奇 I 榜单上的玩家名。</p>
      </div>}
    </section>
  );
}
