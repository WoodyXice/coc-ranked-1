import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, safeStorage, session, shell } from "electron";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getReport } from "../analytics.mjs";
import { fetchLegendLeaderboard, fetchLegendLocations } from "../collector.mjs";
import { workbookBytes } from "../files.mjs";
import { cachedReport, collectData, collectGroupedPlayer, collectTemporaryPlayer, developerPortal, getPublicIp, sampleReport } from "./service.mjs";
import { createAccountStore, importAccountsJson, validateDeveloperToken } from "./accounts.mjs";
import { openDatabase } from "./database.mjs";
import { createDefenseNoteStore } from "./defense-notes.mjs";
import { importLegacyJson } from "./legacy-import.mjs";
import { createUpdater, releasePage } from "./updater.mjs";

const rendererUrl = "coc-app://local/";
const rendererDir = fileURLToPath(new URL("../dist/renderer/", import.meta.url));
const preload = fileURLToPath(new URL("./preload.cjs", import.meta.url));
const icon = fileURLToPath(new URL("./ranked.ico", import.meta.url));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const localProfile = app.commandLine.getSwitchValue("user-data-dir")
  || resolve(app.getPath("appData"), "coc-ranked");
mkdirSync(localProfile, { recursive: true });
app.setPath("userData", localProfile);

