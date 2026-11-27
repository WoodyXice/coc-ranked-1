export const releasePage = "https://github.com/fangjog/coc-ranked/releases/latest";
const latestReleaseApi = "https://api.github.com/repos/fangjog/coc-ranked/releases/latest";
const stableVersion = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

const messages = {
  idle: "可检查 GitHub 发布的新版本。",
  checking: "正在检查更新…",
  available: "发现新版本，可下载更新。",
  current: "当前已是最新版本。",
  downloading: "正在下载更新…",
  downloaded: "新版本已下载，可重启安装。",
  installing: "正在启动安装程序…",
  development: "开发运行模式不提供安装更新。",
  portable: "便携版请在 GitHub 发布页下载新的 EXE。",
  unsupported: "此版本请在 GitHub 发布页手动下载更新。",
};

const failureMessages = {
  check: "未能检查更新，请检查网络后重试。",
  download: "未能下载或校验更新，请重试。",
  install: "未能启动安装程序，请重试。",
};

async function loadElectronUpdater() {
  const { default: updaterPackage } = await import("electron-updater");
  return updaterPackage.autoUpdater;
}

function isNewerVersion(candidate, current) {
  const next = candidate.split(".").map(Number);
  const installed = current.split(".").map(Number);
  const firstDifference = next.findIndex((part, index) => part !== installed[index]);
  return firstDifference >= 0 && next[firstDifference] > installed[firstDifference];
}

export function createUpdater({
  app,
  publish,
  platform = process.platform,
  portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  loadUpdater = loadElectronUpdater,
  fetchImpl = globalThis.fetch,
}) {
  const mode = !app.isPackaged ? "development" : platform !== "win32" ? "unsupported" : portable ? "portable" : "installed";
  const status = mode === "installed" || mode === "portable" ? "idle" : mode === "development" ? "development" : "unsupported";
  let state = Object.freeze({
    mode, status, currentVersion: app.getVersion(), availableVersion: null, progress: null,
    failedOperation: null, message: messages[mode] || messages[status],
  });
  let loadingUpdater;

  function change(nextStatus, fields = {}) {
    state = Object.freeze({
      ...state, status: nextStatus, failedOperation: null, message: messages[nextStatus], ...fields,
    });
    publish(state);
    return state;
  }

  function fail(operation) {
    return change("error", { failedOperation: operation, progress: null, message: failureMessages[operation] });
  }

  function getUpdater() {
    if (!loadingUpdater) {
      loadingUpdater = loadUpdater().then((updater) => {
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        updater.autoRunAppAfterInstall = true;
        updater.allowPrerelease = false;
        updater.allowDowngrade = false;
        updater.disableWebInstaller = true;
        updater.logger = null;
        updater.on("download-progress", ({ percent }) => {
          if (state.status !== "downloading" || !Number.isFinite(percent)) return;
          const progress = Math.min(100, Math.max(0, Math.round(percent)));
          if (progress !== state.progress) change("downloading", { progress });
        });
        // Check/download errors also reject their awaited promises. Installation errors arrive by event.
        updater.on("error", () => { if (state.status === "installing") fail("install"); });
        return updater;
      }).catch((error) => {
        loadingUpdater = undefined;
        throw error;
      });
    }
    return loadingUpdater;
  }

  async function checkForUpdates() {
    if ((mode !== "installed" && mode !== "portable") || !["idle", "current", "available", "error"].includes(state.status)) return state;
    change("checking", { availableVersion: null, progress: null });
    try {
      if (mode === "portable") {
        const response = await fetchImpl(latestReleaseApi, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "COC-Ranked", "X-GitHub-Api-Version": "2026-03-10" },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return fail("check");
        const release = await response.json();
        const version = typeof release?.tag_name === "string" && release.tag_name.startsWith("v") ? release.tag_name.slice(1) : "";
        if (release?.draft !== false || release?.prerelease !== false
          || !stableVersion.test(version) || !stableVersion.test(state.currentVersion)) return fail("check");
        return isNewerVersion(version, state.currentVersion) ? change("available", {
          availableVersion: version, message: "发现新版本，可在 GitHub 发布页下载新的便携版。",
        }) : change("current");
      }
      const result = await (await getUpdater()).checkForUpdates();
      if (!result) return fail("check");
      if (!result.isUpdateAvailable) return change("current");
      const version = result.updateInfo?.version;
      if (typeof version !== "string" || !/^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(version)) return fail("check");
      return change("available", { availableVersion: version });
    } catch {
      return fail("check");
    }
  }

  async function downloadUpdate() {
    if (mode !== "installed") return state;
    const retry = state.status === "error" && state.failedOperation === "download";
    if (state.status !== "available" && !retry) return state;
    change("downloading", { progress: 0 });
    try {
      const files = await (await getUpdater()).downloadUpdate();
      return Array.isArray(files) && files.length > 0 ? change("downloaded", { progress: 100 }) : fail("download");
    } catch {
      return fail("download");
    }
  }

  async function installUpdate() {
    if (mode !== "installed") return state;
    const retry = state.status === "error" && state.failedOperation === "install";
    if (state.status !== "downloaded" && !retry) return state;
    change("installing", { progress: null });
    try {
      (await getUpdater()).quitAndInstall(false, true);
      return state;
    } catch {
      return fail("install");
    }
  }

  return { getUpdateState: () => state, checkForUpdates, downloadUpdate, installUpdate };
}
