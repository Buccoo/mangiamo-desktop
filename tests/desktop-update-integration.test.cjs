const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual compiled main-process updater and IPC actions without starting
// Electron, touching a real installation or connecting the printing worker.
function mainUpdater({ enabled = true } = {}) {
  const updater = new EventEmitter();
  const calls = { checks: 0, downloads: 0, installs: [], scheduled: [], feeds: [], paperQueries: [] };
  updater.setFeedURL = ({ url }) => calls.feeds.push(url);
  updater.checkForUpdates = async () => {
    calls.checks++;
    updater.emit('update-available', { version: '99.0.0' });
    return { updateInfo: { version: '99.0.0' } };
  };
  updater.downloadUpdate = async () => {
    calls.downloads++;
    updater.emit('update-downloaded', { version: '99.0.0' });
    return ['checksum-verified.exe'];
  };
  updater.quitAndInstall = (...args) => calls.installs.push(args);
  const main = fs.readFileSync(path.join(__dirname, '../electron-dist/main.cjs'), 'utf8');
  const boundary = main.indexOf('const gotLock =');
  assert.ok(boundary > 0, 'stop before application startup');
  const context = {
    module: { exports: {} }, __dirname, Buffer, URL, console,
    process: { argv: [], platform: 'win32', arch: 'x64', cwd: () => __dirname, resourcesPath: __dirname,
      env: { MANGIAMO_DESKTOP_ENABLE_AUTO_UPDATE: enabled ? '1' : '0', PUBLIC_APP_URL: 'https://manager.mangiamo.app' } },
    setTimeout: callback => calls.scheduled.push(callback),
    require(name) {
      if (name === 'electron') return { app: { isPackaged: true, getPath: () => __dirname } };
      if (name === 'electron-updater') return { autoUpdater: updater };
      if (name === './desktopUpdate.cjs') return require('../electron-dist/desktopUpdate.cjs');
      if (name === './printWorker.cjs') return {};
      if (name === './printerPaper.cjs') return { detectPrinterPaper: async (...args) => { calls.paperQueries.push(args); return { ok: true, paper: { width_mm: 80, printable_dots: 576, model: 'TM-T70II', source: 'escpos' } }; } };
      if (name === 'node:fs') return { existsSync: () => false, mkdirSync() {}, appendFileSync() {} };
      return require(name);
    },
  };
  vm.runInNewContext(main.slice(0, boundary) + `
    module.exports = { setupAutoUpdaterScaffold, checkForUpdatesWithFeedFallback,
      downloadFallbackInstallerAsset, installFallbackInstallerAsset,
      setWorker: worker => { printWorker = worker; },
      detectDesktopPrinterPaper: typeof detectDesktopPrinterPaper === "undefined" ? null : detectDesktopPrinterPaper, desktopUpdateActions: typeof desktopUpdateActions === "undefined" ? null : desktopUpdateActions };
  `, context);
  const api = context.module.exports;
  api.setupAutoUpdaterScaffold();
  return { api, updater, calls };
}

test('actual main process preserves a verified download across polling and forces silent relaunch', async () => {
  const { api, calls } = mainUpdater();
  await api.checkForUpdatesWithFeedFallback();
  assert.equal((await api.desktopUpdateActions.download()).ok, true);
  await api.checkForUpdatesWithFeedFallback();
  assert.equal(calls.checks, 1, 'no update-available event may invalidate the staged installer');
  api.desktopUpdateActions.install();
  calls.scheduled[0]();
  assert.deepEqual(calls.installs, [[true, true]]);
});

test('Windows fallback uses the verified native pipeline, including install and restart', async () => {
  const { api, calls } = mainUpdater();
  assert.equal((await api.downloadFallbackInstallerAsset()).ok, true);
  assert.equal(calls.downloads, 1);
  assert.equal((await api.installFallbackInstallerAsset()).ok, true);
  calls.scheduled[0]();
  assert.deepEqual(calls.installs, [[true, true]]);
});

