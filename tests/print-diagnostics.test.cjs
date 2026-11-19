const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PrintDiagnostics, sanitizeDiagnosticDetails, classifyDiagnosticError } = require('../electron-dist/printDiagnostics.cjs');
const { DesktopPrintWorker } = require('../electron-dist/printWorker.cjs');
const { PrintNotSentError } = require('../electron-dist/printDelivery.cjs');

const A = { restaurantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', agentId: 'test-bridge' };
const B = { restaurantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', agentId: 'test-bridge' };
const JOB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'print-diagnostics-'));
  const filename = path.join(directory, 'events.json');
  const create = overrides => new PrintDiagnostics({ filename, appVersion: '1.5.65', uploadIntervalMs: 3600000, healthIntervalMs: 3600000, ...options, ...overrides });
  const d = create();
  const instances = [d];
  t.after(async () => {
    await Promise.all(instances.map(instance => instance.shutdown(100)));
    await fs.rm(directory, { force: true, recursive: true });
  });
  await d.start();
  return { d, filename, directory, reboot: async () => { const next = create(); instances.push(next); await next.start(); return next; } };
}
function abandon(d) { for (const timer of d.timers) clearInterval(timer); d.closed = true; }

test('sanitizer uses the exact whitelist and never exports arbitrary content', () => {
  const details = sanitizeDiagnosticDetails({ job_id: JOB, queue: 'kitchen', host: 'printer.local', port: 9100, duration_ms: 123,
    error_code: 'ECONNREFUSED', phase: 'transport', service_state: 'running', last_poll_at: '2026-11-19T10:00:00.000Z',
    last_success_at: 'not a time', payload: { order: 'private' }, message: 'Bearer SECRET', token: 'SECRET', name: 'customer', dropped_count: -1 });
  assert.deepEqual(details, { job_id: JOB, queue: 'kitchen', host: 'printer.local', port: 9100, duration_ms: 123,
    error_code: 'ECONNREFUSED', phase: 'transport', service_state: 'running', last_poll_at: '2026-11-19T10:00:00.000Z' });
  assert.deepEqual(sanitizeDiagnosticDetails({ host: 'https://user:secret@example.com/path', port: 0, duration_ms: 86400001, error_code: 'token=secret' }), {});
  assert.deepEqual(sanitizeDiagnosticDetails({ host: '999.999.999.999' }), {});
  assert.deepEqual(sanitizeDiagnosticDetails({ host: '01.2.3.4' }), {});
  assert.equal(classifyDiagnosticError(new Error('private body SECRET'), 'ack'), 'ACK_FAILED');
  assert.equal(classifyDiagnosticError({ code: 'ECONNREFUSED', message: 'secret credentials' }), 'ECONNREFUSED');
  assert.equal(classifyDiagnosticError(new PrintNotSentError('connect ETIMEDOUT 192.168.1.55:9100 (target 192.168.1.55:9100)')), 'ETIMEDOUT');
  assert.equal(classifyDiagnosticError(new PrintNotSentError('connect ECONNREFUSED customer secret (target private)')), 'ECONNREFUSED');
  const full = sanitizeDiagnosticDetails({ ...details, host: 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61), error_code: 'X'.repeat(64), dropped_count: 1000000000, last_success_at: '2026-11-19T10:00:00.000Z' });
  assert.ok(Buffer.byteLength(JSON.stringify(full)) <= 440);
});

test('missing tenant/user/agent cannot upload; stopped health waits for a complete authenticated scope', async t => {
  const { d } = await fixture(t);
  let calls = 0;
  const upload = async () => { calls++; return { accepted_ids: [] }; };
  d.record('poll_error', { error_code: 'NETWORK_ERROR' }, 'error');
  d.setScope({ restaurantId: A.restaurantId, agentId: A.agentId }, upload);
  await d.flush();
  assert.equal(calls, 0);
  d.setScope(A, upload);
  await d.flush();
  assert.equal(calls, 1);
  assert.ok(d.events.some(row => row.event.event_type === 'app_start'));
  assert.ok(d.events.every(row => row.scope.userId === A.userId));
});

