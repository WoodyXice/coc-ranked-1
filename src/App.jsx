import { useEffect, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import AccountPanel from "./AccountPanel.jsx";
import ArmyLineup, { ArmyAttribution, hasLineup } from "./ArmyLineup.jsx";
import Standings, { StandingSummary, Trophy } from "./Standings.jsx";
import { formatDuration, formatTime } from "./battle-time.mjs";

const TAU = Math.PI * 2;
const CHART_SIZE = 400;
const formatNumber = new Intl.NumberFormat("zh-CN");
const formatShare = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function Pie({ rows, active, onActive }) {
  const canvas = useRef(null);
  const angle = useRef([]);

  useEffect(() => {
    const element = canvas.current;
    const density = Math.max(1, window.devicePixelRatio || 1);
    element.width = CHART_SIZE * density;
    element.height = CHART_SIZE * density;
    const context = element.getContext("2d");
    context.scale(density, density);
    const center = CHART_SIZE / 2;
    const radius = center - 1.5;
    const labels = [];
    let start = -Math.PI / 2;

    angle.current = rows.map((row, index) => {
      const end = start + row.share * TAU;
      if (row.share <= 0) return end;
      context.beginPath();
      context.moveTo(center, center);
      context.arc(center, center, radius, start, end);
      context.closePath();
      context.globalAlpha = active === null || active === index ? 1 : 0.55;
      context.fillStyle = row.color;
      context.fill();
      context.globalAlpha = 1;
      context.lineWidth = 3;
      context.strokeStyle = "#1a1a19";
      if (row.share < 1) context.stroke();
      const middle = (start + end) / 2;
      if (row.share >= 0.05) labels.push({ middle, share: row.share });
      start = end;
      return end;
    });

    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 18px Arial, sans-serif";
    for (const { middle, share } of labels) {
      context.fillText(
        Math.round(share * 100) + "%",
        center + Math.cos(middle) * 132,
        center + Math.sin(middle) * 132,
      );
    }
  }, [rows, active]);

  function move(event) {
    const rect = canvas.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    if (Math.hypot(x, y) > 0.5 || !rows.length) {
      onActive(null);
      return;
    }
    const fromTop = (Math.atan2(y, x) + Math.PI / 2 + TAU) % TAU - Math.PI / 2;
    const index = angle.current.findIndex((end) => fromTop < end);
    onActive(index < 0 ? null : index);
  }

  return (
    <canvas
      className="pie"
      ref={canvas}
      role="img"
      aria-label="流派占比饼图，详细比例见旁边的表格"
      onPointerMove={move}
      onPointerLeave={() => onActive(null)}
    />
  );
}

function detailText(row) {
  if (row.name === "蓝胖") {
    return row.details.map(({ name, count }) => name.replace(/蓝胖$/, "") + " " + count).join(" ・ ");
  }
  if (row.name === "其他") {
    const listed = row.details.filter(({ name }) => name !== "其他");
    return listed.length ? "含" + listed.map(({ name, count }) => name + " " + count).join("、") : "";
  }
  return row.details.map(({ name, count }) => name + " " + count).join("、");
}

function ThreeStarChart({ rows, active, onActive }) {
  return (
    <div className="three-star-chart" aria-label="各流派三星率">
      {rows.map((row, index) => {
        if (!Number.isFinite(row.threeStarRate)) return null;
        return (
          <div className={active === index ? "active-rate" : undefined} key={row.name}
            onPointerEnter={() => onActive(index)} onPointerLeave={() => onActive(null)}>
            <span>{row.name}</span><strong>{formatShare.format(row.threeStarRate)}</strong>
            <div className="rate-track" aria-hidden="true">
              <div style={{ width: `${Math.min(1, Math.max(0, row.threeStarRate)) * 100}%`, background: row.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Report({ report, reportRef, battleViews }) {
  const [active, setActive] = useState(null);
  const [metric, setMetric] = useState("usage");
  const personalOnly = battleViews?.personalOnly;
  const { groupTag, week, rows, total, notes, telemetry, source } = report;
  const hasRate = source === "api" && rows.some((row) => Number.isFinite(row.threeStarRate));
  const showRate = hasRate && metric === "rate";
  const displayRows = showRate
    ? [...rows].sort((left, right) => (right.threeStarRate ?? -1) - (left.threeStarRate ?? -1))
    : rows;
  const title = showRate ? "流派三星率" : "流派占比";
  const scope = source === "api" && telemetry?.expectedAttacks !== undefined
    ? "已获取阵容 " + formatNumber.format(total) + " / 组内已知进攻 "
      + formatNumber.format(telemetry.expectedAttacks) + " 场" : "";
  const recovered = telemetry?.recoveredFromDefense || 0;
  const failed = (telemetry?.groupLogFailures || 0) + (telemetry?.battleLogFailures || 0);

  return (
    <article ref={reportRef} className="report" aria-labelledby="report-title">
      <header className="report-header">
        <div className="report-heading-row">
          <h2 id="report-title">{groupTag ? "小组 " + groupTag + " " : ""}{week ? "本周" : ""}{title}</h2>
          {hasRate && <div className="metric-control" data-no-export="true" role="group" aria-label="统计指标">
            <button type="button" aria-pressed={!showRate} onClick={() => { setMetric("usage"); setActive(null); }}>使用率</button>
            <button type="button" aria-pressed={showRate} onClick={() => { setMetric("rate"); setActive(null); }}>三星率</button>
          </div>}
        </div>
        {!personalOnly && <p>
          {[
            week && week + " 周",
            "有阵容排位进攻 " + formatNumber.format(total) + " 场",
            rows.some(({ name }) => name === "蓝胖") && "天女 / 隐龙 / 其他蓝胖合并为「蓝胖」",
          ].filter(Boolean).join(" ・ ")}
        </p>}
      </header>
      <StandingSummary battleViews={battleViews} standing={battleViews?.standing} />
      <section className={rows.length ? "report-card" : "report-card empty-card"} aria-label="本周流派统计">
        {rows.length ? (
          <>
            {showRate ? <ThreeStarChart rows={displayRows} active={active} onActive={setActive} />
              : <div className="pie-cell"><Pie rows={displayRows} active={active} onActive={setActive} /></div>}
            <table className="report-table">
              <thead><tr><th scope="col">流派</th><th scope="col">{showRate ? "三星 / 有星数" : "场数"}</th><th scope="col" aria-sort="descending">{showRate ? "三星率" : "占比"} <span className="sort-indicator" aria-hidden="true">↓</span></th></tr></thead>
              <tbody>
                {displayRows.map((row, index) => {
                  const detail = detailText(row);
                  return (
                    <tr key={row.name} className={active === index ? "active-row" : ""}
                      onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)}>
                      <th scope="row">
                        <span className="row-name"><span className="color-key" style={{ background: row.color }} />{row.name}</span>
                        {detail && <small>{detail}</small>}
                      </th>
                      <td>{showRate ? (row.scoredCount > 0 ? `${formatNumber.format(row.threeStarCount)} / ${formatNumber.format(row.scoredCount)}` : "—") : formatNumber.format(row.count)}</td>
                      <td>{showRate ? (Number.isFinite(row.threeStarRate) ? formatShare.format(row.threeStarRate) : "—") : formatShare.format(row.share)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : <p>{personalOnly ? "传奇 I 使用排行榜，此段位没有周排位小组。可切换到进攻或防守查看个人战绩。" : "本次没有取得带阵容的排位进攻记录。"}</p>}
      </section>
      {!!(notes.length || scope) && (
        <div className="report-notes">
          {showRate && <p>三星率以本次获取到星数的场次为分母。</p>}
          {notes.length > 0 && <p>{notes.join(" ")}</p>}
          {scope && <p>{scope}{recovered > 0 && "，其中 " + formatNumber.format(recovered) + " 场由防守日志补齐"}。</p>}
          {failed > 0 && <p>{failed} 个日志请求失败。再次抓取可补充记录。</p>}
        </div>
      )}
    </article>
  );
}

const tags = ["meta", "standings", "attacks", "defenses"];
const sourceLabels = { sample: "截图示例", api: "官方 API" };
const initialAccounts = { accounts: [], selectedTag: "", hasDeveloperToken: false };

function BattleLog({ kind, battleViews, isSample, accountName }) {
  const offense = kind === "attacks";
  const mode = battleViews?.defenseTrophyMode;
  const lost = !offense && mode === "lost";
  const trophyLabel = offense ? "进攻得杯" : lost ? "防守扣杯" : mode === "mixed" ? "防守杯数变动" : "防守得杯";
  const label = offense ? "进攻" : "防守";
  const lineupLabel = offense ? "己方阵容" : "对手阵容";
  const rows = [...(battleViews?.[kind] ?? [])].sort((a, b) => (b.battleTimestamp || b.timestamp || "").localeCompare(a.battleTimestamp || a.timestamp || ""));
  const knownDestruction = rows.filter((row) => Number.isFinite(row.destruction));
  const threeStars = rows.reduce((count, row) => count + Number(row.stars === 3), 0);
  const average = knownDestruction.length
    ? (knownDestruction.reduce((sum, row) => sum + row.destruction, 0) / knownDestruction.length).toFixed(1) + "%"
    : "—";
  const partialDurations = rows.some((row) => !Number.isFinite(row.durationSeconds));
  const hasDuration = rows.some((row) => Number.isFinite(row.durationSeconds));

  return (
    <section className="battle-log" aria-labelledby="battle-title">
      <header className="report-header">
        <h2 id="battle-title">本周{label}记录</h2>
        {battleViews?.playerTag && <p>{[accountName || battleViews.playerName, battleViews.playerTag, "时间为北京时间"].filter(Boolean).join(" · ")}</p>}
      </header>
      <StandingSummary battleViews={battleViews} standing={battleViews?.standing} showPlayer={false} />
      {rows.length === 0 ? (
        <div className="empty-card">
          <p>{isSample ? "示例没有这类战绩。查询村庄后可查看个人战绩。" : "官方 API 本次未返回该村庄本周的" + label + "记录。"}</p>
        </div>
      ) : (
        <>
          <dl className="battle-summary">
            <div><dt>{label}场次</dt><dd>{formatNumber.format(rows.length)}</dd></div>
            <div><dt>{offense ? "三星场次" : "被三星场次"}</dt><dd>{formatNumber.format(threeStars)}</dd></div>
            <div><dt>{offense ? "平均摧毁率" : "对手平均摧毁率"}</dt><dd>{average}</dd></div>
          </dl>
          <div className="battle-card">
            <table className="battle-table personal-battle-table">
              <colgroup>
                <col className="battle-player-column" /><col className="battle-time-column" />
                <col className="battle-duration-column" /><col className="battle-result-column" span={2} />
                <col className="battle-trophy-column" /><col />
              </colgroup>
              <thead><tr>
                <th scope="col">{offense ? "防守方" : "进攻方"}</th>
                <th scope="col">对战时间</th><th scope="col">用时</th><th scope="col">星数</th><th scope="col">摧毁率</th>
                <th scope="col">{trophyLabel}</th><th scope="col" className="battle-army-cell">{lineupLabel}</th>
              </tr></thead>
              <tbody>
                {rows.map((row, index) => {
                  const showArmy = hasLineup(row.army);
                  const timestamp = row.battleTimestamp || row.timestamp;
                  const strategy = row.strategy || "已获取阵容";
                  const opponent = row.opponentName || row.opponentTag || "未知玩家";
                  return (
                    <tr key={row.id || index}>
                      <th scope="row">
                        <span className="battle-opponent-name" title={opponent}>{opponent}</span>
                        {row.opponentTag && row.opponentName && <small>{row.opponentTag}</small>}
                      </th>
                      <td><time dateTime={timestamp || undefined}>{formatTime(timestamp)}</time></td>
                      <td>{formatDuration(row.durationSeconds)}</td>
                      <td>{Number.isInteger(row.stars) && row.stars >= 0 && row.stars <= 3 ? (
                        <span className="stars" aria-label={`${row.stars} 星`}>
                          <span aria-hidden="true">{"★".repeat(row.stars)}</span><span className="star-empty" aria-hidden="true">{"☆".repeat(3 - row.stars)}</span>
                        </span>
                      ) : "—"}</td>
                      <td>{Number.isFinite(row.destruction) ? row.destruction + "%" : "—"}</td>
                      <td>{Number.isFinite(row.trophyDelta) ? <Trophy value={row.trophyDelta} /> : <Trophy value={row.trophies} loss={lost} />}</td>
                      <td className="battle-army-cell">{showArmy ? (
                        <div className="battle-army">
                          <span className="battle-army-strategy" title={strategy}>{strategy}</span>
                          <ArmyLineup army={row.army} label={lineupLabel} />
                        </div>
                      ) : <span className="missing-lineup">{row.strategy || (row.armyShareCode ? "阵容待解析" : "暂无阵容")}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.some((row) => hasLineup(row.army)) && <ArmyAttribution />}
          {rows.some((row) => row.strategy) && <p className="battle-note">流派根据公开阵容推断，实际打法可能不同。</p>}
          {partialDurations && <p className="battle-note">{hasDuration ? "部分对战的用时未由官方 API 提供。" : "本次战绩没有附单场用时。"}</p>}
        </>
      )}
    </section>
  );
}

function getErrorMessage(failure, secrets = []) {
  const message = String(failure?.message || "操作失败，请重试。");
  const clean = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  return secrets.filter(Boolean).reduce((text, secret) => text.replaceAll(secret, "[已隐藏]"), clean);
}

function normalizeTag(input, label, optional = false) {
  const tag = input.trim().replace(/^#/, "").toUpperCase();
  if (optional && !tag) return "";
  if (!/^[A-Z0-9]{2,20}$/.test(tag)) throw new Error(`请输入有效的${label}，例如 #2PP8QG。`);
  return "#" + tag;
}

export default function App() {
  const [payload, setPayload] = useState(null);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [accountLoading, setAccountLoading] = useState(true);
  const [tab, setTab] = useState("meta");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState(null);
  const reportRef = useRef(null);
  const working = useRef(false);
  const resultsByTag = useRef(new Map());

  const report = payload?.report;
  const battleViews = payload?.raw?.battleViews;
  const battleAccountName = accounts.accounts.find(({ tag }) => tag === battleViews?.playerTag)?.name;
  const tabLabels = {
    meta: "小组流派",
    standings: "排位排名",
    attacks: "进攻" + (battleViews?.attacks ? ` ${battleViews.attacks.length}` : ""),
    defenses: "防守" + (battleViews?.defenses ? ` ${battleViews.defenses.length}` : ""),
  };

  useEffect(() => {
    let active = true;
    async function loadAccounts() {
      try {
        const result = await window.cocApp.listAccounts();
        if (active) setAccounts(result);
      } catch (failure) {
        if (active) setFeedback({ message: getErrorMessage(failure), error: true });
      } finally {
        if (active) setAccountLoading(false);
      }
    }
    void loadAccounts();
    return () => { active = false; };
  }, []);

  async function run(message, action, secrets) {
    if (working.current) return false;
    working.current = true;
    setBusy(message);
    setFeedback(null);
    try {
      await action();
      return true;
    } catch (failure) {
      setFeedback({ message: getErrorMessage(failure, secrets), error: true });
      return false;
    } finally {
      working.current = false;
      setBusy("");
    }
  }

  function applyAccountState(result) {
    setAccounts(result);
    if (result.selectedTag !== accounts.selectedTag) setPayload(resultsByTag.current.get(result.selectedTag) ?? null);
  }

  async function collectFor(tag) {
    const result = await window.cocApp.collect({ playerTag: tag, token: "" });
    resultsByTag.current.set(tag, result);
    setPayload(result);
    setFeedback({ message: "已更新本周排位战报。" });
  }

  function collect() {
    void run("正在核对小组成员与本周对战记录…", async () => {
      await collectFor(accounts.selectedTag);
    });
  }

  function selectAccount(tag) {
    if (!tag || tag === accounts.selectedTag) return;
    void run(accounts.hasDeveloperToken ? "正在查询所选村庄的本周排位…" : "正在切换村庄…", async () => {
      const result = await window.cocApp.selectAccount(tag);
      applyAccountState(result);
      if (result.hasDeveloperToken && !resultsByTag.current.has(tag)) await collectFor(tag);
    });
  }

  function saveAccount({ tag, name, clanTag, gameToken, clearGameToken }) {
    const shortToken = gameToken.trim();
    return run("正在保存村庄…", async () => {
      const player = normalizeTag(tag, "村庄标签");
      const clan = normalizeTag(clanTag, "部落标签", true);
      const result = await window.cocApp.saveAccount({
        tag: player, name: name.trim(), clanTag: clan,
        ...(shortToken && { gameToken: shortToken }),
        ...(clearGameToken && { clearGameToken: true }),
      });
      applyAccountState(result);
      setFeedback({ message: "村庄已保存在本机。" });
    }, [shortToken]);
  }

  function removeAccount(tag) {
    return run("正在移除村庄…", async () => {
      const result = await window.cocApp.removeAccount(tag);
      resultsByTag.current.delete(tag);
      applyAccountState(result);
      setFeedback({ message: "已移除该村庄。" });
    });
  }

  function saveDeveloperToken(input) {
    const token = input.trim();
    return run(token ? "正在保存开发者令牌…" : "正在清除开发者令牌…", async () => {
      if (token && !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error("请输入从 Supercell 开发者后台获取的完整 JWT 令牌。");
      applyAccountState(await window.cocApp.saveDeveloperToken(token));
      setFeedback({ message: token ? "开发者 API 令牌已保存在本机。" : "已清除开发者 API 令牌。" });
    }, [token]);
  }

  function loadSample() {
    void run("正在加载示例…", async () => {
      setPayload(await window.cocApp.sample());
      setTab("meta");
    });
  }

  function exportExcel() {
    void run("正在保存 Excel…", async () => {
      const saved = await window.cocApp.downloadWorkbook(payload.raw);
      if (saved) setFeedback({ message: "已保存 Excel。" });
    });
  }

  function exportPng() {
    void run("正在生成图片…", async () => {
      await document.fonts.ready;
      const node = reportRef.current;
      if (!node) throw new Error("请先打开小组流派报表。");
      const blob = await toBlob(node, {
        backgroundColor: "#121315", pixelRatio: 2, skipFonts: true,
        width: node.offsetWidth + 56, height: node.offsetHeight + 56,
        style: { padding: "28px", boxSizing: "border-box" },
        filter: (element) => element.dataset?.noExport !== "true",
      });
      if (!blob) throw new Error("无法生成图片。");
      const filename = "COC-" + (report.groupTag || "report").replace(/[^a-z0-9-]/gi, "")
        + (report.week ? "-" + report.week : "") + ".png";
      const saved = await window.cocApp.saveImage(new Uint8Array(await blob.arrayBuffer()), filename);
      if (saved) setFeedback({ message: "已保存 PNG。" });
    });
  }

  function moveTab(event) {
    const index = tags.indexOf(tab);
    const next = {
      ArrowLeft: tags[(index - 1 + tags.length) % tags.length],
      ArrowRight: tags[(index + 1) % tags.length],
      Home: tags[0], End: tags[tags.length - 1],
    }[event.key];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById("tab-" + next).focus();
  }

  return (
    <main className="page">
      <header className="app-heading"><h1>部落冲突排位战报</h1></header>
      <AccountPanel accounts={accounts} busy={accountLoading || !!busy} onSelect={selectAccount}
        onSaveAccount={saveAccount} onRemoveAccount={removeAccount} onSaveDeveloperToken={saveDeveloperToken}
        onQuery={collect} onSample={loadSample} />
      <div className="app-feedback">
        <div className="feedback" role="status">{(accountLoading && "正在读取本机村庄…") || busy || (!feedback?.error && feedback?.message)}</div>
        {feedback?.error && <div className="feedback error" role="alert">{feedback.message}</div>}
      </div>
      <section className="results" aria-label="排位战报">
          <div className="results-bar">
            <div className="tabs" role="tablist" aria-label="查看排位战报">
              {tags.map((name) => (
                <button type="button" id={"tab-" + name} key={name} role="tab" aria-controls="report-panel"
                  aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
                  disabled={busy === "正在生成图片…"} onClick={() => setTab(name)} onKeyDown={moveTab}>{tabLabels[name]}</button>
              ))}
            </div>
            {report && <div className="export-actions">
              {sourceLabels[report.source] && <span className="source-label">{sourceLabels[report.source]}</span>}
              <button type="button" onClick={exportExcel} disabled={!!busy}>导出 Excel</button>
              {tab === "meta" && <button type="button" onClick={exportPng} disabled={!!busy}>保存图片</button>}
            </div>}
          </div>
          <div className="report-panel" id="report-panel" role="tabpanel" aria-labelledby={"tab-" + tab}>
            {report && tab === "meta" && <Report key={report.source + report.groupTag + report.week}
              report={report} reportRef={reportRef} battleViews={battleViews} />}
            {report && tab === "standings" && <Standings key={report.groupTag + report.week} rows={payload.raw?.standings ?? []} battleViews={battleViews}
              attacks={payload.raw?.attacks ?? report.attacks} classifiedAttacks={report.attacks}
              groupTag={report.groupTag} week={report.week} isSample={report.source === "sample"} />}
            {report && (tab === "attacks" || tab === "defenses") && <BattleLog key={battleViews?.playerTag + tab} kind={tab} battleViews={battleViews}
              isSample={report.source === "sample"} accountName={battleAccountName} />}
            {!report && <section className="empty-card empty-results" aria-label="暂无战报">
              <p>{busy ? "查询结果会显示在这里。" : accounts.selectedTag && accounts.hasDeveloperToken
                ? "点击「查询本周排位」获取当前村庄的战报。" : "添加村庄并设置开发者 API 令牌，即可查询本周排位。"}</p>
            </section>}
          </div>
      </section>
    </main>
  );
}
