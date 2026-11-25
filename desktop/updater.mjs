export const releasePage = "https://github.com/fangjog/coc-ranked/releases/latest";

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

export function createUpdater({
  app,
  publish,
  platform = process.platform,
  portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  loadUpdater = loadElectronUpdater,
}) {
  const mode = !app.isPackaged ? "development" : platform !== "win32" ? "unsupported" : portable ? "portable" : "installed";
  const status = mode === "installed" ? "idle" : mode === "development" ? "development" : "unsupported";
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
    if (mode !== "installed" || !["idle", "current", "available", "error"].includes(state.status)) return state;
    change("checking", { availableVersion: null, progress: null });
    try {
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
