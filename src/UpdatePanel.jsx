import { useEffect, useRef, useState } from "react";

const actionByStatus = {
  idle: ["checkForUpdates", "检查更新"],
  current: ["checkForUpdates", "重新检查"],
  available: ["downloadUpdate", "下载更新"],
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
  if (!version) return "";
  return version.startsWith("v") ? version : "v" + version;
}

export default function UpdatePanel({ busy }) {
  const api = globalThis.window?.cocApp;
  const [state, setState] = useState(null);
  const [pending, setPending] = useState("");
  const [feedback, setFeedback] = useState("");
  const revision = useRef(0);
  const actionPending = useRef(false);

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

  if (!api?.getUpdateState) return null;

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

  const status = pending === "checkForUpdates" ? "checking"
    : pending === "downloadUpdate" ? "downloading"
      : pending === "installUpdate" ? "installing"
        : state?.status ?? (feedback ? "error" : undefined);
  const version = versionLabel(state?.currentVersion);
  const nextVersion = versionLabel(state?.availableVersion);
  const hasUpdate = ["available", "downloading", "downloaded", "installing"].includes(status)
    || (status === "error" && !!nextVersion && state?.failedOperation !== "check");
  const progress = status === "downloading" && Number.isFinite(state?.progress)
    ? Math.min(100, Math.max(0, state.progress)) : undefined;
  const feedbackText = status === state?.status && state?.message ? state.message
    : statusText[status] ?? (feedback ? "" : "正在读取更新状态…");
  const canOpenReleases = typeof api.openReleasePage === "function"
    && ["unsupported", "development", "error"].includes(status);
  const [action, actionLabel] = status === "error"
    ? retryByOperation[state?.failedOperation] ?? retryByOperation.check
    : actionByStatus[status] ?? [];
  const busyInstalling = action === "installUpdate" && busy;

  return (
    <details className="update-panel">
      <summary className={hasUpdate ? "update-trigger update-trigger-available" : "update-trigger"}>
        {hasUpdate ? "有新版本" : "软件更新"}{version && <span>{version}</span>}
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
              onClick={() => void run("openReleasePage")}>打开 GitHub 发布页</button>}
          </div>
        )}
      </section>
    </details>
  );
}
