import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage, session } from "electron";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getReport } from "../analytics.mjs";
import { workbookBytes } from "../files.mjs";
import { collectData, sampleReport } from "./service.mjs";
import { createAccountStore, validateDeveloperToken } from "./accounts.mjs";
import { createDefenseNoteStore } from "./defense-notes.mjs";

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

function createWindow() {
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
  const snapshotDir = resolve(app.getPath("userData"), "ranked-snapshots");
  const accountStore = createAccountStore(resolve(app.getPath("userData"), "accounts.json"), safeStorage);
  const defenseNotes = createDefenseNoteStore(resolve(app.getPath("userData"), "defense-notes.json"));
  async function withDefenseNotes(payload) {
    const raw = payload.raw;
    if (!raw.battleViews) return payload;
    return { ...payload, raw: { ...raw, battleViews: await defenseNotes.withNotes(raw.battleViews) } };
  }
  bind(window, "coc:accounts", accountStore.list);
  bind(window, "coc:save-account", accountStore.saveAccount);
  bind(window, "coc:select-account", accountStore.selectAccount);
  bind(window, "coc:remove-account", accountStore.removeAccount);
  bind(window, "coc:save-developer-token", accountStore.saveDeveloperToken);
  bind(window, "coc:save-defense-note", defenseNotes.save);
  bind(window, "coc:sample", () => withDefenseNotes(sampleReport()));
  bind(window, "coc:collect", async (input) => {
    const token = validateDeveloperToken(input?.token) || await accountStore.getDeveloperToken();
    return withDefenseNotes(await collectData({ playerTag: input?.playerTag, token }, { snapshotDir }));
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
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