test('offline events survive restart; lost acknowledgement retries the same IDs and server deduplicates', async t => {
  const { d, reboot } = await fixture(t);
  const server = new Set();
  const attempts = [];
  d.setScope(A, async (_scope, events) => {
    attempts.push(events.map(event => event.id));
    for (const event of events) server.add(event.id);
    throw new Error('response lost after server commit');
  });
  d.record('job_error', { job_id: JOB, queue: 'kitchen', error_code: 'TIMEOUT', phase: 'transport' }, 'error');
  await d.persistWithin();
  await d.flush();
  const originals = [...server];
  assert.ok(originals.length >= 3);
  abandon(d);
  const restored = await reboot();
  restored.setScope(A, async (_scope, events) => {
    attempts.push(events.map(event => event.id));
    for (const event of events) server.add(event.id);
    return { accepted_ids: events.map(event => event.id) };
  });
  await restored.flush();
  assert.ok(originals.every(id => attempts[1].includes(id)));
  assert.equal(restored.events.filter(row => row.scope.restaurantId === A.restaurantId).length, 0);
  const size = server.size;
  await restored.flush();
  assert.equal(server.size, size);
});

test('uploads serialize, timeout and abort; partial accepted_ids remove only the actual batch IDs', async t => {
  const { d } = await fixture(t, { uploadTimeoutMs: 15 });
  let calls = 0, signal;
  d.setScope(A, async (_scope, _events, receivedSignal) => { calls++; signal = receivedSignal; return new Promise(() => {}); });
  const first = d.flush();
  assert.equal(d.flush(), first);
  await first;
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  const ids = d.events.map(row => row.event.id);
  d.setScope(A, async () => ({ accepted_ids: [ids[0], JOB] }));
  await d.flush();
  assert.equal(d.events.length, ids.length - 1);
  assert.ok(!d.events.some(row => row.event.id === ids[0]));
});

test('logout and account/tenant/agent transitions abort old uploads without moving offline events', async t => {
  const { d } = await fixture(t);
  let finish, oldSignal;
  d.setScope(A, async (_scope, events, signal) => { oldSignal = signal; return new Promise(resolve => { finish = () => resolve({ accepted_ids: events.map(event => event.id) }); }); });
  d.record('service_start', { phase: 'service', service_state: 'running' });
  const pending = d.flush();
  await Promise.resolve();
  d.setScope(null);
  await pending;
  assert.equal(oldSignal.aborted, true);
  finish();
  let sentB;
  d.setScope(B, async (scope, events) => { sentB = { scope, events }; return { accepted_ids: events.map(event => event.id) }; });
  d.record('health', { service_state: 'stopped' });
  await d.flush();
  assert.deepEqual(sentB.scope, B);
  assert.deepEqual(sentB.events.map(event => event.event_type), ['health']);
  assert.ok(d.events.length > 0);
  assert.ok(d.events.every(row => row.scope.restaurantId === A.restaurantId));
  const sentA = [];
  d.setScope(A, async (_scope, events) => { sentA.push(...events); return { accepted_ids: events.map(event => event.id) }; });
  await d.flush();
  assert.ok(sentA.some(event => event.event_type === 'service_start'));
});

test('14-day retention, volume/byte bounds, batch limits and local drop reporting', async t => {
  let now = Date.now();
  const { d, filename } = await fixture(t, { maxEvents: 50, maxBytes: 16384, now: () => now });
  d.setScope(A);
  for (let i = 0; i < 100; i++) d.record('job_claim', { job_id: JOB, queue: 'kitchen' });
  d.recordHealth();
  await d.persistWithin();
  const disk = JSON.parse(await fs.readFile(filename, 'utf8'));
  assert.ok(disk.events.length <= 50);
  assert.ok((await fs.stat(filename)).size <= 16384);
  assert.ok(disk.events.some(row => row.event.event_type === 'diagnostics_dropped'));
  now += 15 * 86400000;
  d.setScope(A, async (_scope, events) => { assert.ok(events.length <= 50); assert.ok(events.every(event => Date.parse(event.occurred_at) > now - 14 * 86400000)); return { accepted_ids: [] }; });
  d.recordHealth();
  await d.flush();
  assert.ok(d.events.length <= 2);
});

