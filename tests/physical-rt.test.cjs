const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function physicalMethods(fetch) {
  const filename = path.join(__dirname, "../electron-dist/printWorker.cjs");
  const source = fs.readFileSync(filename, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source + `
    module.exports.post = DesktopPrintWorker.prototype.postPhysicalReceipt;
    module.exports.send = DesktopPrintWorker.prototype.sendToPhysicalReceiptDevice;
  `, {
    module, exports: module.exports, require: createRequire(filename), Buffer, process,
    __dirname: path.dirname(filename), fetch, AbortController, setTimeout, clearTimeout,
  });
  return module.exports;
}

const legacyPayload = {
  table_number: "12", total_amount: 43.5, payment_method: "cash",
};
const route = (brand) => ({ brand, host: "fixture-only.invalid", port: 8008, api_path: "/cgi-bin/fpmate.cgi" });

test("physical RT refuses unsupported brands before making any request", async () => {
  let requests = 0;
  const { post } = physicalMethods(async () => {
    requests++;
    return { ok: true, text: async () => '<response success="true" code="" status="2"/>' };
  });
  for (const brand of ["custom", "axon", "rch", "olivetti", "other", "", undefined]) {
    await assert.rejects(post(route(brand), legacyPayload), (error) => {
      assert.equal(error.constructor.name, "PrintNotSentError");
      assert.match(error.message, /PHYSICAL_RT_BRAND_UNSUPPORTED/);
      return true;
    });
  }
  assert.equal(requests, 0);
});

test("Epson total-only payload cannot choose a department or tax rate implicitly", async () => {
  let requests = 0;
  const { post } = physicalMethods(async () => {
    requests++;
    return { ok: true, text: async () => '<response success="true" code="" status="2"/>' };
  });
  await assert.rejects(post(route("epson"), legacyPayload), (error) => {
    assert.equal(error.constructor.name, "PrintNotSentError");
    assert.match(error.message, /PHYSICAL_RT_FISCAL_MAPPING_UNVERIFIED/);
    return true;
  });
  assert.equal(requests, 0);
});

test("self-declared payload flags cannot enable an unqualified Epson fiscal adapter", async () => {
  let requests = 0;
  const { post } = physicalMethods(async () => {
    requests++;
    return { ok: true, text: async () => '<response success="true" code="" status="2"><addInfo><fiscalReceiptNumber>42</fiscalReceiptNumber></addInfo></response>' };
  });
  await assert.rejects(post({ ...route("epson"), protocol: "epson_epos", mapping_verified: true }, {
    ...legacyPayload, fiscal_snapshot: { validated: true, department: 1, vat_code: 1 },
  }), /PHYSICAL_RT_FISCAL_MAPPING_UNVERIFIED/);
  assert.equal(requests, 0);
});

test("missing emission evidence never produces a locally invented fiscal identifier", async () => {
  const { send } = physicalMethods();
  for (const missingId of [null, undefined, "", " "]) {
    await assert.rejects(send.call({ postPhysicalReceipt: async () => missingId }, {
      id: "job-fixture-123", payload: { ...legacyPayload, route: route("epson") },
    }), /PHYSICAL_RT_EMISSION_UNPROVEN/);
  }
});

test("disabled fiscal transport acknowledges not_sent with no receipt ID or HTTP request", async () => {
  const { LocalPrintJournal, deliverPrintJob } = require("../electron-dist/printDelivery.cjs");
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "mangiamo-rt-test-"));
  let requests = 0;
  const methods = physicalMethods(async () => { requests++; throw new Error("fixture must not send"); });
  try {
    const journal = new LocalPrintJournal(path.join(directory, "journal.json"));
    let acknowledgement;
    const result = await deliverPrintJob(journal, {
      queue: "physical", jobId: "job-fixture", restaurantId: "restaurant-fixture", consumerId: "consumer-fixture",
    }, () => methods.send.call({ postPhysicalReceipt: methods.post }, {
      id: "job-fixture", payload: { ...legacyPayload, route: route("epson") },
    }), async (success, error, meta) => { acknowledgement = { success, error, meta }; });
    assert.equal(result, "not_sent");
    assert.equal(requests, 0);
    assert.equal(acknowledgement.success, false);
    assert.match(acknowledgement.error, /PHYSICAL_RT_FISCAL_MAPPING_UNVERIFIED/);
    assert.equal(acknowledgement.meta.delivery_state, "not_sent");
    assert.equal(acknowledgement.meta.receipt_id, undefined);
    assert.deepEqual(await journal.list(), []);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});
