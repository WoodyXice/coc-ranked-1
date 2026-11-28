export const releasePage = "https://github.com/fangjog/coc-ranked/releases/latest";
const releaseTagPath = "/fangjog/coc-ranked/releases/tag/v";
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

async function latestInstaller(updater, installedVersion) {
  const result = await updater.checkForUpdates();
  if (!result || typeof result.isUpdateAvailable !== "boolean") throw new Error("Missing release information");
  if (!result.isUpdateAvailable) return null;
  const info = result.updateInfo;
  if (!stableVersion.test(info?.version) || !stableVersion.test(installedVersion)
    || !isNewerVersion(info.version, installedVersion)) throw new Error("Invalid stable release");
  return info;
}

// A release asset can be replaced under the same tag. Compare the manifest used for the download.
function installerIdentity(info) {
  return JSON.stringify([info.version, info.files, info.path, info.sha512]);
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

  function fail(operation, message = failureMessages[operation]) {
    return change("error", { failedOperation: operation, progress: null, message });
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
        const response = await fetchImpl(releasePage, {
          cache: "no-store",
          credentials: "omit",
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        });
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) return fail("check");
        const destination = new URL(location, releasePage);
        if (destination.origin !== "https://github.com" || destination.username || destination.password
          || !destination.pathname.startsWith(releaseTagPath)) return fail("check");
        const version = destination.pathname.slice(releaseTagPath.length);
        if (!stableVersion.test(version) || !stableVersion.test(state.currentVersion)) return fail("check");
        return isNewerVersion(version, state.currentVersion) ? change("available", {
          availableVersion: version, message: "发现新版本，可在 GitHub 发布页下载新的便携版。",
        }) : change("current");
      }
      const info = await latestInstaller(await getUpdater(), state.currentVersion);
      return info ? change("available", { availableVersion: info.version }) : change("current");
    } catch {
      return fail("check");
    }
  }

  async function applyLatest(operation) {
    if (mode !== "installed") return state;
    const install = operation === "install";
    const retry = state.status === "error" && state.failedOperation === operation;
    if (state.status !== (install ? "downloaded" : "available") && !retry) return state;

    const checking = { progress: null, message: "正在确认 GitHub 最新正式版…" };
    let failure = failureMessages.check;
    change("checking", checking);
    try {
      const updater = await getUpdater();
      let target = await latestInstaller(updater, state.currentVersion);
      while (target) {
        failure = failureMessages.download;
        change("downloading", { availableVersion: target.version, progress: 0, message: "正在准备最新版本的安装包…" });
        // electron-updater validates its pending installer against the selected manifest and reuses matching files.
        const files = await updater.downloadUpdate();
        if (!Array.isArray(files) || !files.length) return fail(operation, failure);
        if (!install) return change("downloaded", { progress: 100 });

        failure = failureMessages.check;
        change("checking", checking);
        const latest = await latestInstaller(updater, state.currentVersion);
        if (latest && installerIdentity(latest) === installerIdentity(target)) {
          failure = failureMessages.install;
          change("installing", { progress: null });
          updater.quitAndInstall(false, true);
          return state;
        }
        target = latest;
      }
      return change("current", { availableVersion: null, progress: null });
    } catch {
      return fail(operation, failure);
    }
  }

  return {
    getUpdateState: () => state, checkForUpdates,
    downloadUpdate: () => applyLatest("download"),
    installUpdate: () => applyLatest("install"),
  };
}
