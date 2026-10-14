const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EventEmitter } = require("node:events");

function loadWorkerExports(netOverride) {
  const source = require("node:fs").readFileSync(path.join(__dirname, "../electron-dist/printWorker.cjs"), "utf8");
  const module = { exports: {} };
  const actualRequire = createRequire(path.join(__dirname, "../electron-dist/printWorker.cjs"));
  vm.runInNewContext(source + "\nmodule.exports.renderTicketForTest = renderTicket; module.exports.resolveRouteForTest = DesktopPrintWorker.prototype.resolveRouteForJob; module.exports.openRawSocketForTest = openRawSocket;", {
    module, exports: module.exports, require: (name) => name === "node:net" && netOverride ? netOverride : actualRequire(name), Buffer, process, __dirname: path.join(__dirname, "../electron-dist"),
  });
  return module.exports;
}

test("real desktop ticket contains variant quantities and additions", () => {
  const render = loadWorkerExports().renderTicketForTest;
  const text = render({ department: "sushi", payload: { restaurant_name: "Fixture", table_number: "1", items: [{
    name: "Nigiri", quantity: 2, notes: "senza wasabi", modifiers: [
      { name: "Salmone", qty: 2, modifier_type: "variant" },
      { name: "Avocado", qty: 1, modifier_type: "extra" },
      { name: "Wasabi", qty: 1, modifier_type: "remove" },
      { name: "Cipolla", qty: 2, modifier_type: "removal" },
      { name: "Maionese", qty: 1, modifier_type: "addon" },
    ],
  }] } });
  assert.match(text, /Salmone x2/);
  assert.match(text, /\+ Avocado/);
  assert.match(text, /SENZA Wasabi/);
  assert.match(text, /SENZA Cipolla x2/);
  assert.match(text, /\+ Maionese/);
  assert.match(text, /senza wasabi/);
});

test("department routing follows the live mapping without default-printer fallback", () => {
  const resolve = loadWorkerExports().resolveRouteForTest;
  const old = { id: "old", host: "old-host", port: 9100, enabled: true };
  const current = { id: "current", host: "current-host", port: 9100, enabled: true };
  const bar = { id: "bar", host: "bar-host", port: 9100, enabled: true };
  const routes = { byId: new Map([["old", old], ["current", current], ["bar", bar]]), byDepartment: new Map([["sushi", current]]), defaultPrinterId: "bar" };
  assert.equal(resolve({ department: "sushi", route: old }, routes).id, "current");
  assert.equal(resolve({ department: "unmapped", route: old }, routes), null);
});

test("explicit printer test keeps its requested target", () => {
  const resolve = loadWorkerExports().resolveRouteForTest;
  const routes = { byId: new Map([["bar", { id: "bar", host: "bar-host", port: 9100, enabled: true }]]), byDepartment: new Map(), defaultPrinterId: "bar" };
  assert.equal(resolve({ department: "test", route: { host: "requested-host", port: 9100 } }, routes).host, "requested-host");
});

