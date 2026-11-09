const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture(t, batches = []) {
  let now = 100000;
  const timers = [];
  const module = { exports: {} };
  const filename = path.resolve(__dirname, '../electron-dist/printWorker.cjs');
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, require: createRequire(filename), Buffer, process,
    __dirname: path.dirname(filename), Date: Clock,
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout: () => {},
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'print-loop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const worker = new module.exports.DesktopPrintWorker({ runtimeConfig: {}, appVersion: 'test', userDataPath: directory });
  worker.authState.restaurant = { id: 'venue' };
  worker.service.running = true;
  worker.config.pollMs = 1000;
  const calls = [];
  const state = { routes: 0, heartbeats: 0, sends: 0, acknowledgements: 0, failAck: false, receiptBatches: {}, receiptErrors: {} };
  worker.ensureSignedIn = async () => { now += 100; };
  worker.heartbeatAgent = async () => { state.heartbeats++; now += 100; };
  worker.fetchLivePrinterRoutes = async () => { state.routes++; return { kitchenLayout: {}, receiptLayout: {} }; };
  worker.resolveRouteForJob = () => ({ host: 'fixture', port: 9100 });
  worker.sendToPrinter = async () => { state.sends++; };
  worker.sendToNonFiscalReceiptPrinter = async (_job, layout) => { assert.ok(layout); state.sends++; };
  worker.sendToFiscalReceiptPrinter = async () => { state.sends++; };
  worker.sendToPhysicalReceiptDevice = async () => { state.sends++; return 'authoritative-fixture-id'; };
  worker.completePrintJob = async () => {
    state.acknowledgements++;
    if (state.failAck) throw new Error('lost acknowledgement');
  };
  worker.completeReceiptDelivery = worker.completePrintJob;
  worker.ensureSupabaseClient = () => ({ rpc: async (name) => {
    calls.push(name); now += 100;
    return { data: name === 'print_claim_jobs' ? batches.shift() || [] : state.receiptBatches[name]?.shift() || [], error: state.receiptErrors[name] || null };
  } });
  return { worker, state, calls, timers, directory, advance: (ms) => { now += ms; } };
}

test('legacy 2500ms settings become a 1000ms poll without batch leases', async (t) => {
  const { worker, directory } = fixture(t);
  fs.writeFileSync(path.join(directory, 'desktop-print-worker.json'), JSON.stringify({ config: { pollMs: 2500, claimLimit: 10 } }));
  await worker.loadPersistedState();
  assert.equal(worker.getPublicState().config.pollMs, 1000);
  assert.equal(worker.getPublicState().config.claimLimit, 1);
});

test('idle ticks avoid route reads, throttle heartbeat and rotate receipt queues fairly', async (t) => {
  const { worker, state, calls, timers, advance } = fixture(t);
  for (let i = 0; i < 3; i++) { await worker.runTick(); advance(1000); }
  assert.equal(state.routes, 0);
  assert.equal(state.heartbeats, 1);
  assert.deepEqual(calls.filter(name => name !== 'print_claim_jobs'), [
    'physical_receipt_claim_jobs', 'non_fiscal_receipt_claim_jobs', 'fiscal_receipt_print_claim_jobs',
  ]);
  assert.equal(timers[0].delay, 600); // Network time counts toward the interval.
  assert.equal(timers[1].delay, 700);
  advance(15000); await worker.runTick();
  assert.equal(state.heartbeats, 2);
});

test('confirmed jobs drain immediately, one physical send per claim', async (t) => {
  const { worker, state, timers } = fixture(t, [[{ id: 'one', department: 'cucina' }], [{ id: 'two', department: 'cucina' }]]);
  await worker.runTick();
  assert.equal(timers.at(-1).delay, 0);
  await worker.runTick();
  assert.equal(state.sends, 2);
  assert.equal(state.routes, 2);
  assert.equal(state.acknowledgements, 2);
});

test('a lost cloud acknowledgement is recovered without sending paper twice or hot retrying', async (t) => {
  const { worker, state, timers } = fixture(t, [[{ id: 'one', department: 'cucina' }]]);
  state.failAck = true;
  await worker.runTick();
  assert.equal(state.sends, 1);
  assert.ok(timers.at(-1).delay >= 1000);
  state.failAck = false;
  await worker.runTick();
  assert.equal(state.sends, 1);
  assert.equal(state.acknowledgements, 2);
  assert.equal((await worker.deliveryJournal.list()).length, 0);
});

test('overlapping ticks stay serialized and stopping before a send fails closed', async (t) => {
  const { worker, state, timers } = fixture(t, [[{ id: 'one', department: 'cucina' }]]);
  let release;
  worker.fetchLivePrinterRoutes = async () => await new Promise(resolve => { release = resolve; });
  const pending = worker.runTick();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await worker.runTick();
  await worker.stopService();
  release({ kitchenLayout: {} });
  await pending;
  assert.equal(state.sends, 0);
  assert.equal(timers.length, 0);
});

test('receipt queues retain renewal, acknowledgement and fresh layouts only when needed', async (t) => {
  const { worker, state, calls, timers } = fixture(t);
  for (const name of ['physical_receipt_claim_jobs', 'non_fiscal_receipt_claim_jobs', 'fiscal_receipt_print_claim_jobs']) {
    state.receiptBatches[name] = [[{ id: name }]];
  }
  for (let i = 0; i < 3; i++) {
    await worker.runTick();
    assert.equal(timers.at(-1).delay, 0);
  }
  assert.equal(state.sends, 3);
  assert.equal(state.acknowledgements, 3);
  assert.equal(state.routes, 1);
  assert.equal(calls.filter(name => name === 'print_renew_receipt_claim').length, 3);
});

test('missing receipt RPC is skipped subsequently while remaining queues continue', async (t) => {
  const { worker, state, calls } = fixture(t);
  state.receiptErrors.physical_receipt_claim_jobs = { code: 'PGRST202', message: 'Could not find physical_receipt_claim_jobs in schema cache' };
  for (let i = 0; i < 5; i++) await worker.runTick();
  assert.equal(calls.filter(name => name === 'physical_receipt_claim_jobs').length, 1);
  assert.equal(calls.filter(name => name === 'non_fiscal_receipt_claim_jobs').length, 2);
  assert.equal(calls.filter(name => name === 'fiscal_receipt_print_claim_jobs').length, 2);
});

test('a physical write blocks concurrent claims until its acknowledgement finishes', async (t) => {
  const { worker, state, calls } = fixture(t, [[{ id: 'one', department: 'cucina' }], [{ id: 'two', department: 'cucina' }]]);
  let release;
  worker.sendToPrinter = async () => { state.sends++; await new Promise(resolve => { release = resolve; }); };
  const pending = worker.runTick();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await Promise.all([worker.runTick(), worker.runTick()]);
  assert.equal(calls.filter(name => name === 'print_claim_jobs').length, 1);
  assert.equal(state.sends, 1);
  release(); await pending;
  assert.equal(state.acknowledgements, 1);
});

test('receipt acknowledgement loss never resends the document during recovery', async (t) => {
  const { worker, state, timers } = fixture(t);
  state.receiptBatches.non_fiscal_receipt_claim_jobs = [[{ id: 'receipt' }]];
  await worker.runTick();
  state.failAck = true;
  await worker.runTick();
  assert.equal(state.sends, 1);
  assert.ok(timers.at(-1).delay >= 1000);
  state.failAck = false;
  await worker.runTick();
  assert.equal(state.sends, 1);
  assert.equal(state.acknowledgements, 2);
  assert.equal((await worker.deliveryJournal.list()).length, 0);
});
