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

test('numeric point styles preserve unwrapped semantic text for the raster renderer and reject invalid values', () => {
  const layout = core.normalizeKitchenLayout({ styles: { items: { size_pt: 13.5 }, table: { size_pt: 22 }, notes: { size_pt: 0 } }, raster: { dpi: 300, protocol: 'esc-star' } });
  assert.equal(layout.styles.items.size_pt, 13.5);
  assert.equal(layout.styles.table.size_pt, 22);
  assert.equal(layout.styles.notes, undefined);
  assert.deepEqual(layout.raster, { dpi: 300, protocol: 'esc-star' });
  const text = 'GAMBERI VIOLA DI GALLIPOLI '.repeat(4).trim();
  const rendered = core.renderKitchenTicketCore({ ...sample, items: [{ name: text, quantity: 1 }] }, { layout });
  assert.equal(rendered.lines.filter(line => line.type === 'item').length, 1);
  assert.equal(rendered.lines.find(line => line.type === 'item').text, '1x '+text);
  assert.equal(rendered.lines.find(line => line.type === 'item').size_pt, 13.5);
  assert.equal(core.normalizeKitchenLayout({styles:{items:{size_pt:Infinity}}}).styles, undefined);
});

test('actual numeric-point kitchen and receipt transports emit the exact shared raster pixels', async () => {
  const fonts=require('../electron-dist/ticketFonts.cjs');
  const layout={styles:{items:{size_pt:13.5},table:{size_pt:22}},raster:{dpi:203,protocol:'gs-v0'},printable_dots:576};
  const normalized=core.resolveKitchenPrinterLayout(layout,'fixture-only');
  const bytes=await print({department:'cucina',payload:sample},layout);
  assert.deepEqual(bytes,fonts.buildPreciseTicket(core.renderKitchenTicketCore(sample,{layout:normalized}).lines,normalized));
  const receiptCore=require('../electron-dist/receiptTicket.cjs');
  const receiptLayout=receiptCore.normalizeReceiptLayout({sizes_pt:{header:12,total:20},printable_dots:384,raster:{dpi:203,protocol:'gs-v0'}});
  assert.equal(receiptLayout.sizes_pt.total,20);
  const payload={restaurant_name:'Fixture',table_number:'5',paid_at:'2026-11-09T12:00:00Z',total_amount:25,route:{host:'fixture-only'}};
  const receiptBytes=await print({payload},receiptLayout,'sendToNonFiscalReceiptPrinter');
  const lines=receiptCore.renderNonFiscalReceiptTicket(payload,{layout:receiptLayout}).lines;
  assert.ok(lines.some(line=>line.size_pt===20));
  assert.deepEqual(receiptBytes,fonts.buildPreciseTicket(lines,receiptLayout));
});

test('a receipt layout test uses detected destination geometry for physical point size',async()=>{
 const receiptCore=require('../electron-dist/receiptTicket.cjs'),fonts=require('../electron-dist/ticketFonts.cjs');
 const raw={sizes_pt:{total:18},printable_dots:960,raster:{dpi:300,protocol:'gs-v0'}};
 const receipt=receiptCore.normalizeReceiptLayout({...raw,printable_dots:576,raster:{dpi:203,protocol:'gs-v0'}});
 const payload={restaurant_name:'Fixture',table_number:'5',paid_at:'2026-11-09T12:00:00Z',total_amount:25,route:{host:'fixture-only'},layout_test:true,layout:{receipt:raw,kitchen:{printer_profiles:{'fixture-only:9100':'custom-kube-ii'}}}};
 const bytes=await print({payload},raw,'sendToNonFiscalReceiptPrinter');
 assert.deepEqual(bytes,fonts.buildPreciseTicket(receiptCore.renderNonFiscalReceiptTicket(payload,{layout:receipt}).lines,receipt));
});

