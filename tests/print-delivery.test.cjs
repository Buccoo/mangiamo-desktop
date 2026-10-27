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
  vm.runInNewContext(source + "\nmodule.exports.escPosForTest = buildEscPosPayload; module.exports.renderTicketForTest = renderTicket; module.exports.resolveRouteForTest = DesktopPrintWorker.prototype.resolveRouteForJob; module.exports.openRawSocketForTest = openRawSocket; module.exports.sendToPrinterForTest = DesktopPrintWorker.prototype.sendToPrinter; module.exports.fetchLiveRoutesForTest = DesktopPrintWorker.prototype.fetchLivePrinterRoutes;", {
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

const pinJob = (table = "12", pin = "0123") => ({
  department: "pin", route: { id: "cash", host: "outdated-host", port: 9100 },
  payload: { purpose: "pin_slip", restaurant_name: "Never print this header", department: "pin", table_number: table, items: [{ name: `PIN: ${pin}` }] },
});

test("PIN slip separates the table from the readable leading-zero PIN without receipt headers", () => {
  assert.equal(loadWorkerExports().renderTicketForTest(pinJob()), "TAV. 12\nPIN: 0123");
});

test("PIN slip bounds table width and strips printer controls and line breaks", () => {
  const render = loadWorkerExports().renderTicketForTest;
  assert.equal(render(pinJob("\u001b\n12\r\t\u001d")), "TAV. 12\nPIN: 0123");
  assert.equal(render(pinJob("ABCDEFGHIJKLMNOPQRST", "001234")), "TAV. ABCDEFGHIJKL\nPIN: 001234");
  assert.equal(render(pinJob("一二三四五六七八九十", "001234")), "TAV. 一二三四五六\nPIN: 001234");
  assert.equal(render(pinJob("\u202e12\u200b")), "TAV. 12\nPIN: 0123");
});

test("PIN slip rejects missing or malformed PIN instead of printing arbitrary content", () => {
  const render = loadWorkerExports().renderTicketForTest;
  for (const pin of ["", "123", "1234567", "12\n34", "0123\u001bd\u0005", "12AB"]) {
    assert.throws(() => render(pinJob("12", pin)), /INVALID_PIN_SLIP/);
  }
});

async function actualPrintBytes(job) {
  let printed;
  class Socket extends EventEmitter {
    setNoDelay() {} setTimeout() {} destroy() {}
    connect(_port, _host, connected) { connected(); }
    write(payload, completed) { printed = Buffer.from(payload); completed(); }
    end(completed) { completed(); }
  }
  await loadWorkerExports({ Socket }).sendToPrinterForTest(job, { host: "fixture-only", port: 9100 });
  return printed;
}

test("actual PIN bytes enlarge only the PIN and reach the same cutter position as working kitchen tickets", async () => {
  const printed = await actualPrintBytes(pinJob());
  assert.deepEqual(printed, Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x4d, 0, 0x1b, 0x20, 2, 0x1b, 0x61, 1, 0x1b, 0x45, 1]),
    Buffer.from("TAV. 12\n"),
    Buffer.from([0x1d, 0x21, 0x11]),
    Buffer.from("PIN: 0123\n"),
    Buffer.from([0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0, 0x1b, 0x4d, 1, 0x1b, 0x64, 5, 0x1d, 0x56, 0]),
  ]));
});

test("the longest PIN fits both 58 mm and 80 mm printer widths at double size", async () => {
  const bytes = await actualPrintBytes(pinJob("ABCDEFGHIJKLMNOPQRST", "001234"));
  const pinStart = bytes.indexOf(Buffer.from("PIN: 001234\n"));
  assert.ok(pinStart > 0);
  assert.deepEqual(bytes.subarray(pinStart - 3, pinStart), Buffer.from([0x1d, 0x21, 0x11]));
  // Font A is 12 dots plus the explicit 2-dot spacing, both doubled by GS !.
  const pinWidthDots = "PIN: 001234".length * (12 + 2) * 2;
  for (const printableWidthDots of [384, 576]) assert.ok(pinWidthDots <= printableWidthDots);
  assert.equal(bytes.indexOf(Buffer.from("Never print this header")), -1);
  assert.equal(bytes.filter((byte) => byte === 0x0a).length, 2);
});