test('clean shutdown marker and unknown unclean exit are truthful', async t => {
  const { d, reboot } = await fixture(t);
  d.setScope(A);
  await d.persistWithin();
  abandon(d);
  const unclean = await reboot();
  const event = unclean.events.find(row => row.event.event_type === 'unclean_exit').event;
  assert.equal(event.details.error_code, 'UNCLEAN_EXIT_UNKNOWN');
  assert.equal(JSON.stringify(event).includes('crash'), false);
  unclean.setScope(A, async (_scope, events) => ({ accepted_ids: events.map(event => event.id) }));
  await unclean.flush();
  await unclean.shutdown();
  const clean = await reboot();
  assert.equal(clean.events.some(row => row.event.event_type === 'unclean_exit'), false);
  assert.ok(clean.events.some(row => row.event.event_type === 'app_stop'));
});

test('corrupt/unwritable/hung diagnostic disk never blocks enqueue, printing or bounded shutdown', async t => {
  const { directory } = await fixture(t);
  const corrupt = path.join(directory, 'corrupt.json');
  await fs.writeFile(corrupt, '{broken json');
  const d = new PrintDiagnostics({ filename: corrupt, appVersion: '1.5.65' });
  await d.start(); d.setScope(A); d.recordHealth();
  assert.ok(d.events.some(row => row.event.event_type === 'diagnostics_dropped'));
  await d.shutdown();
  const disk = { ...fs, open: async () => new Promise(() => {}) };
  const hung = new PrintDiagnostics({ filename: path.join(directory, 'hung.json'), appVersion: '1.5.65', disk });
  await hung.start(); hung.setScope(A);
  const before = Date.now();
  hung.record('job_claim', { job_id: JOB });
  let printed = false;
  await Promise.resolve().then(() => { printed = true; });
  assert.equal(printed, true);
  await hung.shutdown(20);
  assert.ok(Date.now() - before < 300);
  const failed = new PrintDiagnostics({ filename: path.join(directory, 'failed.json'), appVersion: '1.5.65', disk: { ...fs, open: async () => { throw Object.assign(new Error('private path'), { code: 'ENOSPC' }); } } });
  await failed.start(); failed.setScope(A); failed.recordHealth(); await failed.shutdown(20);
});

test('power/update/app events and heartbeat are independent of blocked physical I/O', async t => {
  const { directory } = await fixture(t);
  const worker = new DesktopPrintWorker({ runtimeConfig: {}, userDataPath: directory, appVersion: '1.5.65' });
  await worker.diagnostics.start();
  worker.diagnostics.setScope(A);
  let calls = 0;
  worker.diagnostics.setScope(A, async (_scope, events) => { calls++; return { accepted_ids: events.map(event => event.id) }; });
  worker.service.processing = true;
  worker.service.running = true;
  worker.recordPowerEvent('suspend'); worker.recordPowerEvent('resume');
  worker.recordAppError('UNHANDLED_REJECTION');
  worker.diagnostics.recordHealth();
  assert.ok(worker.diagnostics.events.some(row => row.event.event_type === 'health' && row.event.details.service_state === 'processing'));
  worker.service.processing = false;
  await worker.prepareForUpdate();
  worker.service.running = false;
  worker.resumeAfterUpdate();
  const types = worker.diagnostics.events.map(row => row.event.event_type);
  for (const type of ['suspend', 'resume', 'app_error', 'update_pause', 'update_resume']) assert.ok(types.includes(type));
  await worker.diagnostics.flush(); assert.equal(calls, 1);
  await worker.diagnostics.shutdown();
});