test('actual transport resolves CUSTOM metrics for its endpoint and leaves other printers native', async () => {
  const layout = { width: 80, printable_dots: 960, printer_profiles: { 'fixture-only:9100': 'custom-kube-ii' } };
  const resolved = core.resolveKitchenPrinterLayout(layout, 'fixture-only');
  const bytes = await print({ department: 'cucina', payload: sample }, layout);
  assert.deepEqual(bytes, Buffer.from(core.buildKitchenEscPos(core.renderKitchenTicketCore(sample, { layout: resolved }).lines, resolved)));
  assert.ok(bytes.includes(Buffer.from([27, 193, 1])));
  const other = await print({ department: 'cucina', payload: sample }, { ...layout, printer_profiles: { 'other:9100': 'custom-kube-ii' } });
  assert.ok(!other.includes(Buffer.from([27, 193, 1])));
});

test('a CUSTOM layout-test snapshot keeps its resolved endpoint profile for both wrapping and transport', async () => {
  const layout = { width: 80, printable_dots: 960, printer_profiles: { 'fixture-only:9100': 'custom-kube-ii' } };
  const payload = { ...sample, items: [{ name: 'Sushi Assortito Gyoza Fritti Gamberi Viola di Gallipoli', quantity: 2 }], layout_test: true, layout: { kitchen: layout } };
  const resolved = core.resolveKitchenPrinterLayout(layout, 'fixture-only');
  const bytes = await print({ department: 'cucina', payload }, { width: 32, printable_dots: 384 });
  assert.deepEqual(bytes, Buffer.from(core.buildKitchenEscPos(core.renderKitchenTicketCore(payload, { layout: resolved }).lines, resolved)));
});

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

test('font changes retain the paper center and wrapping never exceeds the chosen head', () => {
  for(const dots of [384,512,576,960]) for(const font of ['A','B']) {
    const layout=core.normalizeKitchenLayout({printable_dots:dots,font,width:80,items:{size:'double'}});
    assert.equal(layout.printable_dots,dots);
    assert.ok(layout.width * (font==='A'?12:9) <= dots);
    const result=core.renderKitchenTicketCore(sample,{layout});
    const bytes=Buffer.from(core.buildKitchenEscPos(result.lines,layout));
    assert.ok(bytes.includes(Buffer.from([29,87,dots & 255,dots >> 8])));
    assert.ok(result.lines.every(line=>line.align==='center'));
    assert.ok(result.lines.every(line=>core.ticketTextColumns(line.text)*(line.size==='double'?2:1)*(font==='A'?12:9)<=dots));
  }
});

test('actual transport emits selected row styles and block order with attached item details', async () => {
  const layout = { width: 48, font: 'B', printable_dots: 384,
    block_order: ['items', 'table', 'header', 'timestamp', 'footer'],
    styles: { items: { font: 'A', size: 'double', bold: true, align: 'right', space_after: 1 }, notes: { font: 'B', size: 'normal', bold: true, align: 'left' } } };
  const bytes = await print({ payload: sample }, layout);
  assert.ok(bytes.includes(Buffer.from([27,77,0,27,97,2,27,69,1,29,33,17,27,51,56])));
  assert.ok(bytes.includes(Buffer.from([27,77,1,27,97,0,27,69,1,29,33,0,27,51,36])));
  const text = bytes.toString();
  assert.ok(text.indexOf('Sushi') >= 0 && text.indexOf('Sushi') < text.indexOf('Tavolo: 5'));
  assert.ok(text.indexOf('Gyoza') >= 0 && text.indexOf('Ospite: Marco') < text.indexOf('Gyoza'));
  assert.ok(text.indexOf('Nota: senza aglio') < text.indexOf('Tavolo: 5'));
  assert.deepEqual(bytes.subarray(-20), Buffer.from([27,69,0,29,33,0,27,97,0,27,77,0,27,50,27,100,5,29,86,0]));
});

test('180dpi 58mm heads use finite 30-column A geometry', () => {
  const layout = core.normalizeKitchenLayout({ printable_dots: 360, width: 80, font: 'A' });
  assert.equal(layout.width, 30);
  assert.equal(layout.printable_dots, 360);
  for (const line of core.renderKitchenTicketCore(sample, { layout }).lines)
    assert.ok(core.ticketTextColumns(line.text) * (line.font === 'B' ? 9 : 12) * (line.size === 'double' ? 2 : 1) <= 360);
});
