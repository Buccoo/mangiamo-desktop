const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const core = require('../electron-dist/kitchenTicket.cjs');

async function print(job, layout, method = 'sendToPrinter') {
  let bytes;
  class Socket extends EventEmitter {
    setNoDelay() {} setTimeout() {} destroy() {}
    connect(_port, _host, ready) { ready(); }
    write(payload, done) { bytes = Buffer.from(payload); done(); }
    end(done) { done(); }
  }
  const filename = path.join(__dirname, '../electron-dist/printWorker.cjs');
  const module = { exports: {} }, actual = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + `\nmodule.exports.send=DesktopPrintWorker.prototype.${method};`, {
    module, exports: module.exports, require: name => name === 'node:net' ? { Socket } : actual(name), Buffer, process, __dirname: path.dirname(filename), setTimeout, clearTimeout,
  });
  await module.exports.send(job, method === 'sendToPrinter' ? { host: 'fixture-only', port: 9100 } : layout, layout);
  return bytes;
}
const sample = { table_number: '5', restaurant_name: 'Fixture', order_number: 7, department: 'cucina', created_at: '2026-10-29T10:00:00Z', items: [
  { name: 'Sushi Assortito', quantity: 2, item_number: 1, guest_name: 'Marco' },
  { name: 'Gyoza Fritti', quantity: 1, item_number: 2, notes: 'senza aglio', modifiers: [{ name: 'Wasabi', modifier_type: 'remove' }] },
] };

test('actual transport honors Grande, font, alignment, footer and resets before cutting', async () => {
  for (const font of ['A', 'B']) for (const align of ['left', 'center', 'right']) for (const size of ['normal', 'double']) {
    const layout = { font, align, width: 32, items: { size, bold: true }, table: { label: 'POSTAZIONE' }, footer: { custom_text: 'Buon lavoro' } };
    const expected = core.renderKitchenTicketCore(sample, { layout });
    const bytes = await print({ department: 'cucina', payload: sample }, layout);
    assert.deepEqual(bytes, Buffer.from(core.buildKitchenEscPos(expected.lines, layout)));
    assert.ok(bytes.includes(Buffer.from([27, 77, font === 'A' ? 0 : 1])));
    assert.ok(bytes.includes(Buffer.from('Buon lavoro')));
    assert.deepEqual(bytes.subarray(-6), Buffer.from([27, 100, 5, 29, 86, 0]));
    assert.equal(expected.lines.filter(line => line.type === 'item').every(line => line.size === size && line.bold && line.align === align), true);
  }
});
test('test snapshot matches the preview even if a later live layout differs', async () => {
  const chosen = { items: { size: 'double', bold: true }, font: 'B' };
  const bytes = await print({ payload: { ...sample, layout_test: true, layout: { kitchen: chosen } } }, { items: { size: 'normal' }, font: 'A' });
  assert.deepEqual(bytes, Buffer.from(core.buildKitchenEscPos(core.renderKitchenTicketCore(sample, { layout: chosen }).lines, chosen)));
});
test('ordinary orders use the live layout rather than an obsolete payload snapshot', async () => {
  const live = { items: { size: 'double' }, font: 'A' };
  const bytes = await print({ payload: { ...sample, layout: { kitchen: { font: 'B' } } } }, live);
  assert.deepEqual(bytes, Buffer.from(core.buildKitchenEscPos(core.renderKitchenTicketCore(sample, { layout: live }).lines, live)));
});
test('long text, controls and CJK stay within selected columns, including 2x rows', () => {
  for (const width of [32, 42, 48, 80]) {
    const result = core.renderKitchenTicketCore({ ...sample, items: [{ name: '三文鱼寿司拼盘'.repeat(12) + '\x1b@\x1dV0', quantity: 12, notes: 'N'.repeat(150) }] }, { layout: { width, items: { size: 'double' } } });
    for (const line of result.lines) {
      assert.ok(core.ticketTextColumns(line.text) <= width / (line.size === 'double' ? 2 : 1));
      assert.doesNotMatch(line.text, /[\x00-\x1f]/);
    }
    const bytes = Buffer.from(core.buildKitchenEscPos(result.lines, { width }));
    assert.equal(bytes.indexOf(Buffer.from([27,64]), 2), -1);
  }
});
test('hidden options omit metadata and leave only the chosen kitchen content', async () => {
  const layout = { header: { visible: false }, table: { visible: false }, items: { show_notes: false, show_guest_name: false, show_quantity: false, show_item_number: false }, footer: { visible: false } };
  const bytes = await print({ payload: sample }, layout);
  const text = bytes.toString();
  assert.doesNotMatch(text, /COMANDA|Tavolo|Marco|senza aglio|Fixture|#1|2x/);
  assert.match(text, /Sushi Assortito/);
  assert.match(text, /SENZA Wasabi/);
});
test('non-fiscal receipt uses the saved layout without changing fiscal transport', async () => {
  const layout = { width: 32, font: 'B', header: { show_restaurant_name: false }, table: { label: 'POSTAZIONE' }, items: { show_cover: false }, footer: { custom_text: 'Arrivederci' } };
  const payload = { restaurant_name: 'Fixture', table_number: '5', paid_at: sample.created_at, total_amount: 50, cover_total: 5, route: { host: 'fixture-only', port: 9100 } };
  const bytes = await print({ payload }, layout, 'sendToNonFiscalReceiptPrinter');
  assert.match(bytes.toString(), /POSTAZIONE: 5/);
  assert.match(bytes.toString(), /Arrivederci/);
  assert.doesNotMatch(bytes.toString(), /Fixture|Coperto/);
  assert.match(bytes.toString(), /NON FISCALE/);
});