test('job telemetry proves send separately from acknowledgement, includes target/duration and cannot break delivery', async t => {
  const { directory } = await fixture(t);
  const worker = new DesktopPrintWorker({ runtimeConfig: {}, userDataPath: directory, appVersion: '1.5.65' });
  await worker.diagnostics.start(); worker.diagnostics.setScope(A);
  let sends = 0, acknowledgements = 0;
  const operation = { jobId: JOB, restaurantId: A.restaurantId, consumerId: A.agentId };
  await assert.rejects(worker.deliverDiagnosed(operation, async () => { sends++; }, async () => { acknowledgements++; throw new Error('private lost acknowledgement'); }, { host: '192.168.1.33', port: 9100 }));
  const sent = worker.diagnostics.events.find(row => row.event.event_type === 'job_sent').event;
  assert.equal(sent.details.host, '192.168.1.33'); assert.equal(sent.details.port, 9100); assert.ok(Number.isInteger(sent.details.duration_ms));
  assert.ok(worker.diagnostics.events.some(row => row.event.event_type === 'job_error' && row.event.details.phase === 'ack' && row.event.details.error_code === 'ACK_FAILED'));
  await worker.deliverDiagnosed(operation, async () => { sends++; }, async () => { acknowledgements++; }, {}, false);
  assert.equal(sends, 1); assert.equal(acknowledgements, 2);
  assert.equal(worker.diagnostics.events.filter(row => row.event.event_type === 'job_sent').length, 1);
  worker.diagnostics.record = () => { throw new Error('diagnostics failure'); };
  assert.equal(await worker.deliverDiagnosed(operation, async () => { sends++; }, async () => { acknowledgements++; }), 'sent');
  assert.equal(sends, 2);
  worker.diagnostics.record = () => {};
  await worker.diagnostics.shutdown();
});

test('stopped service authenticates diagnostics without presence writes or claims; recorder enforces existing owning-agent registration', async t => {
  const { directory } = await fixture(t);
  const worker = new DesktopPrintWorker({ runtimeConfig: {}, userDataPath: directory, appVersion: '1.5.65' });
  await worker.diagnostics.start();
  worker.savedSession = { access_token: 'fake-only-in-isolated-test', refresh_token: 'fake', expires_at: null };
  worker.authState.user = { id: A.userId }; worker.authState.restaurant = { id: A.restaurantId };
  const calls = [];
  let registered = false;
  const client = { rpc: (name, params) => {
    calls.push({ name, params });
    if (name === 'printing_register_agent') { registered = true; return Promise.resolve({ data: {}, error: null }); }
    if (name === 'printing_record_agent_events') return { abortSignal: async () => registered
      ? ({ data: { accepted_ids: params.p_events.map(event => event.id) }, error: null })
      : ({ data: null, error: { code: '42501', message: 'agent must already belong to authenticated user' } }) };
    throw new Error('unexpected RPC ' + name);
  } };
  worker.ensureSupabaseClient = () => client;
  worker.ensureSignedIn = async () => worker.bindDiagnosticsIdentity(client);
  worker.fetchAssignedPrinterId = async () => null;
  await worker.refreshDiagnosticsIdentity();
  assert.equal(worker.service.running, false);
  assert.equal(calls.length, 0, 'stopped diagnostics must never mutate presence');
  await worker.diagnostics.flush();
  assert.deepEqual(calls.map(call => call.name), ['printing_record_agent_events']);
  assert.ok(worker.diagnostics.events.length > 0, 'new stopped agent retains events');
  worker.service.running = true;
  worker.serviceProtocolRpcAvailable = false;
  await worker.heartbeatAgent(true);
  await worker.diagnostics.flush();
  assert.deepEqual(calls.map(call => call.name), ['printing_record_agent_events', 'printing_register_agent', 'printing_record_agent_events']);
  assert.equal(calls[1].params.p_is_active, true);
  assert.equal(worker.diagnostics.events.length, 0);
  await worker.clearSession();
  worker.diagnostics.recordHealth(); await worker.diagnostics.flush();
  assert.equal(calls.length, 3);
  await worker.diagnostics.shutdown();
});

test('unchanged scope refreshes uploader without rewriting the local spool on every print poll', async t => {
  let writes = 0;
  const { d } = await fixture(t, { disk: { ...fs, open: (...args) => { writes++; return fs.open(...args); } } });
  d.setScope(A); await d.persistWithin();
  const before = writes;
  for (let i = 0; i < 10; i++) d.setScope(A, async () => ({ accepted_ids: [] }));
  await d.persistWithin();
  assert.equal(writes, before);
});

