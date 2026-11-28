import { useEffect, useId, useRef, useState } from "react";
import "./update-notice.css";

const announcedVersions = new Set();

const actionByStatus = {
  idle: ["checkForUpdates", "检查更新"],
  current: ["checkForUpdates", "重新检查"],
  downloaded: ["installUpdate", "重启并安装"],
};

const retryByOperation = {
  check: ["checkForUpdates", "重新检查"],
  download: ["downloadUpdate", "重新下载"],
  install: ["installUpdate", "重试安装"],
};

const statusText = {
  idle: "",
  checking: "正在检查 GitHub 发布版本…",
  available: "可以下载新版本。",
  current: "已是最新版本。",
  downloading: "正在下载更新…",
  downloaded: "更新已下载。安装会关闭并重新打开软件。",
  installing: "正在重启并安装更新…",
  unsupported: "此版本可从 GitHub 发布页手动更新。",
  development: "开发模式下可查看 GitHub 发布版本。",
  error: "更新未完成，请重试。",
};

function versionLabel(version) {
  if (typeof version !== "string" || !version) return "";
  return version.startsWith("v") ? version : "v" + version;
}

export default function UpdatePanel({ busy }) {
  const api = globalThis.window?.cocApp;
  const [state, setState] = useState(null);
  const [pending, setPending] = useState("");
  const [feedback, setFeedback] = useState("");
  const revision = useRef(0);
  const actionPending = useRef(false);
  const updatePanel = useRef(null);
  const updateTrigger = useRef(null);
  const notice = useRef(null);
  const previousFocus = useRef(null);
  const noticeId = useId();

  useEffect(() => {
    if (!api?.getUpdateState) return;
    let active = true;
    const initialRevision = revision.current;
    const unsubscribe = api.onUpdateState?.((value) => {
      if (!active) return;
      revision.current += 1;
      setState(value);
    });
    api.getUpdateState().then((value) => {
      if (active && revision.current === initialRevision) setState(value);
    }).catch(() => {
      if (active && revision.current === initialRevision) setFeedback("暂时无法读取更新状态。");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [api]);

  async function run(action) {
    if (actionPending.current || typeof api[action] !== "function") return;
    actionPending.current = true;
    setPending(action);
    setFeedback("");
    const before = revision.current;
    try {
      const next = await api[action]();
      if (action === "openReleasePage") {
        if (next === false) setFeedback("无法打开 GitHub 发布页。");
      } else if (next && revision.current === before) {
        setState(next);
      }
    } catch {
      if (action === "openReleasePage") setFeedback("无法打开 GitHub 发布页。");
      else if (revision.current === before) setFeedback("更新操作未完成，请重试。");
    } finally {
      actionPending.current = false;
      setPending("");
    }
  }

  const status = state?.status ?? (feedback ? "error" : undefined);
  const version = versionLabel(state?.currentVersion);
  const nextVersion = versionLabel(state?.availableVersion);
  const hasUpdate = ["available", "downloading", "downloaded", "installing"].includes(status)
    || (status === "error" && !!nextVersion && state?.failedOperation !== "check");
  const progress = status === "downloading" && Number.isFinite(state?.progress)
    ? Math.min(100, Math.max(0, state.progress)) : undefined;
  const feedbackText = status === state?.status && state?.message ? state.message
    : statusText[status] ?? (feedback ? "" : "正在读取更新状态…");
  const portable = state?.mode === "portable";
  const releaseButtonLabel = portable ? "打开下载页" : "打开 GitHub 发布页";
  const offerAction = portable ? "openReleasePage" : "downloadUpdate";
  const offerLabel = portable ? releaseButtonLabel : "下载更新";
  const canOpenReleases = typeof api?.openReleasePage === "function"
    && (portable ? status !== "available" : ["unsupported", "development", "error"].includes(status));
  const [action, actionLabel] = status === "error"
    ? retryByOperation[state?.failedOperation] ?? retryByOperation.check
    : status === "available" ? [offerAction, offerLabel] : actionByStatus[status] ?? [];
  const busyInstalling = action === "installUpdate" && busy;
  const canOfferUpdate = status === "available" && Boolean(nextVersion) && typeof api?.[offerAction] === "function";

  useEffect(() => {
    const dialog = notice.current;
    if (typeof dialog?.showModal !== "function") return;
    if (!canOfferUpdate) {
      if (dialog.open) dialog.close();
      return;
    }
    if (announcedVersions.has(nextVersion)) return;
    if (!dialog.open) {
      previousFocus.current = document.activeElement;
      dialog.returnValue = "";
      dialog.showModal();
    }
    announcedVersions.add(nextVersion);
  }, [canOfferUpdate, nextVersion]);

  function closeNotice(event) {
    if (event.currentTarget.open) return;
    const previous = previousFocus.current;
    previousFocus.current = null;
    const target = event.currentTarget.returnValue !== "action" && previous?.isConnected && previous !== document.body
      ? previous : updateTrigger.current;
    target?.focus({ preventScroll: true });
  }

  function runNoticeAction() {
    if (!canOfferUpdate || actionPending.current) return;
    if (updatePanel.current) updatePanel.current.open = true;
    notice.current?.close("action");
    void run(offerAction);
  }

  if (!api?.getUpdateState) return null;

  return (
    <>
      <details className="update-panel" ref={updatePanel}>
        <summary ref={updateTrigger} className={hasUpdate ? "update-trigger update-trigger-available" : "update-trigger"}
          aria-label={["软件更新", version, hasUpdate && "有新版本"].filter(Boolean).join("，")} title="软件更新">
          {version || "版本信息"}{hasUpdate && <span>有新版本</span>}
        </summary>
        <section className="update-card" aria-label="软件更新">
          {nextVersion && hasUpdate && <p className="update-version">新版本 <strong>{nextVersion}</strong></p>}
          <p className="update-status" role="status">{feedbackText}</p>
          {status === "downloading" && (
            <div className="update-progress">
              <progress max={100} value={progress} aria-label="下载更新进度" />
              {progress !== undefined && <span>{Math.round(progress)}%</span>}
            </div>
          )}
          {feedback && <p className="update-error" role="alert">{feedback}</p>}
          {(action || canOpenReleases) && (
            <div className="update-actions">
              {action && <button type="button" className={hasUpdate ? "primary" : undefined}
                title={busyInstalling ? "请等当前查询或保存完成。" : undefined}
                disabled={!!pending || busyInstalling || typeof api[action] !== "function"}
                onClick={() => void run(action)}>{actionLabel}</button>}
              {canOpenReleases && <button type="button" disabled={!!pending}
                onClick={() => void run("openReleasePage")}>{releaseButtonLabel}</button>}
            </div>
          )}
        </section>
      </details>
      <dialog className="update-notice" ref={notice} aria-labelledby={`${noticeId}-title`}
        aria-describedby={`${noticeId}-version`} onClose={closeNotice}>
        <h2 id={`${noticeId}-title`}>有新版本！</h2>
        <p id={`${noticeId}-version`}>可下载 <strong>{nextVersion}</strong></p>
        <div className="update-actions">
          <button type="button" onClick={() => notice.current?.close("later")}>稍后</button>
          <button type="button" className="primary" disabled={!canOfferUpdate} onClick={runNoticeAction}>{offerLabel}</button>
        </div>
      </dialog>
    </>
  );
}