test('temporary feed failure switches to the existing GitHub reserve without an unverified executable', async () => {
  const { api, updater, calls } = mainUpdater();
  const success = updater.checkForUpdates;
  updater.checkForUpdates = async () => {
    if (calls.feeds.length === 1) throw new Error('HTTP status 503');
    return success();
  };
  await api.checkForUpdatesWithFeedFallback();
  assert.equal(calls.feeds.length, 2);
  assert.match(calls.feeds[1], /^https:\/\/github.com\//);
});

test('the installed NSIS updater maps the request to replacement, silent install and force-run flags', () => {
  const { NsisUpdater } = require('electron-updater/out/NsisUpdater');
  const updater = Object.create(NsisUpdater.prototype);
  updater.downloadedUpdateHelper = { file: 'C:\\fixture\\verified.exe' };
  updater.installDirectory = 'C:\\fixture\\existing-install';
  let launched;
  updater.spawnLog = async (file, args) => { launched = { file, args }; };
  updater.dispatchError = error => { throw error; };
  assert.equal(updater.doInstall({ isSilent: true, isForceRunAfter: true, isAdminRightsRequired: false }), true);
  assert.deepEqual(launched, { file: 'C:\\fixture\\verified.exe',
    args: ['--updated', '/S', '--force-run', '/D=C:\\fixture\\existing-install'] });
});


test('verified downloads survive a subsequent native check', async () => {
  const { api, updater, calls } = mainUpdater();
  updater.emit('update-downloaded', { version: '99.0.0' });
  await api.checkForUpdatesWithFeedFallback();
  assert.equal(calls.checks, 0, 'polling must preserve verified updater metadata');
});


test('an in-flight metadata check cannot change feed once a transfer starts', async () => {
  const { api, updater, calls } = mainUpdater();
  let failCheck, finishDownload;
  updater.checkForUpdates = () => { if (++calls.checks > 1) return Promise.reject(new Error('HTTP status 503')); return new Promise((_, reject) => { failCheck = reject; }); };
  updater.downloadUpdate = () => new Promise(resolve => { finishDownload = resolve; });
  const check = api.checkForUpdatesWithFeedFallback();
  const transfer = api.desktopUpdateActions.download();
  failCheck(new Error('HTTP status 503'));
  await assert.rejects(check, /503/);
  assert.equal(calls.feeds.length, 1, 'provider must remain stable while downloading');
  if (finishDownload) finishDownload([]);
  await transfer;
});

test('Windows recovery respects disabled native updates', async () => {
  const { api, calls } = mainUpdater({ enabled: false });
  const result = await api.downloadFallbackInstallerAsset();
  assert.equal(result.reason, 'UPDATER_DISABLED');
  assert.equal(calls.downloads, 0);
});


test('main process blocks paper queries and installation during an active print job', async () => {
  const { api, updater, calls } = mainUpdater();
  api.setWorker({ getPublicState: () => ({ service: { processing: true } }) });
  updater.emit('update-downloaded', { version: '99.0.0' });
  assert.equal(api.desktopUpdateActions.install().reason, 'PRINT_JOBS_ACTIVE');
  assert.equal((await api.detectDesktopPrinterPaper({ host: '192.168.68.101', port: 9100 })).reason, 'PRINT_JOBS_ACTIVE');
  assert.equal(calls.paperQueries.length, 0);
  assert.equal(calls.scheduled.length, 0);
  api.setWorker({ getPublicState: () => ({ service: { processing: false } }) });
  const result = await api.detectDesktopPrinterPaper({ host: '192.168.68.101', port: 9100 });
  assert.equal(result.paper.printable_dots, 576);
  assert.deepEqual(calls.paperQueries, [['192.168.68.101', 9100]]);
});


test('download waits for a delayed successful metadata check before reading its provider', async () => {
  const { api, updater, calls } = mainUpdater();
  const pendingChecks = [];
  let provider = 'old-provider';
  updater.checkForUpdates = () => {
    calls.checks++;
    return new Promise(resolve => { pendingChecks.push(() => {
      provider = 'new-provider';
      updater.emit('update-available', { version: '100.0.0' });
      resolve({ updateInfo: { version: '100.0.0' } });
    }); });
  };
  updater.downloadUpdate = async () => {
    calls.downloads++;
    calls.downloadProvider = provider;
    updater.emit('update-downloaded', { version: '100.0.0' });
    return ['verified-new-provider.exe'];
  };
  const check = api.checkForUpdatesWithFeedFallback();
  const concurrentCheck = api.checkForUpdatesWithFeedFallback();
  const transfer = api.desktopUpdateActions.download();
  await Promise.resolve();
  const downloadsBeforeMetadata = calls.downloads;
  pendingChecks.forEach(finish => finish());
  await Promise.all([check, concurrentCheck]);
  const result = await transfer;
  assert.equal(downloadsBeforeMetadata, 0, 'transfer cannot read the old metadata/provider');
  assert.equal(calls.checks, 1, 'concurrent checks share one metadata operation');
  assert.equal(calls.downloadProvider, 'new-provider');
  assert.equal(result.ok, true);
  assert.equal(api.desktopUpdateActions.install().ok, true);
});

test('late availability events cannot invalidate verified download or installation', async () => {
  const { api, updater, calls } = mainUpdater();
  await api.checkForUpdatesWithFeedFallback();
  assert.equal((await api.desktopUpdateActions.download()).ok, true);
  updater.emit('update-available', { version: '101.0.0' });
  assert.equal(api.desktopUpdateActions.install().ok, true);
  updater.emit('update-not-available', { version: '1.0.0' });
  assert.equal(api.desktopUpdateActions.install().ok, true);
  assert.equal(calls.scheduled.length, 1);
  calls.scheduled[0]();
  assert.deepEqual(calls.installs, [[true, true]]);
});