test('independent health/upload timers continue while a printer operation remains unresolved', async t => {
  const { directory } = await fixture(t);
  let heartbeats = 0;
  const d = new PrintDiagnostics({ filename: path.join(directory, 'timed.json'), appVersion: '1.5.65', healthIntervalMs: 5, uploadIntervalMs: 5,
    health: () => ({ service_state: 'processing' }) });
  await d.start();
  let release;
  const printer = new Promise(resolve => { release = resolve; });
  d.setScope(A, async (_scope, events) => { heartbeats += events.filter(event => event.event_type === 'health').length; return { accepted_ids: events.map(event => event.id) }; });
  const deadline = Date.now() + 500;
  while (heartbeats < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(heartbeats >= 2);
  release(); await printer; await d.shutdown();
});

test('compiled main quit drains diagnostics once, preserves error taxonomy and does not prevent final exit', async () => {
  const { EventEmitter } = require('node:events');
  const vm = require('node:vm');
  const read = require('node:fs').readFileSync;
  const main = read(path.join(__dirname, '../electron-dist/main.cjs'), 'utf8');
  const app = new EventEmitter();
  let attempts = 0, exits = 0, shutdowns = 0, release;
  Object.assign(app, { getPath: () => __dirname, getVersion: () => '1.5.65', requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}), quit: () => {
      attempts++; let prevented = false;
      app.emit('before-quit', { preventDefault: () => { prevented = true; } });
      if (!prevented) exits++;
    } });
  const errors = [];
  const processEmitter = new EventEmitter();
  const context = { module: { exports: {} }, __dirname, Buffer, URL, setTimeout, clearTimeout, clearInterval,
    console: { log() {}, warn() {}, error() {} },
    process: { argv: [], platform: 'win32', arch: 'x64', cwd: () => __dirname, resourcesPath: __dirname, env: {}, on: processEmitter.on.bind(processEmitter) },
    require(name) {
      if (name === 'electron') return { app };
      if (name === 'electron-updater') return { autoUpdater: new EventEmitter() };
      if (name === './desktopUpdate.cjs') return require('../electron-dist/desktopUpdate.cjs');
      if (name === './desktopVersionGuard.cjs' || name === './printWorker.cjs' || name === './printerPaper.cjs') return {};
      if (name === 'node:fs') return { existsSync: () => false, mkdirSync() {}, appendFileSync() {} };
      return require(name);
    } };
  vm.runInNewContext(main + '\nmodule.exports.setWorker = worker => { printWorker = worker; };', context);
  context.module.exports.setWorker({ shutdown: () => { shutdowns++; return new Promise(resolve => { release = resolve; }); }, recordAppError: code => errors.push(code) });
  processEmitter.emit('uncaughtException', new Error('SECRET stack'));
  processEmitter.emit('unhandledRejection', 'SECRET token');
  app.emit('render-process-gone', {}, { id: 1, getURL: () => 'https://private/path' }, {});
  app.emit('child-process-gone', {}, {});
  assert.deepEqual(errors, ['UNCAUGHT_EXCEPTION', 'UNHANDLED_REJECTION', 'RENDER_PROCESS_GONE', 'CHILD_PROCESS_GONE']);
  app.quit(); app.quit();
  assert.equal(shutdowns, 1); assert.equal(exits, 0);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 3); assert.equal(exits, 1);
});

