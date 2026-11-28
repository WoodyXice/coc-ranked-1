import { useEffect, useRef, useState } from "react";
import { formatShortTime } from "./battle-time.mjs";
import "./saved-villages.css";

const developerKeyAddress = "developer.clashofclans.com/#/new-key";
const loadingIp = { status: "loading", ip: "" };

function DeveloperKeyHelp({ busy, lookupQueue }) {
  const api = globalThis.window?.cocApp;
  const canLookUp = typeof api?.getPublicIp === "function";
  const [lookup, setLookup] = useState(loadingIp);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState(null);
  const request = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!canLookUp) return;
    let active = true;
    if (!request.current) {
      const pending = lookupQueue.current.then(() => api.getPublicIp());
      request.current = pending;
      lookupQueue.current = pending.catch(() => {});
    }
    const pending = request.current;
    pending.then((result) => {
      const ip = typeof result?.ip === "string" ? result.ip.trim() : "";
      if (!ip) throw new Error("No public IP returned");
      if (active) setLookup({ status: "ready", ip });
    }).catch(() => {
      if (active) setLookup({ status: "error", ip: "" });
    }).finally(() => {
      if (request.current === pending) request.current = null;
    });
    return () => { active = false; };
  }, [api, attempt, canLookUp, lookupQueue]);

  function refresh() {
    if (!canLookUp || request.current) return;
    setLookup(loadingIp);
    setNotice(null);
    setAttempt((count) => count + 1);
  }

  async function openPortal() {
    setNotice(null);
    try {
      if (await api.openDeveloperPortal() === false) throw new Error("Browser did not open");
    } catch {
      if (mounted.current) setNotice({ text: "无法打开开发者后台。可复制上方地址到浏览器。", error: true });
    }
  }

  async function copyIp() {
    setNotice(null);
    try {
      if (typeof api?.copyPublicIp === "function") {
        if (await api.copyPublicIp(lookup.ip) === false) throw new Error("Clipboard unavailable");
      } else {
        await navigator.clipboard.writeText(lookup.ip);
      }
      if (mounted.current) setNotice({ text: "已复制公网出口 IP。" });
    } catch {
      if (mounted.current) setNotice({ text: "复制失败，可手动选中地址复制。", error: true });
    }
  }

  const status = canLookUp ? lookup.status : "unavailable";
  const ipStatus = {
    loading: "正在查询…",
    error: "查询失败，请重试。",
    unavailable: "请在桌面版查询。",
  }[status];

  return (
    <div className="developer-key-help">
      <div className="developer-key-row">
        <span>申请地址</span>
        {typeof api?.openDeveloperPortal === "function" ? (
          <button type="button" className="text-button developer-portal" title="在默认浏览器打开开发者后台"
            disabled={busy} onClick={() => void openPortal()}><code>{developerKeyAddress}</code></button>
        ) : <code>{developerKeyAddress}</code>}
      </div>
      <div className="developer-key-row">
        <span>本机公网出口 IP（参考）</span>
        <span className={status === "error" ? "developer-key-error" : undefined} role="status">
          {lookup.ip ? <code className="developer-ip-address">{lookup.ip}</code> : ipStatus}
        </span>
        <button type="button" disabled={busy || !lookup.ip} onClick={() => void copyIp()}>复制 IP</button>
        <button type="button" disabled={busy || !canLookUp || status === "loading"} onClick={refresh}>刷新 IP</button>
      </div>
      <p className="editor-help">创建密钥时，把上方 IP 填入 <strong>Allowed IP Addresses</strong>。如使用 VPN 分流，以官方 API 报错显示的 IP 为准。</p>
      {notice && <p className={"editor-help" + (notice.error ? " developer-key-error" : "")}
        role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    </div>
  );
}

