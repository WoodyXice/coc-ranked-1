const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).then((result) => {
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
}

contextBridge.exposeInMainWorld("cocApp", {
  collect: (input) => invoke("coc:collect", input),
  fetchLegendLeaderboard: (input) => invoke("coc:legend-leaderboard", input),
  fetchLegendLocations: () => invoke("coc:legend-locations"),
  fetchTemporaryPlayer: (input) => invoke("coc:temporary-player", input),
  getTemporaryQueryHistory: () => invoke("coc:temporary-query-history"),
  cachedReport: (tag) => invoke("coc:cached-report", tag),
  listAccounts: () => invoke("coc:accounts"),
  saveAccount: (input) => invoke("coc:save-account", input),
  selectAccount: (tag) => invoke("coc:select-account", tag),
  removeAccount: (tag) => invoke("coc:remove-account", tag),
  saveDeveloperToken: (token) => invoke("coc:save-developer-token", token),
  getPublicIp: () => invoke("coc:public-ip"),
  copyPublicIp: (ip) => invoke("coc:copy-public-ip", ip),
  openDeveloperPortal: () => invoke("coc:open-developer-portal"),
  saveDefenseNote: (input) => invoke("coc:save-defense-note", input),
  sample: () => invoke("coc:sample"),
  downloadWorkbook: (input) => invoke("coc:workbook", input),
  saveImage: (bytes, name) => invoke("coc:image", bytes, name),
  getUpdateState: () => invoke("coc:update-state"),
  checkForUpdates: () => invoke("coc:update-check"),
  downloadUpdate: () => invoke("coc:update-download"),
  installUpdate: () => invoke("coc:update-install"),
  openReleasePage: () => invoke("coc:open-release-page"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("coc:update-state-changed", listener);
    return () => ipcRenderer.removeListener("coc:update-state-changed", listener);
  },
});
