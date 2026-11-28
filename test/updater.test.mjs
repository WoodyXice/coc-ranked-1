import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createUpdater } from "../desktop/updater.mjs";

const app = { isPackaged: true, getVersion: () => "1.4.9" };
const release = (tag) => Response.redirect(`https://github.com/fangjog/coc-ranked/releases/tag/${tag}`, 302);

function portableUpdater(fetchImpl, options = {}) {
  return createUpdater({
    app, platform: "win32", portable: true, publish() {},
    loadUpdater: async () => assert.fail("portable mode must not load the installer updater"),
    fetchImpl, ...options,
  });
}

test("portable checks the public latest release link without following the redirect or downloading", async () => {
  const published = [];
  let requests = 0;
  let respond;
  const response = new Promise((resolve) => { respond = resolve; });
  const updater = portableUpdater((url, { cache, credentials, redirect, signal }) => {
    requests += 1;
    assert.equal(url, "https://github.com/fangjog/coc-ranked/releases/latest");
    assert.equal(cache, "no-store");
    assert.equal(credentials, "omit");
    assert.equal(redirect, "manual");
    assert.ok(signal instanceof AbortSignal);
    return response;
  }, { publish: (state) => published.push(state.status) });

  const pending = updater.checkForUpdates();
  assert.equal((await updater.checkForUpdates()).status, "checking");
  respond(release("v1.4.10"));
  assert.equal((await pending).availableVersion, "1.4.10");
  assert.equal((await updater.downloadUpdate()).status, "available");
  assert.equal((await updater.installUpdate()).status, "available");
  assert.deepEqual(published, ["checking", "available"]);
  assert.equal(requests, 1);
});

test("portable handles equal or older releases, invalid redirects, and a retry after network failure", async () => {
  const responses = [
    release("v1.4.9"),
    release("v1.4.8"),
    release("v1.4.10-rc.1"),
    Response.redirect("https://github.com/another/repository/releases/tag/v1.4.10", 302),
    Response.redirect("https://example.com/fangjog/coc-ranked/releases/tag/v1.4.10", 302),
    new Response(null, { status: 429 }),
    new DOMException("timeout", "TimeoutError"),
    new Response(null, { status: 302, headers: { Location: "/fangjog/coc-ranked/releases/tag/v2.0.0" } }),
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
  assert.deepEqual(operations, ["check", "check", "download"]);
  assert.equal((await updater.installUpdate()).status, "installing");
  assert.deepEqual(operations, ["check", "check", "download", "check", "download", "check", "install"]);
});

function installedFixture() {
  const state = { latest: "1.4.10", checksum: "first", cached: null, downloads: [], installs: [] };
  let selected;
  const native = Object.assign(new EventEmitter(), {
    async checkForUpdates() {
      if (state.checkError) throw new Error("offline");
      selected = { version: state.latest, files: [{ url: "setup.exe", sha512: state.checksum }] };
      return { isUpdateAvailable: Boolean(state.latest), updateInfo: selected };
    },
    async downloadUpdate() {
      const file = selected.version + "/" + selected.files[0].sha512;
      if (state.cached !== file) {
        await state.beforeDownload?.(file);
        state.downloads.push(file);
        state.cached = file;
      }
      return ["setup.exe"];
    },
    quitAndInstall() { state.installs.push(state.cached); },
  });
  const updater = createUpdater({
    app, platform: "win32", portable: false, publish() {}, loadUpdater: async () => native,
  });
  return { state, updater };
}

test("clicking an old notification downloads the latest release, and restart skips obsolete pending installers", async () => {
  const { state, updater } = installedFixture();
  assert.equal((await updater.checkForUpdates()).availableVersion, "1.4.10");
  state.latest = "1.6.0";
  assert.equal((await updater.downloadUpdate()).availableVersion, "1.6.0");
  state.latest = "2.0.0";
  state.beforeDownload = () => { state.latest = "2.1.0"; };
  assert.equal((await updater.installUpdate()).status, "installing");
  assert.deepEqual(state.downloads, ["1.6.0/first", "2.0.0/first", "2.1.0/first"]);
  assert.deepEqual(state.installs, ["2.1.0/first"]);
});

test("network failures while confirming a release or preparing its replacement keep restart retryable", async () => {
  const { state, updater } = installedFixture();
  await updater.checkForUpdates();
  await updater.downloadUpdate();
  state.checkError = true;
  assert.equal((await updater.installUpdate()).failedOperation, "install");
  state.checkError = false;
  state.latest = "1.5.0";
  state.beforeDownload = () => { throw new Error("download failed"); };
  assert.equal((await updater.installUpdate()).failedOperation, "install");
  assert.deepEqual(state.installs, []);
  state.latest = "1.6.0";
  state.beforeDownload = undefined;
  assert.equal((await updater.installUpdate()).status, "installing");
  assert.deepEqual(state.installs, ["1.6.0/first"]);
});

test("a withdrawn release cannot install from cache or download from a stale notification", async () => {
  const { state, updater } = installedFixture();
  await updater.checkForUpdates();
  state.latest = null;
  assert.equal((await updater.downloadUpdate()).status, "current");
  assert.deepEqual(state.downloads, []);
  state.latest = "1.6.0";
  await updater.checkForUpdates();
  await updater.downloadUpdate();
  state.latest = null;
  const result = await updater.installUpdate();
  assert.equal(result.status, "current");
  assert.equal(result.availableVersion, null);
  assert.deepEqual(state.installs, []);
});

test("concurrent restart requests install once, using the final checksum even if the tag is unchanged", async () => {
  const { state, updater } = installedFixture();
  await updater.checkForUpdates();
  await updater.downloadUpdate();
  state.checksum = "second";
  let downloading;
  const started = new Promise((resolve) => { downloading = resolve; });
  let resume;
  const wait = new Promise((resolve) => { resume = resolve; });
  state.beforeDownload = async () => {
    downloading();
    await wait;
    state.checksum = "third";
  };
  const first = updater.installUpdate();
  await started;
  assert.equal((await updater.installUpdate()).status, "downloading");
  assert.equal((await updater.checkForUpdates()).status, "downloading");
  resume();
  assert.equal((await first).status, "installing");
  assert.deepEqual(state.installs, ["1.4.10/third"]);
});