export default function AccountPanel({ accounts, busy, hasReport, onSelect, onSaveAccount, onRemoveAccount, onSaveDeveloperToken,
  onQuery, onSample, history = [], onLookupPlayer }) {
  const [editor, setEditor] = useState(null);
  const [allRecent, setAllRecent] = useState(false);
  const ipLookupQueue = useRef(Promise.resolve());
  const savedTags = new Set(accounts.accounts.map((account) => account.tag));
  const recent = allRecent ? history : history.slice(0, 5);

  function editAccount(account, prefill) {
    setEditor({ type: "account", tag: account?.tag || prefill?.playerTag || "",
      name: account?.name ?? (prefill?.playerName !== prefill?.playerTag ? prefill?.playerName : "") ?? "",
      clanTag: account?.clanTag || "", gameToken: "", clearGameToken: false, existing: account });
  }

  function update(name) {
    return (event) => setEditor({ ...editor, [name]: event.target.value });
  }

  async function saveAccount(event) {
    event.preventDefault();
    const { tag, name, clanTag, gameToken, clearGameToken } = editor;
    if (await onSaveAccount({ tag, name, clanTag, gameToken, clearGameToken })) setEditor(null);
  }

  async function saveDeveloper(event) {
    event.preventDefault();
    if (await onSaveDeveloperToken(editor.token)) setEditor(null);
  }

  async function removeAccount() {
    if (await onRemoveAccount(editor.existing.tag)) setEditor(null);
  }

  return (
    <section className="query-card saved-villages" aria-labelledby="saved-villages-title">
      <header className="saved-villages-header">
        <h2 id="saved-villages-title">常用村庄</h2>
        <div className="account-actions">
          <button type="button" disabled={busy} onClick={onSample}>查看示例</button>
          <button type="button" disabled={busy} onClick={() => setEditor({ type: "developer", token: "" })}>
            {accounts.hasDeveloperToken ? "管理令牌" : "设置 API 令牌"}
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => editAccount()}>添加村庄</button>
        </div>
      </header>
      {editor?.type === "account" && (
        <form className="account-editor" key={editor.existing?.tag || "add"} onSubmit={saveAccount} autoComplete="off">
          <label htmlFor="edit-village-tag">村庄标签
            <input id="edit-village-tag" autoFocus required value={editor.tag} placeholder="#2PP8QG" maxLength={21}
              readOnly={!!editor.existing} onChange={update("tag")} spellCheck={false} />
          </label>
          <label htmlFor="edit-village-name">村庄名称或备注
            <input id="edit-village-name" value={editor.name} placeholder="例如：大号" maxLength={60} onChange={update("name")} />
          </label>
          <label htmlFor="edit-clan-tag">部落标签（选填）
            <input id="edit-clan-tag" value={editor.clanTag} placeholder="#部落标签" maxLength={21} onChange={update("clanTag")} spellCheck={false} />
          </label>
          <label className="account-game-token" htmlFor="game-token">游戏令牌（选填）
            <input id="game-token" type="password" autoComplete="off" value={editor.gameToken} maxLength={64}
              disabled={editor.clearGameToken} placeholder={editor.existing?.hasGameToken ? "已保存，留空保留" : "游戏设置里的短令牌"} onChange={update("gameToken")} />
          </label>
          <p className="editor-help">游戏令牌用于验证村庄归属，可选填并仅保存在本机。查询排位使用开发者 API 令牌。</p>
          {editor.existing?.hasGameToken && (
            <label className="check-label"><input type="checkbox" checked={editor.clearGameToken}
              onChange={(event) => setEditor({ ...editor, clearGameToken: event.target.checked, gameToken: "" })} />清除该村庄的游戏令牌</label>
          )}
          <div className="editor-actions">
            <button type="submit" className="primary" disabled={busy}>保存村庄</button>
            <button type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button>
            {editor.existing && <button type="button" className="danger" disabled={busy}
              onClick={() => setEditor({ type: "remove", existing: editor.existing })}>移除村庄</button>}
          </div>
        </form>
      )}
      {editor?.type === "remove" && (
        <div className="account-editor" role="group" aria-label="确认移除村庄">
          <p className="editor-help">从本机移除 {editor.existing.name || editor.existing.tag}（{editor.existing.tag}）及其保存的游戏令牌。</p>
          <div className="editor-actions">
            <button type="button" className="danger" disabled={busy} onClick={removeAccount}>确认移除</button>
            <button type="button" disabled={busy} onClick={() => editAccount(editor.existing)}>取消</button>
          </div>
        </div>
      )}
      {editor?.type === "developer" && (
        <form className="account-editor developer-editor" onSubmit={saveDeveloper} autoComplete="off">
          <label htmlFor="api-token">开发者 API 令牌
            <input id="api-token" autoFocus type="password" autoComplete="off" value={editor.token} required
              maxLength={4096} placeholder={accounts.hasDeveloperToken ? "粘贴新令牌以更换" : "粘贴开发者后台生成的 JWT"} onChange={update("token")} />
          </label>
          <div className="editor-actions">
            <button type="submit" className="primary" disabled={busy}>保存令牌</button>
            <button type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button>
            {accounts.hasDeveloperToken && <button type="button" className="danger" disabled={busy}
              onClick={() => setEditor({ type: "clear-developer" })}>清除令牌</button>}
          </div>
          <DeveloperKeyHelp busy={busy} lookupQueue={ipLookupQueue} />
        </form>
      )}
      {editor?.type === "clear-developer" && (
        <div className="account-editor" role="group" aria-label="确认清除令牌">
          <p className="editor-help">清除本机保存的开发者 API 令牌。</p>
          <div className="editor-actions">
            <button type="button" className="danger" disabled={busy}
              onClick={async () => { if (await onSaveDeveloperToken("")) setEditor(null); }}>确认清除</button>
            <button type="button" disabled={busy} onClick={() => setEditor({ type: "developer", token: "" })}>取消</button>
          </div>
        </div>
      )}
      {accounts.accounts.length > 0 ? <ul className="village-list" aria-label="已保存村庄">
        {accounts.accounts.map((account) => {
          const current = account.tag === accounts.selectedTag;
          return <li key={account.tag}>
            <button className="village-open" type="button" disabled={busy} onClick={() => onSelect(account.tag)}>
              <span className="village-identity"><strong>{account.name || account.tag}</strong>
                {account.name && account.name !== account.tag && <small>{account.tag}</small>}</span>
              {current && <span className="current-village-label">当前</span>}
              {account.clanTag && <small>部落 {account.clanTag}</small>}
            </button>
            <div className="village-actions">
              {current && <button type="button" disabled={busy || !accounts.hasDeveloperToken} onClick={onQuery}>
                {hasReport ? "更新本周排位" : "查询本周排位"}</button>}
              <button type="button" disabled={busy} onClick={() => editAccount(account)}
                aria-label={`编辑村庄 ${account.name || account.tag}`}>编辑</button>
            </div>
          </li>;
        })}
      </ul> : <p className="village-empty">暂无常用村庄</p>}
      {history.length > 0 && <section className="saved-history" aria-labelledby="recent-villages-title">
        <header className="saved-villages-header"><h3 id="recent-villages-title">最近查询</h3>
          {history.length > 5 && <button className="text-button" type="button" aria-expanded={allRecent}
            onClick={() => setAllRecent(!allRecent)}>{allRecent ? "收起" : `查看全部（${history.length}）`}</button>}
        </header>
        <ul className="village-list">{recent.map((entry) => {
          const saved = savedTags.has(entry.playerTag);
          return <li key={entry.playerTag}>
            <button type="button" className="village-open" disabled={busy || (!saved && !accounts.hasDeveloperToken)}
              onClick={() => saved ? onSelect(entry.playerTag) : onLookupPlayer(entry.playerTag)}>
              <span className="village-identity"><strong>{entry.playerName || entry.playerTag}</strong>
                {entry.playerName && entry.playerName !== entry.playerTag && <small>{entry.playerTag}</small>}</span>
            </button>
            {entry.lastQueriedAt && <time dateTime={entry.lastQueriedAt}>{formatShortTime(entry.lastQueriedAt)}</time>}
            {!saved && <button className="village-save" type="button" disabled={busy}
              onClick={() => editAccount(null, entry)}>加入常用</button>}
          </li>;
        })}</ul>
      </section>}
    </section>
  );
}