test('a failed send or cloud acknowledgement never advances last successful poll cycle', async t => {
  const { directory } = await fixture(t);
  for (const mode of ['not_sent', 'lost_ack']) {
    const worker = new DesktopPrintWorker({ runtimeConfig: {}, userDataPath: path.join(directory, mode), appVersion: '1.5.65' });
    worker.authState.user = { id: A.userId }; worker.authState.restaurant = { id: A.restaurantId };
    worker.service.running = true;
    worker.lastSuccessAt = '2026-01-01T00:00:00.000Z';
    worker.ensureSignedIn = async () => {};
    worker.heartbeatAgent = async () => {};
    worker.fetchLivePrinterRoutes = async () => ({ kitchenLayout: {} });
    worker.resolveRouteForJob = () => ({ host: 'fixture.local', port: 9100 });
    worker.sendToPrinter = async () => { if (mode === 'not_sent') throw new PrintNotSentError('connect ETIMEDOUT private'); };
    worker.completePrintJob = async () => { if (mode === 'lost_ack') throw new Error('cloud acknowledgement lost'); };
    let claimed = false;
    worker.ensureSupabaseClient = () => ({ rpc: async name => {
      if (name === 'print_claim_jobs' && !claimed) { claimed = true; return { data: [{ id: JOB, department: 'cucina' }], error: null }; }
      return { data: [], error: null };
    } });
    await worker.runTick();
    clearTimeout(worker.service.timer);
    assert.equal(worker.lastSuccessAt, '2026-01-01T00:00:00.000Z', mode);
    assert.ok(worker.lastPollAt);
    assert.ok(worker.service.stats.failed > 0);
    worker.completePrintJob = async () => {};
    await worker.runTick();
    clearTimeout(worker.service.timer);
    assert.notEqual(worker.lastSuccessAt, '2026-01-01T00:00:00.000Z');
    worker.service.running = false;
  }
});

test('logout while authentication is resolving cannot restore the previous diagnostics scope', async t => {
  const { directory } = await fixture(t);
  const worker = new DesktopPrintWorker({ runtimeConfig: {}, userDataPath: directory, appVersion: '1.5.65' });
  await worker.diagnostics.start(); worker.diagnostics.setScope(A);
  let finish;
  const client = { auth: { getUser: () => new Promise(resolve => { finish = resolve; }) } };
  worker.ensureSupabaseClient = () => client;
  const pending = worker.ensureSignedIn();
  await worker.clearSession();
  finish({ data: { user: { id: A.userId } }, error: null });
  await assert.rejects(pending, /PRINT_SERVICE_CHANGED/);
  assert.equal(worker.diagnostics.captureScope(), null);
  assert.equal(worker.authState.user, null);
  await worker.diagnostics.shutdown();
});

test('invalid numeric IPv4 cannot poison replay or prevent later events from uploading', async t => {
  const { d } = await fixture(t);
  const received = [];
  d.setScope(A, async (_scope, events) => {
    for (const event of events) {
      assert.notEqual(event.details.host, '999.999.999.999');
      received.push(event);
    }
    return { accepted_ids: events.map(event => event.id) };
  });
  d.record('job_error', { job_id: JOB, host: '999.999.999.999', phase: 'transport', error_code: 'ETIMEDOUT' }, 'error');
  d.record('health', { service_state: 'running' });
  await d.flush();
  const invalidRoute = received.find(event => event.event_type === 'job_error');
  assert.ok(invalidRoute); assert.equal(invalidRoute.details.host, undefined);
  assert.ok(received.some(event => event.event_type === 'health' && event.details.service_state === 'running'));
  assert.equal(d.events.length, 0);
});

test('deferred stopped diagnostics authentication cannot overwrite an active printing heartbeat', async t => {
  const { directory } = await fixture(t);
  const worker = new DesktopPrintWorker({ runtimeConfig: {}, userDataPath: directory, appVersion: '1.5.65' });
  await worker.diagnostics.start();
  worker.savedSession = { access_token: 'isolated-test', refresh_token: 'fake', expires_at: null };
  worker.authState.user = { id: A.userId }; worker.authState.restaurant = { id: A.restaurantId };
  let release;
  worker.ensureSignedIn = () => new Promise(resolve => { release = resolve; });
  const registrations = [];
  worker.fetchAssignedPrinterId = async () => null;
  worker.serviceProtocolRpcAvailable = false;
  worker.ensureSupabaseClient = () => ({ rpc: async (name, args) => {
    assert.equal(name, 'printing_register_agent'); registrations.push(args.p_is_active);
    return { data: {}, error: null };
  } });
  const pending = worker.refreshDiagnosticsIdentity();
  worker.service.running = true;
  worker.serviceStartGeneration++;
  await worker.heartbeatAgent(true);
  release(); await pending;
  assert.deepEqual(registrations, [true]);
  worker.service.running = false;
  await worker.diagnostics.shutdown();
});