protocol.registerSchemesAsPrivileged([
  { scheme: "coc-app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function rendererAsset(request) {
  try {
    const url = new URL(request.url);
    if (url.host !== "local" || request.method !== "GET") return new Response(null, { status: 404 });
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = resolve(rendererDir, requested);
    const fromRoot = relative(rendererDir, file);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(".." + sep) || isAbsolute(fromRoot)) {
      return new Response(null, { status: 404 });
    }
    return net.fetch(pathToFileURL(file).href);
  } catch {
    return new Response(null, { status: 404 });
  }
}

async function saveFile(window, bytes, name, extension, type) {
  const result = await dialog.showSaveDialog(window, {
    defaultPath: resolve(app.getPath("downloads"), name),
    filters: [{ name: type, extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, bytes);
  return true;
}

function savedReportTag(value) {
  const tag = typeof value === "string" ? value.trim().toUpperCase().replace(/^#/, "") : "";
  return /^[A-Z0-9]{2,20}$/.test(tag) ? "#" + tag : "";
}

function bind(window, channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame.url !== rendererUrl) return { ok: false, error: "请从排位助手窗口操作。" };
    try {
      return { ok: true, value: await handler(...args) };
    } catch (error) {
      const message = error?.code ? "操作失败，请检查保存位置和网络连接。" : error?.message;
      return { ok: false, error: message || "操作失败。" };
    }
  });
  window.once("closed", () => ipcMain.removeHandler(channel));
}

function createWindow(database, storageWarnings) {
  const window = new BrowserWindow({
    title: "部落冲突排位助手",
    icon,
    width: 1280,
    height: 900,
    minWidth: 700,
    minHeight: 560,
    show: false,
    backgroundColor: "#121315",
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const accountStore = createAccountStore(database, safeStorage);
  const defenseNotes = createDefenseNoteStore(database.db);
  let displayedReport = null;
  async function savedDeveloperToken() {
    const token = await accountStore.getDeveloperToken();
    if (!token) throw new Error("请先保存 Supercell 开发者 API 令牌。");
    return token;
  }
  const contents = window.webContents;
  const updates = createUpdater({ app, publish(state) {
    if (!contents.isDestroyed() && contents.mainFrame?.url === rendererUrl) {
      contents.send("coc:update-state-changed", state);
    }
  } });
  bind(window, "coc:update-state", updates.getUpdateState);
  bind(window, "coc:update-check", updates.checkForUpdates);
  bind(window, "coc:update-download", updates.downloadUpdate);
  bind(window, "coc:update-install", updates.installUpdate);
  bind(window, "coc:open-release-page", async () => {
    try {
      await shell.openExternal(releasePage);
      return true;
    } catch {
      return false;
    }
  });
  contents.once("did-finish-load", () => { void updates.checkForUpdates(); });
  async function withDefenseNotes(payload) {
    const raw = payload.raw;
    if (!raw.battleViews) return payload;
    return { ...payload, raw: { ...raw, battleViews: await defenseNotes.withNotes(raw.battleViews) } };
  }
  async function displayReport(payload) {
    const result = payload ? await withDefenseNotes(payload) : null;
    displayedReport = payload;
    return result;
  }
  bind(window, "coc:accounts", async () => {
    const accounts = await accountStore.list();
    return storageWarnings.length ? { ...accounts, storageWarnings } : accounts;
  });
  bind(window, "coc:save-account", accountStore.saveAccount);
  bind(window, "coc:select-account", accountStore.selectAccount);
  bind(window, "coc:remove-account", accountStore.removeAccount);
  bind(window, "coc:save-developer-token", accountStore.saveDeveloperToken);
  bind(window, "coc:public-ip", () => getPublicIp());
  bind(window, "coc:copy-public-ip", (ip) => {
    if (typeof ip !== "string" || !isIP(ip)) throw new Error("无效的 IP 地址。");
    clipboard.writeText(ip);
  });
  bind(window, "coc:open-developer-portal", async () => {
    try {
      await shell.openExternal(developerPortal);
    } catch {
      throw new Error("无法打开浏览器，请手动访问上方显示的官方地址。");
    }
  });
  bind(window, "coc:save-defense-note", defenseNotes.save);
  bind(window, "coc:sample", () => displayReport(sampleReport()));
  bind(window, "coc:collect", async (input) => {
    const token = validateDeveloperToken(input?.token) || await savedDeveloperToken();
    const result = await collectData({ playerTag: input?.playerTag, token }, { snapshots: database.snapshots });
    let fetchedAt = new Date().toISOString();
    const playerTag = savedReportTag(input?.playerTag);
    try {
      if (playerTag) fetchedAt = database.reports.save(playerTag, result.raw, fetchedAt);
    } catch (error) {
      console.warn(`Could not save the latest report: ${error?.message}`);
    }
    return displayReport({ ...result, fetchedAt });
  });
  bind(window, "coc:cached-report", async (tag) => {
    const playerTag = savedReportTag(tag);
    const saved = playerTag ? cachedReport(database.reports.load(playerTag)) : null;
    return displayReport(saved);
  });
  bind(window, "coc:legend-leaderboard", async (input) =>
    fetchLegendLeaderboard({ token: await savedDeveloperToken(), location: input?.location }));
  bind(window, "coc:legend-locations", async () => fetchLegendLocations({ token: await savedDeveloperToken() }));
  bind(window, "coc:temporary-player", async (input) => {
    const group = input?.group;
    if (!group) return collectTemporaryPlayer({ token: await savedDeveloperToken(), playerTag: input?.playerTag }, {
      playerHistory: database.playerHistory,
    });
    const raw = displayedReport?.raw;
    const fetchedAt = displayedReport?.fetchedAt;
    if (raw?.source !== "api" || raw.groupTag !== group.groupTag || raw.seasonId !== group.seasonId
      || raw.week !== group.week || fetchedAt !== group.fetchedAt) {
      throw new Error("正在查看的小组战报已切换，请返回排位排名重新打开。");
    }
    return collectGroupedPlayer({ raw, fetchedAt, playerTag: input.playerTag, snapshots: database.snapshots });
  });
  bind(window, "coc:workbook", async (raw) => {
    const report = getReport(raw);
    const noted = raw.battleViews ? { ...raw, battleViews: await defenseNotes.withNotes(raw.battleViews) } : raw;
    const bytes = await workbookBytes(report, noted);
    const tag = report.groupTag.replace(/[^a-z0-9]/gi, "");
    const name = ["COC", tag, report.week].filter(Boolean).join("-") + ".xlsx";
    return saveFile(window, Buffer.from(bytes), name, "xlsx", "Excel 工作簿");
  });
  bind(window, "coc:image", (value, suppliedName) => {
    const bytes = value instanceof Uint8Array ? Buffer.from(value) : Buffer.alloc(0);
    if (bytes.length > 30 * 1024 * 1024 || !bytes.subarray(0, 8).equals(pngSignature)) {
      throw new Error("导出的图片格式无效或超出大小限制。");
    }
    const suggested = typeof suppliedName === "string" ? basename(suppliedName) : "";
    const name = /^[\w\u3400-\u9fff-]+\.png$/i.test(suggested) ? suggested : "COC-排位流派.png";
    return saveFile(window, bytes, name, "png", "PNG 图片");
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => window.show());
  window.loadURL(rendererUrl).catch(() => {
    dialog.showErrorBox("部落冲突排位助手", "无法打开程序界面。请重新解压或启动软件。");
    app.quit();
  });
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(() => {
    protocol.handle("coc-app", rendererAsset);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    Menu.setApplicationMenu(null);
    const userData = app.getPath("userData");
    const databaseFile = resolve(userData, "coc-ranked.db");
    let database;
    const storageWarnings = [];
    try {
      database = openDatabase(databaseFile);
      const { from, to, backup } = database.migration;
      if (from !== to) console.info(`Database migrated v${from} -> v${to}${backup ? `, backup: ${backup}` : ""}`);
      storageWarnings.push(...(importLegacyJson(database, userData)?.warnings ?? []));
    } catch (error) {
      database?.close();
      dialog.showErrorBox("部落冲突排位助手", `无法打开本地数据库：${databaseFile}\n\n${error?.message ?? ""}`);
      app.quit();
      return;
    }
    try {
      storageWarnings.push(...(importAccountsJson(database, safeStorage, resolve(userData, "accounts.json"))?.warnings ?? []));
    } catch {
      storageWarnings.push("暂时无法导入旧版村庄和令牌。旧配置已保留，下次启动会重试。");
    }
    app.on("will-quit", () => database.close());
    createWindow(database, storageWarnings);
  });
  app.on("window-all-closed", () => app.quit());
}
