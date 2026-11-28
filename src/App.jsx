import { useEffect, useRef, useState } from "react";
import AccountPanel from "./AccountPanel.jsx";
import LegendLeaderboard from "./LegendLeaderboard.jsx";
import ReportDialog from "./ReportDialog.jsx";
import TemporaryPlayer, { TemporaryPlayerSearch, useTemporaryPlayerLookup } from "./TemporaryPlayer.jsx";
import UpdatePanel from "./UpdatePanel.jsx";
import VillageReport from "./VillageReport.jsx";

const sections = { overview: "总览", villages: "常用村庄", global: "全球榜", regional: "地区榜" };
const emptyAccounts = { accounts: [], selectedTag: "", hasDeveloperToken: false };

function errorMessage(error, secrets = []) {
  const message = String(error?.message || "操作失败，请重试。").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  return secrets.filter(Boolean).reduce((text, secret) => text.replaceAll(secret, "[已隐藏]"), message);
}
function normalizeTag(input, label, optional = false) {
  const tag = input.trim().replace(/^#/, "").toUpperCase();
  if (optional && !tag) return "";
  if (!/^[A-Z0-9]{2,20}$/.test(tag)) throw new Error(`请输入有效的${label}，例如 #2PP8QG。`);
  return "#" + tag;
}
function Feedback({ busy, feedback }) {
  return <div className="app-feedback">
    {feedback?.error ? <div className="feedback error" role="alert">{feedback.message}</div>
      : <div className="feedback" role="status">{busy || feedback?.message}</div>}
  </div>;
}

export default function App() {
  const [page, setPage] = useState("overview");
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState(emptyAccounts);
  const [accountLoading, setAccountLoading] = useState(true);
  const [cached, setCached] = useState(null);
  const [tokenRevision, setTokenRevision] = useState(0);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState(null);
  const working = useRef(false);
  const nextId = useRef(0);
  const navigation = useRef(0);
  const pending = useRef(null);
  const top = entries.at(-1);
  const canLookup = accounts.hasDeveloperToken && !accountLoading;
  const lookup = useTemporaryPlayerLookup({ enabled: canLookup, tokenRevision });

  async function readCached(tag) {
    if (!tag) return null;
    try { return await window.cocApp.cachedReport(tag); } catch { return null; }
  }
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const result = await window.cocApp.listAccounts();
        const saved = await readCached(result.selectedTag);
        if (active) { setAccounts(result); setCached(saved); }
      } catch (error) {
        if (active) setFeedback({ message: errorMessage(error), error: true });
      } finally { if (active) setAccountLoading(false); }
    }
    void init();
    return () => { active = false; };
  }, []);

  function startNavigation(keepLookup = false) {
    if (!keepLookup) lookup.dismiss();
    pending.current = null;
    navigation.current += 1;
    setFeedback(null);
    return navigation.current;
  }
  function newEntry(info) {
    return { ...info, id: ++nextId.current, parentId: top?.id, trigger: document.activeElement };
  }
  function choosePage(next) {
    startNavigation();
    setEntries([]);
    setPage(next);
  }
  function back() {
    startNavigation();
    setEntries(list => list.slice(0, -1));
  }
  function closeDialog() {
    startNavigation();
    setEntries([]);
  }
  function openPlayer(tag, group) {
    const item = newEntry({ tag, kind: "player" });
    if (lookup.query(tag, group)) {
      startNavigation(true);
      pending.current = item;
    }
  }
  useEffect(() => {
    const item = pending.current;
    if (!item || (!lookup.result && !lookup.error)) return;
    pending.current = null;
    if (lookup.error) return;
    const result = lookup.result;
    setEntries(list => [...list, { ...item, result, name: result.battleViews.playerName }]);
  }, [lookup.result, lookup.error]);

  async function run(message, action, success, secrets = []) {
    if (working.current) return false;
    working.current = true;
    setBusy(message);
    setFeedback(null);
    try {
      const result = await action();
      if (success && result !== false && result !== null) setFeedback({ message: success });
      return true;
    } catch (error) {
      setFeedback({ message: errorMessage(error, secrets), error: true });
      return false;
    } finally {
      working.current = false;
      setBusy("");
    }
  }

  async function applyAccounts(result) {
    setAccounts({ ...result, storageWarnings: accounts.storageWarnings });
    if (result.selectedTag === accounts.selectedTag) return cached;
    setCached(null);
    const saved = await readCached(result.selectedTag);
    setCached(saved);
    return saved;
  }
  function openSaved(tag, refresh = false) {
    if (working.current || !tag) return;
    const revision = startNavigation();
    const item = newEntry({ kind: "saved", tag, name: accounts.accounts.find(a => a.tag === tag)?.name });
    void run(refresh ? "正在更新本周排位…" : "正在读取村庄战报…", async () => {
      let payload = cached;
      if (tag !== accounts.selectedTag) payload = await applyAccounts(await window.cocApp.selectAccount(tag));
      let failure;
      if (canLookup && (!payload || refresh)) {
        try {
          setBusy("正在查询本周排位…");
          payload = await window.cocApp.collect({ playerTag: tag, token: "" });
          setCached(payload);
        } catch (error) {
          failure = error;
        }
      }
      if (revision !== navigation.current) return;
      setEntries(list => {
        const updated = list.map(frame => frame.kind === "saved" && frame.tag === tag ? { ...frame, payload } : frame);
        return updated.at(-1)?.kind === "saved" && updated.at(-1).tag === tag ? updated : [...updated, { ...item, payload }];
      });
      if (failure) throw failure;
    });
  }
  function openSample() {
    const revision = startNavigation();
    const entry = newEntry({ kind: "sample", name: "示例村庄" });
    void run("正在加载示例…", async () => {
      const payload = await window.cocApp.sample();
      if (revision === navigation.current) setEntries(list => [...list, { ...entry, payload }]);
    });
  }
  function saveAccount({ tag, name, clanTag, gameToken, clearGameToken }) {
    const short = gameToken.trim();
    return run("正在保存村庄…", async () => {
      const result = await window.cocApp.saveAccount({ tag: normalizeTag(tag, "村庄标签"), name: name.trim(),
        clanTag: normalizeTag(clanTag, "部落标签", true), ...(short && { gameToken: short }), ...(clearGameToken && { clearGameToken: true }) });
      await applyAccounts(result);
    }, "已保存村庄。", [short]);
  }
  function removeAccount(tag) {
    return run("正在移除村庄…", async () => { await applyAccounts(await window.cocApp.removeAccount(tag)); }, "已移除村庄。");
  }
  function saveDeveloperToken(input) {
    const token = input.trim();
    return run("正在保存开发者令牌…", async () => {
      if (token && !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error("请输入从 Supercell 开发者后台获取的完整 JWT 令牌。");
      await applyAccounts(await window.cocApp.saveDeveloperToken(token));
      setTokenRevision(revision => revision + 1);
    }, token ? "已保存开发者 API 令牌。" : "已清除开发者 API 令牌。", [token]);
  }

  const search = <TemporaryPlayerSearch lookup={lookup} accounts={accounts} disabled={accountLoading || !!busy}
    onLookupPlayer={openPlayer} onSelectSaved={openSaved} onManageVillages={() => choosePage("villages")} />;
  const status = <Feedback busy={busy} feedback={feedback}/>;
  const battles = cached?.raw?.battleViews;
  const selectedStanding = battles?.personalOnly && battles.playerTag === accounts.selectedTag
    ? { rank: battles.currentLegendRank, trophies: battles.currentLegendTrophies } : null;
  return <main className="page workspace">
    <header className="workspace-header">
      <h1>排位助手</h1>
      <nav className="workspace-nav" aria-label="主导航">
        {Object.entries(sections).map(([key, label]) => <button type="button" key={key} aria-current={page === key ? "page" : undefined}
          onClick={() => choosePage(key)}>{label}</button>)}
      </nav>
      <div className="workspace-tools"><UpdatePanel busy={!!busy}/>{!top && search}</div>
    </header>
    {accounts.storageWarnings?.length > 0 && <div className="feedback error" role="alert">{accounts.storageWarnings.join(" ")}</div>}
    {!top && status}
    <div className="workspace-content">
      {page === "villages" && <AccountPanel accounts={accounts} busy={accountLoading || !!busy} hasReport={!!cached?.fetchedAt}
        onSelect={openSaved} onSaveAccount={saveAccount} onRemoveAccount={removeAccount} onSaveDeveloperToken={saveDeveloperToken}
        history={lookup.history} onLookupPlayer={openPlayer} onQuery={() => openSaved(accounts.selectedTag, true)} onSample={openSample}/>}
      {["global","regional"].map(scope => {
        const visible = page === scope || (scope === "global" && page === "overview");
        return <div key={scope + tokenRevision} hidden={!visible}>
          <LegendLeaderboard scope={scope} active={visible && !top} overview={scope === "global" && page === "overview"}
            hasDeveloperToken={accounts.hasDeveloperToken} accountLoading={accountLoading} selectedTag={accounts.selectedTag}
            selectedStanding={selectedStanding} onLookupPlayer={openPlayer} onOpenGlobal={() => choosePage("global")}
            onOpenVillages={() => choosePage("villages")}/>
        </div>;
      })}
    </div>
    <ReportDialog entries={entries} onBack={back} onClose={closeDialog} search={top && search} feedback={top && status}>
      {entry => entry.kind === "player" ? <TemporaryPlayer lookup={{ result: entry.result }} onLookupPlayer={canLookup ? openPlayer : undefined}
        onOpenLegend={canLookup ? () => choosePage("global") : undefined}/> :
        <VillageReport entry={entry} busy={!!busy} run={run} onManage={() => choosePage("villages")} onOpenLegend={() => choosePage("global")}
          onRefresh={entry.kind === "saved" && canLookup ? () => openSaved(entry.tag, true) : undefined}
          onLookupPlayer={openPlayer}/>}
    </ReportDialog>
  </main>;
}