test("the desktop sends the complete PIN and cut sequence to its explicit TCP destination", { timeout: 5000 }, async () => {
  const net = require("node:net");
  let received;
  const receiving = new Promise((resolve, reject) => {
    received = { resolve, reject };
  });
  const server = net.createServer((socket) => {
    const chunks = [];
    socket.setTimeout(3000, () => socket.destroy(new Error("fixture socket timed out")));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => received.resolve(Buffer.concat(chunks)));
    socket.on("error", received.reject);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const [, bytes] = await Promise.all([
      loadWorkerExports().sendToPrinterForTest(pinJob(), { host: "127.0.0.1", port: server.address().port }),
      receiving,
    ]);
    assert.deepEqual(bytes, await actualPrintBytes(pinJob()));
    assert.deepEqual(bytes.subarray(-6), Buffer.from([0x1b, 0x64, 5, 0x1d, 0x56, 0]));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("ordinary kitchen transport keeps its existing five-line feed and cut", async () => {
  const printed = await actualPrintBytes({ department: "sushi", payload: { items: [{ name: "Nigiri", quantity: 1 }] } });
  assert.deepEqual(printed.subarray(-6), Buffer.from([0x1b, 0x64, 5, 0x1d, 0x56, 0]));
  assert.match(printed.toString(), /COMANDA SUSHI/);
});

test("a kitchen department named pin remains a food ticket on its kitchen printer", async () => {
  const job = { department: "pin", order_id: "food-order", payload: { department: "pin", items: [{ name: "Nigiri", quantity: 1 }] } };
  const printed = await actualPrintBytes(job);
  assert.match(printed.toString(), /COMANDA PIN/);
  assert.match(printed.toString(), /1x Nigiri/);
  assert.deepEqual(printed.subarray(-6), Buffer.from([0x1b, 0x64, 5, 0x1d, 0x56, 0]));
  const kitchen = { id: "kitchen", host: "kitchen", port: 9100, enabled: true };
  const routes = { byId: new Map([["kitchen", kitchen]]), byDepartment: new Map([["pin", kitchen]]), pinPrinterId: "cash" };
  assert.equal(loadWorkerExports().resolveRouteForTest(job, routes)?.id, "kitchen");
});

test("PIN routing uses only the currently configured printer even if automatic printing is off", () => {
  const resolve = loadWorkerExports().resolveRouteForTest;
  const cash = { id: "cash", host: "current-cash", port: 9101, enabled: true };
  const bar = { id: "bar", host: "bar", port: 9100, enabled: true };
  const routes = { byId: new Map([["cash", cash], ["bar", bar]]), byDepartment: new Map([["pin", bar]]), defaultPrinterId: "bar", pinPrinterId: "cash" };
  assert.equal(resolve(pinJob(), routes)?.host, "current-cash");
  assert.equal(resolve(pinJob(), routes)?.port, 9101);
  for (const unavailable of [
    null,
    { ...routes, pinPrinterId: "bar" },
    { ...routes, pinPrinterId: null },
    { ...routes, byId: new Map([["bar", bar]]) },
    { ...routes, byId: new Map([["cash", { ...cash, enabled: false }]]) },
    { ...routes, byId: new Map([["cash", { ...cash, host: "" }]]) },
  ]) assert.equal(resolve(pinJob(), unavailable), null);
  assert.equal(resolve({ ...pinJob(), route: { host: "snapshot-without-id" } }, routes), null);
});

test("live PIN routing reads the top-level PIN printer independently of the automatic toggle", async () => {
  const fetchRoutes = loadWorkerExports().fetchLiveRoutesForTest;
  const routes = await fetchRoutes.call({ ensureSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
    data: { settings: { pin_slip_printing: { enabled: false, printer_id: "cash" }, printing: { printers: [{ id: "cash", host: "cash-host" }] } } }, error: null,
  }) }) }) }) }) }, "fixture-restaurant");
  assert.equal(routes.pinPrinterId, "cash");
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

test("legacy physical receipt evidence cannot acknowledge fiscal success after restart", async () => withJournal(async ({ LocalPrintJournal, deliverPrintJob }, filename) => {
  const receipt = { ...operation, queue: "physical" };
  await new LocalPrintJournal(filename).set(receipt, "sent", undefined, "RT-fixture-123");
  const stored = (await new LocalPrintJournal(filename).list())[0];
  assert.equal(stored.queue, "physical");
  assert.equal(stored.receiptId, "RT-fixture-123");
  let sends = 0;
  await deliverPrintJob(new LocalPrintJournal(filename), receipt, async () => { sends++; }, async (success, error, meta) => {
    assert.equal(success, false);
    assert.match(error, /^DELIVERY_UNCERTAIN:/);
    assert.equal(meta.delivery_state, "uncertain");
    assert.equal(meta.receipt_id, undefined);
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


test("kitchen product rows use readable Font A, normal weight/size and explicit spacing", () => {
  const payload = loadWorkerExports().escPosForTest('TAVOLO: 7\n3x Salmone Nigiri\n Nota: senza cetriolo\n2x California Roll');
  assert.ok(payload.includes(Buffer.from([0x1b,0x4d,0])));
  assert.ok(payload.includes(Buffer.from([0x1b,0x33,36])));
  // The table is prominent, but the product section is reset to regular text.
  const start=payload.indexOf(Buffer.from('3x Salmone'));
  assert.ok(start>0);
  const prefix=payload.subarray(0,start);
  assert.ok(prefix.lastIndexOf(Buffer.from([0x1b,0x45,0]))>prefix.lastIndexOf(Buffer.from([0x1b,0x45,1])));
  assert.ok(prefix.lastIndexOf(Buffer.from([0x1d,0x21,0]))>prefix.lastIndexOf(Buffer.from([0x1d,0x21,0x11])));
  assert.ok(!payload.subarray(start).includes(Buffer.from([0x1d,0x21,0x11])));
  assert.ok(payload.includes(Buffer.from('Nota: senza cetriolo')));
  assert.ok(payload.subarray(-6).equals(Buffer.from([0x1b,0x64,5,0x1d,0x56,0])));
});
