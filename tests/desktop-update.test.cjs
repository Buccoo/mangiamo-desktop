const assert = require('node:assert/strict');
const test = require('node:test');
const { createDesktopUpdateActions } = require('../electron-dist/desktopUpdate.cjs');

function fixture(overrides = {}) {
  let downloaded = false;
  const calls = { downloads: 0, installs: [], errors: [], scheduled: [] };
  const actions = createDesktopUpdateActions({
    enabled: () => true,
    downloaded: () => downloaded,
    download: async () => { calls.downloads++; downloaded = true; return ['verified.exe']; },
    install: (...args) => calls.installs.push(args),
    schedule: (callback) => calls.scheduled.push(callback),
    onError: (error) => calls.errors.push(error),
    ...overrides,
  });
  return { actions, calls, confirmDownload: () => { downloaded = true; } };
}

test('install waits for a verified download and never closes an unready app', () => {
  const f = fixture();
  assert.deepEqual(f.actions.install(), { ok: false, reason: 'UPDATE_NOT_DOWNLOADED' });
  assert.equal(f.calls.scheduled.length, 0);
});

test('one click schedules a silent replacement and forces relaunch; repeated clicks do not spawn installers', async () => {
  const f = fixture();
  assert.equal((await f.actions.download()).ok, true);
  assert.equal(f.actions.install().ok, true);
  assert.equal(f.actions.install().ok, true);
  assert.equal(f.calls.scheduled.length, 1);
  assert.deepEqual(f.calls.installs, []);
  f.calls.scheduled[0]();
  assert.deepEqual(f.calls.installs, [[true, true]]);
});

test('a resolved download promise alone is not evidence that an update is ready', async () => {
  const f = fixture({ download: async () => ['unconfirmed.exe'] });
  assert.equal((await f.actions.download()).ok, false);
  assert.equal(f.actions.install().ok, false);
});

test('concurrent download requests share one transfer and confirmed updates are reused', async () => {
  let complete;
  const f = fixture({ download: () => { f.calls.downloads++; return new Promise(r => { complete = r; }); } });
  const first = f.actions.download();
  const second = f.actions.download();
  assert.equal(f.calls.downloads, 1);
  f.confirmDownload(); complete(['verified.exe']);
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal((await f.actions.download()).ok, true);
  assert.equal(f.calls.downloads, 1);
});

test('download errors release the transfer lock for an explicit retry', async () => {
  let attempts = 0;
  const f = fixture({ download: async () => { if (++attempts === 1) throw new Error('offline'); f.confirmDownload(); return ['verified.exe']; } });
  assert.match((await f.actions.download()).error, /offline/);
  assert.equal((await f.actions.download()).ok, true);
});

test('install errors are visible and the operator can retry', () => {
  const f = fixture({ install: () => { throw new Error('installer unavailable'); } });
  f.confirmDownload(); f.actions.install(); f.calls.scheduled[0]();
  assert.equal(f.calls.errors.length, 1);
  assert.equal(f.actions.install().ok, true);
  assert.equal(f.calls.scheduled.length, 2);
});

test('disabled updater cannot download or install', async () => {
  const f = fixture({ enabled: () => false });
  f.confirmDownload();
  assert.equal((await f.actions.download()).ok, false);
  assert.equal(f.actions.install().ok, false);
  assert.equal(f.calls.downloads, 0);
  assert.equal(f.calls.scheduled.length, 0);
});


test('active print work blocks replacement until the worker is idle', () => {
  let active = true;
  const f = fixture({ canInstall: () => !active });
  f.confirmDownload();
  assert.deepEqual(f.actions.install(), { ok: false, reason: 'PRINT_JOBS_ACTIVE' });
  assert.equal(f.calls.scheduled.length, 0);
  active = false;
  assert.equal(f.actions.install().ok, true);
  f.calls.scheduled[0]();
  assert.deepEqual(f.calls.installs, [[true, true]]);
});

test('printing begun after acknowledgement prevents the scheduled install and allows retry', () => {
  let active = false;
  const f = fixture({ canInstall: () => !active });
  f.confirmDownload();
  f.actions.install();
  active = true;
  f.calls.scheduled[0]();
  assert.deepEqual(f.calls.installs, []);
  assert.match(f.calls.errors[0].message, /PRINT_JOBS_ACTIVE/);
  active = false;
  assert.equal(f.actions.install().ok, true);
});

test('an updater error cancels stale scheduled installs before a retry', () => {
  const f = fixture();
  f.confirmDownload();
  f.actions.install();
  f.actions.resetInstall();
  f.actions.install();
  f.calls.scheduled[0]();
  f.calls.scheduled[1]();
  assert.deepEqual(f.calls.installs, [[true, true]]);
});
