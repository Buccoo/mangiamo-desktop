const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const test = require('node:test');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const id = n => `76000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const payload = intent => ({ service_protocol_version: 1, service_group_id: id(1), intent,
  execution_revision: 3, dedupe_key: 'service-fixture-1', session_id: id(2), order_id: id(3),
  service_batch_id: id(4), execution_fence: id(5), not_before: '2026-01-01T10:00:00Z', expires_at: '2026-01-01T10:05:00Z',
  table_number: '1', items: [{ order_item_id: id(6), quantity: 2, name: 'Pasta', notes: 'Senza sale' }] });
const job = intent => ({ id: id(7), department: 'cucina', payload: payload(intent), created_at: '2026-01-01T10:00:00Z' });

function load() {
  let writes = [], connects = [];
  class Socket extends EventEmitter {
    setNoDelay() {} setTimeout() {} destroy() {}
    connect(_port, _host, connected) { connects.push(_host); connected(); }
    write(bytes, completed) { writes.push(Buffer.from(bytes)); completed(); }
    end(completed) { completed(); }
  }
  const filename = path.join(__dirname, '../electron-dist/printWorker.cjs');
  const actualRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(require('node:fs').readFileSync(filename, 'utf8') + '\nmodule.exports.renderServiceTest=renderTicket;', {
    module, exports: module.exports, require: name => name === 'node:net' ? { Socket } : actualRequire(name),
    Buffer, process, __dirname: path.dirname(filename), setTimeout, clearTimeout,
  });
  return { ...module.exports, writes, connects };
}

test('mandatory information/prepare/cancel semantics and group revision are visible in the real renderer', () => {
  const render = load().renderServiceTest;
  for (const [intent, first, second] of [
    ['information', 'INFORMAZIONE - ATTENDI IL VIA', 'NON INIZIARE LA PREPARAZIONE'],
    ['prepare', 'VIA PREPARAZIONE', 'Confermare avvio sul KDS'],
    ['cancel', 'ANNULLAMENTO - VERIFICA CON LO STAFF', 'Non annulla lavorazioni gia iniziate'],
  ]) {
    const protectedJob = job(intent);
    protectedJob.payload.layout = { header: { visible: false }, items: { visible: false, show_quantity: false }, show_quantity: false };
    const text = render(protectedJob);
    assert.equal(text.split('\n')[0], first);
    assert.equal(text.split('\n')[1], second);
    assert.match(text, /USCITA 76000000 REV\.3/);
    assert.match(text, /2x Pasta/);
  }
});

test('unknown or malformed protocol never reaches TCP or falls back to a PIN/legacy ticket', async () => {
  const worker = load();
  const valid = payload('prepare');
  for (const invalid of [
    { ...valid, service_protocol_version: 2 }, { ...valid, service_protocol_version: null },
    { ...valid, intent: 'start' }, { ...valid, service_group_id: 'no-group' },
    { ...valid, execution_revision: 0 }, { ...valid, dedupe_key: '' },
    { ...valid, service_batch_id: null }, { ...valid, execution_fence: null },
    { ...valid, service_protocol_version: undefined },
    { ...valid, not_before: '2026-02-30T10:00:00Z', expires_at: '2026-03-05T10:05:00Z' },
    { ...valid, items: [{ ...valid.items[0], quantity: 0 }] },
    { ...valid, items: [{ ...valid.items[0], quantity: 1000 }] },
    { ...valid, items: [{ ...valid.items[0], quantity: '2' }] },
    { ...valid, expires_at: 'bad-date' }, { ...valid, items: [{ quantity: 1, name: 'Pasta' }] },
    { ...valid, items: [...valid.items, ...valid.items] }, { ...valid, purpose: 'pin_slip', department: 'pin', items: [{ name: 'PIN: 0123' }] },
  ]) {
    await assert.rejects(worker.DesktopPrintWorker.prototype.sendToPrinter.call({}, { ...job('prepare'), department: 'pin', payload: invalid }, { host: 'mock-only', port: 9100 }), error => error.constructor.name === 'PrintNotSentError');
  }
  assert.equal(worker.writes.length, 0);
  assert.equal(worker.connects.length, 0);
});

async function withWorker(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mangiamo-service-print-'));
  const loaded = load(), calls = [], logs = [];
  const worker = new loaded.DesktopPrintWorker({ runtimeConfig: { VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'fixture' }, userDataPath: directory, appVersion: 'fixture', onMainLog: (level, message) => logs.push({ level, message }) });
  worker.authState.restaurant = { id: id(10), name: 'Fixture', city: null, role: 'owner' };
  worker.authState.user = { id: id(11), email: null };
  worker.ensureSignedIn = async () => {};
  worker.fetchAssignedPrinterId = async () => null;
  worker.fetchLivePrinterRoutes = async () => ({ byId: new Map(), byDepartment: new Map(), defaultPrinterId: null, pinPrinterId: null });
  worker.resolveRouteForJob = () => ({ host: 'mock-only', port: 9100 });
  const state = { legacyJobs: [], serviceJobs: [job('prepare')], missing: false, ackFails: false, renewDenied: false };
  worker.ensureSupabaseClient = () => ({ rpc: async (name, parameters) => {
    calls.push({ name, parameters });
    if (name === 'printing_register_agent') return { data: {}, error: null };
    if (name === 'printing_register_service_protocol' && state.missing) return { error: { message: 'Could not find printing_register_service_protocol in the schema cache' } };
    if (name === 'printing_register_service_protocol') return { data: { ok: true }, error: null };
    if (name === 'print_claim_jobs') { const jobs = state.legacyJobs; state.legacyJobs = []; return { data: jobs, error: null }; }
    if (name === 'print_claim_service_jobs') { const jobs = state.serviceJobs; state.serviceJobs = []; return { data: jobs, error: null }; }
    if (name === 'print_renew_service_claim') {
      assert.ok(loaded.connects.length > 0, 'Service lease is renewed after connect and before write');
      return { data: { ok: !state.renewDenied, lease_seconds: 120 }, error: null };
    }
    if (name === 'print_complete_job' && state.ackFails) { state.ackFails = false; return { error: new Error('lost acknowledgement') }; }
    return { data: [], error: null };
  } });
  const tick = async () => { worker.service.running = true; try { await worker.runTick(); } finally { worker.service.running = false; clearTimeout(worker.service.timer); } };
  try { await run({ worker, loaded, calls, logs, state, tick }); }
  finally { worker.service.running = false; clearTimeout(worker.service.timer); await fs.rm(directory, { recursive: true, force: true }); }
}

test('real worker registers protocol after heartbeat, claims only after empty legacy, renews service and never starts a batch', async () => withWorker(async ({ loaded, calls, tick }) => {
  await tick();
  const names = calls.map(call => call.name);
  assert.ok(names.indexOf('printing_register_agent') < names.indexOf('printing_register_service_protocol'));
  assert.ok(names.indexOf('print_claim_jobs') < names.indexOf('print_claim_service_jobs'));
  assert.equal(names.includes('print_renew_claim'), false);
  assert.ok(names.includes('print_renew_service_claim'));
  assert.equal(names.some(name => /start_service|kitchen_|service_batch_status/.test(name)), false);
  assert.equal(calls.find(call => call.name === 'print_renew_service_claim').parameters.p_protocol_version, 1);
  assert.equal(loaded.writes.length, 1);
}));

test('legacy nonempty skips service claim; missing protocol RPC warns once and remains legacy only', async () => withWorker(async ({ calls, state, logs, tick }) => {
  state.legacyJobs = [{ ...job('information'), payload: { items: [{ name: 'Legacy', quantity: 1 }] } }];
  await tick();
  assert.equal(calls.some(call => call.name === 'print_claim_service_jobs'), false);
  state.missing = true;
  await tick(); await tick();
  assert.equal(calls.filter(call => call.name === 'printing_register_service_protocol').length, 2);
  assert.equal(calls.some(call => call.name === 'print_claim_service_jobs'), false);
  assert.equal(logs.filter(log => /protocollo.*non disponibile/i.test(log.message)).length, 1);
}));

test('lost service acknowledgement reconciles the existing durable journal and never repeats paper', async () => withWorker(async ({ calls, loaded, state, tick }) => {
  state.ackFails = true;
  await tick();
  assert.equal(loaded.writes.length, 1);
  await tick();
  assert.equal(loaded.writes.length, 1);
  assert.equal(calls.filter(call => call.name === 'print_complete_job').length, 2);
}));

test('worker uses its live kitchen layout and defers safely if settings cannot be read', async () => {
  await withWorker(async ({ worker, loaded, state, tick }) => {
    state.serviceJobs = [];
    state.legacyJobs = [{ ...job('information'), payload: { table_number: '8', items: [{ name: 'Riso', quantity: 1 }] } }];
    worker.fetchLivePrinterRoutes = async () => ({ byId: new Map(), byDepartment: new Map(), kitchenLayout: { font: 'A', align: 'right', table: { label: 'POSTAZIONE' } } });
    await tick();
    assert.equal(loaded.writes.length, 1);
    assert.deepEqual(loaded.writes[0].subarray(0, 5), Buffer.from([27, 64, 27, 77, 0]));
    assert.ok(loaded.writes[0].includes(Buffer.from('POSTAZIONE: 8')));
  });
  await withWorker(async ({ worker, loaded, state, calls, tick }) => {
    state.serviceJobs = [];
    state.legacyJobs = [{ ...job('information'), payload: { items: [{ name: 'Riso', quantity: 1 }] } }];
    worker.fetchLivePrinterRoutes = async () => { throw new Error('temporary settings read failure'); };
    await tick();
    assert.equal(loaded.writes.length, 0);
    assert.equal(calls.find(call => call.name === 'print_complete_job').parameters.p_meta.delivery_state, 'not_sent');
  });
});

test('service-claimed job missing its protocol and denied renewal both stay not-sent', async () => {
  await withWorker(async ({ calls, loaded, state, tick }) => {
    state.serviceJobs = [{ ...job('information'), payload: { items: [{ name: 'Missing contract', quantity: 1 }] } }];
    await tick();
    assert.equal(loaded.connects.length, 0);
    assert.equal(calls.find(call => call.name === 'print_complete_job').parameters.p_meta.delivery_state, 'not_sent');
  });
  await withWorker(async ({ calls, loaded, state, tick }) => {
    state.renewDenied = true;
    await tick();
    assert.equal(loaded.writes.length, 0);
    assert.equal(calls.some(call => call.name === 'print_renew_claim'), false);
    assert.equal(calls.find(call => call.name === 'print_complete_job').parameters.p_meta.delivery_state, 'not_sent');
  });
});