async function withJournal(run) {
  let delivery;
  try { delivery = require("../electron-dist/printDelivery.cjs"); } catch {}
  assert.equal(typeof delivery?.LocalPrintJournal, "function", "durable delivery journal must exist");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mangiamo-print-test-"));
  try {
    await run(delivery, path.join(directory, "journal.json"));
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const operation = { jobId: "job-1", restaurantId: "restaurant-1", consumerId: "consumer-1" };

function fakeTransport() {
  let socket;
  class Socket extends EventEmitter {
    constructor() { super(); socket = this; this.writes = 0; }
    setNoDelay() {}
    setTimeout() {}
    connect(_port, _host, connected) { this.connected = connected; }
    write() { this.writes++; }
    destroy() {}
  }
  return { net: { Socket }, socket: () => socket };
}

test("actual socket connection failure is classified before the first write", async () => {
  const transport = fakeTransport();
  const send = loadWorkerExports(transport.net).openRawSocketForTest;
  const pending = send("fake-printer", 9100, Buffer.from("fixture"));
  transport.socket().emit("error", new Error("connection refused"));
  await assert.rejects(pending, { name: "Error", message: "connection refused" });
  await pending.catch((error) => assert.equal(error.constructor.name, "PrintNotSentError"));
  assert.equal(transport.socket().writes, 0);
});

test("actual socket premature close after writing is held uncertain", async () => withJournal(async ({ LocalPrintJournal, deliverPrintJob }, filename) => {
  const transport = fakeTransport();
  const send = loadWorkerExports(transport.net).openRawSocketForTest;
  const pending = deliverPrintJob(new LocalPrintJournal(filename), operation, () => {
    const sending = send("fake-printer", 9100, Buffer.from("fixture"));
    transport.socket().connected();
    transport.socket().emit("close", false);
    return sending;
  }, async (success, error, meta) => {
    assert.equal(success, false);
    assert.match(error, /^DELIVERY_UNCERTAIN:/);
    assert.equal(meta.delivery_state, "uncertain");
  });
  assert.equal(await pending, "uncertain");
  assert.equal(transport.socket().writes, 1);
}));

test("ack failure survives restart and retries only acknowledgement", async () => withJournal(async ({ LocalPrintJournal, deliverPrintJob }, filename) => {
  let sends = 0;
  await assert.rejects(deliverPrintJob(new LocalPrintJournal(filename), operation, async () => { sends++; }, async () => { throw new Error("offline ack"); }), /offline ack/);
  const reopened = new LocalPrintJournal(filename);
  assert.equal((await reopened.list())[0].state, "sent");
  await deliverPrintJob(reopened, operation, async () => { sends++; }, async (success, error, meta) => {
    assert.equal(success, true);
    assert.equal(error, null);
    assert.equal(meta.delivery_state, "sent");
  });
  assert.equal(sends, 1);
  assert.deepEqual(await reopened.list(), []);
}));

test("interrupted sending is acknowledged uncertain without automatic resend", async () => withJournal(async ({ LocalPrintJournal, deliverPrintJob }, filename) => {
  const journal = new LocalPrintJournal(filename);
  await journal.set(operation, "sending");
  let sends = 0;
  await deliverPrintJob(new LocalPrintJournal(filename), operation, async () => { sends++; }, async (success, error, meta) => {
    assert.equal(success, false);
    assert.match(error, /^DELIVERY_UNCERTAIN:/);
    assert.equal(meta.delivery_state, "uncertain");
  });
  assert.equal(sends, 0);
}));

test("partial send is terminal uncertain and is not resent after ack failure", async () => withJournal(async ({ LocalPrintJournal, deliverPrintJob }, filename) => {
  let sends = 0;
  await assert.rejects(deliverPrintJob(new LocalPrintJournal(filename), operation, async () => { sends++; throw new Error("connection reset after write"); }, async () => { throw new Error("offline ack"); }), /offline ack/);
  await deliverPrintJob(new LocalPrintJournal(filename), operation, async () => { sends++; }, async (success, error, meta) => {
    assert.equal(success, false);
    assert.equal(meta.delivery_state, "uncertain");
  });
  assert.equal(sends, 1);
}));

test("proven connection failure before write remains safely retryable", async () => withJournal(async ({ LocalPrintJournal, deliverPrintJob, PrintNotSentError }, filename) => {
  const journal = new LocalPrintJournal(filename);
  await deliverPrintJob(journal, operation, async () => { throw new PrintNotSentError("connection refused"); }, async (success, error, meta) => {
    assert.equal(success, false);
    assert.match(error, /connection refused/);
    assert.equal(meta.delivery_state, "not_sent");
  });
  assert.deepEqual(await journal.list(), []);
}));

test("corrupt delivery journal fails closed before transport", async () => withJournal(async ({ LocalPrintJournal, deliverPrintJob }, filename) => {
  await fs.writeFile(filename, "corrupt", "utf8");
  let sends = 0;
  await assert.rejects(deliverPrintJob(new LocalPrintJournal(filename), operation, async () => { sends++; }, async () => {}));
  assert.equal(sends, 0);
}));

test("physical receipt id survives acknowledgement loss and restart", async () => withJournal(async ({ LocalPrintJournal, deliverPrintJob }, filename) => {
  const receipt = { ...operation, queue: "physical" };
  await assert.rejects(deliverPrintJob(new LocalPrintJournal(filename), receipt, async () => "RT-fixture-123", async () => { throw new Error("offline ack"); }));
  const stored = (await new LocalPrintJournal(filename).list())[0];
  assert.equal(stored.queue, "physical");
  assert.equal(stored.receiptId, "RT-fixture-123");
  let sends = 0;
  await deliverPrintJob(new LocalPrintJournal(filename), receipt, async () => { sends++; }, async (success, error, meta) => {
    assert.equal(success, true);
    assert.equal(meta.receipt_id, "RT-fixture-123");
  });
  assert.equal(sends, 0);
}));

test("reviewed receipt generation cannot reuse an older sent journal entry", async () => withJournal(async ({ LocalPrintJournal, deliverPrintJob }, filename) => {
  const journal = new LocalPrintJournal(filename);
  const older = { ...operation, queue: "non_fiscal", generation: 0 };
  await journal.set(older, "sent");
  let sends = 0;
  await deliverPrintJob(journal, { ...older, generation: 1 }, async () => { sends++; }, async (success, error, meta) => {
    assert.equal(meta.delivery_generation, 1);
  });
  assert.equal(sends, 1);
  assert.equal((await journal.list())[0].generation, 0);
}));
