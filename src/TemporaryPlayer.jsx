import { useEffect, useId, useState } from "react";
import BattleLog from "./BattleLog.jsx";
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

function PlayerProfile({ result, daily }) {
  const { battleViews, profile, leagueTier } = result;
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
        {(daily || Number.isSafeInteger(rank) && rank > 0) && <div>
          <dt>{daily ? "当前全球排名" : "本周小组排名"}</dt>
          <dd>{Number.isSafeInteger(rank) && rank > 0 ? `第 ${scoreText(rank)} 名` : "—"}</dd>
        </div>}
        <div><dt>{daily ? "当前传奇杯" : "当前奖杯"}</dt><dd>{scoreText(trophies)}</dd></div>
      </dl>
    </header>
  );
}

function BattleDirections({ battles, kind, setKind, logId, daily = false }) {
  return (
    <div className="metric-control legend-player-directions" role="group" aria-label="对战方向">
      {Object.entries(directions).map(([direction, label]) => {
        const count = battles[direction]?.length ?? 0;
        const total = daily ? `${count === 0 ? "已查到 " : ""}${count}/${dailyLimit}` : `已查到 ${count} 场`;
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

function LookupTime({ fetchedAt }) {
  const time = formatTime(fetchedAt);
  return time === "—" ? null : <p>查询时间 <time dateTime={fetchedAt}>{time}</time></p>;
}

function PlayerDay({ result, onLookupPlayer }) {
  const [selectedDay, setSelectedDay] = useState("");
  const [kind, setKind] = useState("attacks");
  const logId = useId();
  const { battleViews, fetchedAt } = result;
  const today = legendDay(Date.now());
  const battlesByDay = groupByDay(battleViews, today);
  const days = [...battlesByDay.keys()].sort().reverse();
  const day = battlesByDay.has(selectedDay) ? selectedDay : today;
  const battles = battlesByDay.get(day);
  const attackTrophies = sumDailyTrophies(battles.attacks);
  const defenseTrophies = sumDailyTrophies(battles.defenses, true);
  const netTrophies = attackTrophies === null || defenseTrophies === null ? null : attackTrophies + defenseTrophies;

  return (
    <>
      <PlayerProfile result={result} daily />
      <div className="legend-player-day-bar query-card">
        <label>
          联赛日
          <select value={day} onChange={(event) => setSelectedDay(event.target.value)}>
            {days.map((date) => <option key={date} value={date}>{date}{date === today ? "（当前）" : ""}</option>)}
          </select>
        </label>
        <BattleDirections battles={battles} kind={kind} setKind={setKind} logId={logId} daily />
        <p>北京时间 13:00 换日。杯数和场次按官方 API 返回的近期记录统计。</p>
        <LookupTime fetchedAt={fetchedAt} />
      </div>
      <div id={logId}>
        <BattleLog key={`${day}-${kind}`} kind={kind} battleViews={{ ...battleViews, ...battles }}
          isSample={false} periodLabel="当日" showStanding={false} onLookupPlayer={onLookupPlayer}
          dailyTrophies={{ attack: attackTrophies, defense: defenseTrophies, net: netTrophies }} />
      </div>
    </>
  );
}

function PlayerWeek({ result, onLookupPlayer }) {
  const { battleViews, profile, leagueTier, weekStart, fetchedAt } = result;
  const { standing, attacks, defenses } = battleViews;
  const [kind, setKind] = useState(attacks?.length || !defenses?.length ? "attacks" : "defenses");
  const logId = useId();
  const hasBattles = Boolean(attacks?.length || defenses?.length);
  const attackTrophies = attacks?.length ? standing?.attackTrophies : null;
  const defenseTrophies = defenses?.length ? standing?.defenseTrophies : null;
  const totalTrophies = Number.isFinite(attackTrophies) && Number.isFinite(defenseTrophies)
    ? attackTrophies + defenseTrophies : null;
  const noBattles = leagueTier?.id === 105000000 ? "该村庄尚未进入排位联赛。"
    : battleViews.logAvailable === false ? "官方 API 暂无该村庄的公开对战日志。"
      : `${profile?.currentGroupTag ? "" : "官方 API 未返回本周排位小组。"}本周已查到进攻 0 场、防守 0 场。`;

  return (
    <>
      <PlayerProfile result={result} />
      <div className="legend-player-day-bar legend-player-week-bar query-card">
        {hasBattles && <BattleDirections battles={battleViews} kind={kind} setKind={setKind} logId={logId} />}
        {(weekStart || profile?.currentGroupTag) && <p>{[weekStart && `${weekStart} 周`, profile?.currentGroupTag && `小组 ${profile.currentGroupTag}`].filter(Boolean).join(" · ")}</p>}
        {battleViews.logAvailable !== false && <p>杯数和场次按官方 API 返回的近期记录统计。</p>}
        <LookupTime fetchedAt={fetchedAt} />
      </div>
      {hasBattles ? (
        <>
          <dl className="battle-summary" aria-label="本周杯数">
            <div><dt>本周进攻得杯</dt><dd><Trophy value={attackTrophies} /></dd></div>
            <div><dt>本周防守得杯</dt><dd><Trophy value={defenseTrophies} /></dd></div>
            <div><dt>本周总得杯</dt><dd><Trophy value={totalTrophies} /></dd></div>
          </dl>
          <div id={logId}>
            <BattleLog key={kind} kind={kind} battleViews={battleViews} isSample={false}
              periodLabel="本周" showStanding={false} onLookupPlayer={onLookupPlayer} />
          </div>
        </>
      ) : <div className="empty-card"><p>{noBattles}</p></div>}
    </>
  );
}

export function useTemporaryPlayerLookup({ enabled, tokenRevision }) {
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
        if (typeof window.cocApp?.fetchTemporaryPlayer !== "function") {
          throw new Error("请在桌面应用中查询村庄战报。");
        }
        const result = await window.cocApp.fetchTemporaryPlayer(request);
        if (!result?.battleViews) throw new Error("本次查询未返回村庄战报，请重试。");
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
          <input value={tag} onChange={(event) => editTag(event.target.value)} placeholder="2PP8QG"
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
  const PlayerReport = result?.period === "retained" || result?.leagueTier?.id === 105000036 ? PlayerDay : PlayerWeek;

  return (
    <section className="legend-player" aria-labelledby={headingId}>
      <h2 id={headingId}>临时村庄战报</h2>
      {result && <PlayerReport result={result} key={result.battleViews.playerTag} onLookupPlayer={onLookupPlayer} />}
      {!result && !waiting && !error && <div className="empty-card">
        <p>在上方输入玩家标签，或点击榜单和战报中的玩家名称。</p>
      </div>}
    </section>
  );
}
