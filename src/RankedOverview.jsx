import { useMemo } from "react";
import { formatTime } from "./battle-time.mjs";
import StrategyNetwork from "./StrategyNetwork.jsx";
import "./ranked-overview.css";

const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const netScore = new Intl.NumberFormat("zh-CN", { signDisplay: "exceptZero", maximumFractionDigits: 1 });
const count = new Intl.NumberFormat("zh-CN");

function bestPlayer(rows, metricsByTag, metric, sample) {
  return rows.map(player => ({ player, stats: metricsByTag.get(player.playerTag) }))
    .filter(({ stats }) => Number.isFinite(stats?.[metric]))
    .sort((a, b) => b.stats[metric] - a.stats[metric] || b.stats[sample] - a.stats[sample] || a.player.rank - b.player.rank)[0];
}

function Metric({ label, value, name, sample, onClick }) {
  const Element = onClick ? "button" : "div";
  return <Element className="overview-metric" {...(onClick ? { type: "button", onClick } : {})}>
    <span className="overview-metric-label">{label}</span>
    <strong>{value ?? "—"}</strong>
    {name && <span className="overview-winner">{name}{onClick && <span aria-hidden="true"> ↗</span>}</span>}
    {sample && <small>{sample}</small>}
  </Element>;
}

export default function RankedOverview({ rows, strategies, metricsByTag, board, waiting, pending, unavailable,
  accountLoading, enabled, onRefresh, onOpenVillages, onLookupPlayer, onOpenStrategies, scopeControl, limit = 200 }) {
  const byUsage = useMemo(() => strategies.toSorted((a, b) => b.scoredCount - a.scoredCount || b.playerCount - a.playerCount
    || a.strategy.localeCompare(b.strategy, "zh-CN")), [strategies]);
  const recognized = byUsage.reduce((total, entry) => total + entry.scoredCount, 0);
  const popular = byUsage[0];
  const stars = useMemo(() => bestPlayer(rows, metricsByTag, "threeStarRate", "attackCount"), [rows, metricsByTag]);
  const net = useMemo(() => bestPlayer(rows, metricsByTag, "averageDailyNet", "completedDays"), [rows, metricsByTag]);
  const fallback = board.data?.hasTierData === false;

  let status;
  if (accountLoading) status = "正在读取本机设置…";
  else if (!enabled) status = "查询全球榜需要开发者 API 令牌。";
  else if (board.status === "error") status = board.error;
  else if (waiting) status = "正在读取全球榜…";
  else if (!rows.length) status = "本次榜单没有成员。";
  else if (!pending && !unavailable && !popular && !stars && !net) status = "近两个联赛日暂无有效攻防记录。";

  return <section className="ranked-overview" aria-label="全球榜总览">
    <header className="overview-header"><div>
      <h2>{fallback ? "官方全球杯数榜" : "传奇 I · 全球榜"}</h2>
      <p>近两个联赛日{board.data && <>
        <span> · 榜单实收 {count.format(rows.length)} 人</span>
        <span> · 战报 {count.format(metricsByTag.size)} / {count.format(rows.length)} 人{pending ? "（收集中）" : ""}</span>
        {unavailable > 0 && <span> · {count.format(unavailable)} 人暂缺</span>}
      </>}{board.data?.fetchedAt && <><span> · </span><time dateTime={board.data.fetchedAt}>{formatTime(board.data.fetchedAt)}（北京时间）</time></>}</p>
    </div><div className="overview-tools">
      {scopeControl}
      {enabled && <button type="button" disabled={waiting} onClick={onRefresh}>刷新</button>}
    </div></header>
    {board.data && (board.data.paginationInterrupted || rows.length < limit) && <p className="overview-status" role="status">
      {board.data.paginationInterrupted ? "榜单分页中断，已保留取得的玩家，可点刷新重试。" : `当前接口结果仅有 ${count.format(rows.length)} 名可用玩家。`}
    </p>}
    {status && <div className="overview-status" role={board.status === "error" ? "alert" : "status"}>{status}
      {!accountLoading && !enabled && onOpenVillages && <button type="button" onClick={onOpenVillages}>管理村庄与令牌</button>}
    </div>}
    <div className="overview-readings">
        <Metric label="流派出场率最高" value={popular && percent.format(popular.scoredCount / recognized)}
          name={popular?.strategy} sample={popular && `${count.format(popular.scoredCount)} / ${count.format(recognized)} 场已识别进攻`}
          onClick={popular && onOpenStrategies} />
        <Metric label="玩家三星率最高" value={stars && percent.format(stars.stats.threeStarRate)}
          name={stars && (stars.player.playerName || stars.player.playerTag)}
          sample={stars && `${Math.round(stars.stats.attackCount * stars.stats.threeStarRate)} / ${stars.stats.attackCount} 场三星`}
          onClick={stars && onLookupPlayer && (() => onLookupPlayer(stars.player.playerTag))} />
        <Metric label="日均净杯最高" value={net && netScore.format(net.stats.averageDailyNet)}
          name={net && (net.player.playerName || net.player.playerTag)}
          sample={net && `杯/日 · ${net.stats.completedDays} 个完整联赛日`}
          onClick={net && onLookupPlayer && (() => onLookupPlayer(net.player.playerTag))} />
    </div>
    <div hidden={!rows.length}><StrategyNetwork rows={rows} strategies={byUsage} metricsByTag={metricsByTag}
      onLookupPlayer={onLookupPlayer} onOpenStrategies={onOpenStrategies} /></div>
    {!!byUsage.length && <section className="overview-styles" aria-label="常用流派对照">
      <header><h3>流派统计</h3><button type="button" onClick={onOpenStrategies}>流派排行 ↗</button></header>
      <table><thead><tr><th scope="col">流派</th><th scope="col">出场率</th><th scope="col">三星率</th><th scope="col">流派第一</th></tr></thead>
        <tbody>{byUsage.map(strategy => {
          const leader = strategy.topPlayers[0];
          return <tr key={strategy.strategy}>
            <th scope="row">{strategy.strategy}</th><td>{percent.format(strategy.scoredCount / recognized)}</td>
            <td>{percent.format(strategy.threeStarRate)}<small>{strategy.threeStarCount}/{strategy.scoredCount} 场</small></td>
            <td>{leader && <><button type="button" disabled={!onLookupPlayer}
              onClick={() => onLookupPlayer?.(leader.playerTag)}>{leader.playerName || leader.playerTag}</button>
              <small>{leader.threeStarCount}/{leader.scoredCount} 场三星</small></>}</td>
          </tr>;
        })}</tbody></table>
    </section>}
    {fallback && <p className="overview-footnote">接口未返回段位，显示官方全球杯数榜。</p>}
  </section>;
}
