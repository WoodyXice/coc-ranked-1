import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createUpdater } from "../desktop/updater.mjs";

const app = { isPackaged: true, getVersion: () => "1.4.9" };
const release = (tag_name, flags = {}) => ({ tag_name, draft: false, prerelease: false, ...flags });

function portableUpdater(fetchImpl, options = {}) {
  return createUpdater({
    app, platform: "win32", portable: true, publish() {},
    loadUpdater: async () => assert.fail("portable mode must not load the installer updater"),
    fetchImpl, ...options,
  });
}

test("portable checks public release metadata and offers a newer numeric version without downloading", async () => {
  const published = [];
  let requests = 0;
  let respond;
  const response = new Promise((resolve) => { respond = resolve; });
  const updater = portableUpdater((url, { headers, redirect, signal }) => {
    requests += 1;
    assert.equal(url, "https://api.github.com/repos/fangjog/coc-ranked/releases/latest");
    assert.equal(headers.Accept, "application/vnd.github+json");
    assert.equal(headers.Authorization, undefined);
    assert.equal(redirect, "error");
    assert.ok(signal instanceof AbortSignal);
    return response;
  }, { publish: (state) => published.push(state.status) });

  const pending = updater.checkForUpdates();
  assert.equal((await updater.checkForUpdates()).status, "checking");
  respond(Response.json(release("v1.4.10")));
  assert.equal((await pending).availableVersion, "1.4.10");
  assert.equal((await updater.downloadUpdate()).status, "available");
  assert.equal((await updater.installUpdate()).status, "available");
  assert.deepEqual(published, ["checking", "available"]);
  assert.equal(requests, 1);
});

test("portable handles equal or older releases, invalid metadata, and a retry after network failure", async () => {
  const responses = [
    Response.json(release("v1.4.9")),
    Response.json(release("v1.4.8")),
    Response.json(release("v1.4.10-rc.1")),
    Response.json(release("v1.4.10", { prerelease: true })),
    Response.json(release("v1.4.10", { draft: true })),
    new Response(null, { status: 429 }),
    new DOMException("timeout", "TimeoutError"),
    Response.json(release("v2.0.0")),
  ];
  const updater = portableUpdater(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  for (const status of ["current", "current", "error", "error", "error", "error", "error", "available"]) {
    const state = await updater.checkForUpdates();
    assert.equal(state.status, status);
    assert.equal(state.availableVersion, status === "available" ? "2.0.0" : null);
    assert.equal(state.failedOperation, status === "error" ? "check" : null);
  }
});

test("development and non-Windows modes leave updates available through the manual page only", async () => {
  const fetchImpl = () => assert.fail("manual-only mode must not request releases");
  const development = portableUpdater(fetchImpl, { app: { ...app, isPackaged: false } });
  const unsupported = portableUpdater(fetchImpl, { platform: "linux" });
  assert.equal((await development.checkForUpdates()).status, "development");
  assert.equal((await unsupported.checkForUpdates()).status, "unsupported");
});

test("the installed updater still downloads and installs only on separate actions", async () => {
  const operations = [];
  const nativeUpdater = Object.assign(new EventEmitter(), {
    async checkForUpdates() {
      operations.push("check");
      return { isUpdateAvailable: true, updateInfo: { version: "1.4.10" } };
    },
    async downloadUpdate() {
      operations.push("download");
      return ["fixture.exe"];
    },
    quitAndInstall() { operations.push("install"); },
  });
  const updater = createUpdater({ app, platform: "win32", portable: false, publish() {},
    loadUpdater: async () => nativeUpdater, fetchImpl: () => assert.fail("installed mode must use electron-updater") });
  assert.equal((await updater.checkForUpdates()).status, "available");
  assert.deepEqual(operations, ["check"]);
  assert.equal(nativeUpdater.autoDownload, false);
  assert.equal(nativeUpdater.autoInstallOnAppQuit, false);
  assert.equal((await updater.downloadUpdate()).status, "downloaded");
  assert.deepEqual(operations, ["check", "download"]);
  assert.equal((await updater.installUpdate()).status, "installing");
  assert.deepEqual(operations, ["check", "download", "install"]);
});
