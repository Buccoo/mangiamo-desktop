const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const core = require('../electron-dist/kitchenTicket.cjs');

test('fast mode preserves dormant point sizes while selecting the native kitchen and receipt paths',async()=>{
 const payload={restaurant_name:'Fixture',table_number:'5',items:[{name:'Sushi',quantity:2}],total_amount:25,route:{host:'fixture-only'}};
 const layout=core.normalizeKitchenLayout({render_mode:'native',styles:{table:{size_pt:19.5},items:{size:'double',size_pt:13.5}}});
 assert.equal(layout.render_mode,'native');assert.equal(layout.styles.table.size_pt,19.5);
 const native=core.renderKitchenTicketCore(payload,{layout}).lines;
 assert.ok(native.every(line=>line.size_pt==null));
 assert.ok(native.some(line=>line.type==='item'&&line.size==='double'));
 const precise=core.renderKitchenTicketCore(payload,{layout:{...layout,render_mode:'raster'}}).lines;
 assert.ok(precise.some(line=>line.size_pt===19.5));
 const receiptCore=require('../electron-dist/receiptTicket.cjs');
 const receipt=receiptCore.normalizeReceiptLayout({render_mode:'native',sizes_pt:{total:22}});
 assert.equal(receipt.render_mode,'native');assert.equal(receipt.sizes_pt.total,22);
 assert.ok(receiptCore.renderNonFiscalReceiptTicket(payload,{layout:receipt}).lines.every(line=>line.size_pt==null));
 assert.ok(receiptCore.renderNonFiscalReceiptTicket(payload,{layout:{...receipt,render_mode:'raster'}}).lines.some(line=>line.size_pt===22));
 const bytes=await print({payload},receipt,'sendToNonFiscalReceiptPrinter');
 assert.equal(bytes.indexOf(Buffer.from([29,118,48])),-1);
});

test('explicit custom mode renders default sizes even before editing a point input',()=>{
 const lines=core.renderKitchenTicketCore({items:[{name:'Sushi',quantity:1}]},{layout:{render_mode:'raster'}}).lines;
 assert.ok(lines.some(line=>line.size_pt!=null));
});

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
test('separate category sheets reach the printer in one write, each with its own cut', async () => {
  const items = [
    { name: 'URA CALIFORNIA ROLL 4PZ', quantity: 1, item_number: 209, category_id: 'ura', category_name: 'Uramaki', category_sort_order: 2 },
    { name: 'SASHIMI SALMONE 4PZ', quantity: 1, item_number: 300, category_id: 'sas', category_name: 'Sashimi', category_sort_order: 1 },
  ];
  const job = { id: 'job', department: 'sushi 1', created_at: '2026-11-20T19:00:00Z', payload: { table_number: '7', department: 'sushi 1', items } };
  const split = await print(job, { render_mode: 'native', items: { split_departments: ['sushi 1'] } });
  const text = split.toString('latin1');
  assert.equal(text.split('\x1dV\x00').length - 1, 2);
  assert.ok(text.indexOf('SASHIMI SALMONE') < text.indexOf('\x1dV\x00') && text.indexOf('\x1dV\x00') < text.indexOf('URA CALIFORNIA'));
  assert.equal((text.match(/Tavolo: 7/g) || []).length, 2);
  const together = await print(job, { render_mode: 'native' });
  assert.equal(together.toString('latin1').split('\x1dV\x00').length - 1, 1);
});

test('translated kitchen names: fetched for the configured department, menu names when unavailable', async () => {
  const filename = path.join(__dirname, '../electron-dist/printWorker.cjs');
  const { DesktopPrintWorker } = require(filename);
  const layout = { items: { translated_names: { 'cucina 1': { language: 'zh', keep_original: true } } } };
  const id = '9ac07cc3-826b-4fe5-834a-40d72fd430f1';
  const job = { id: 'job', department: 'cucina 1', created_at: '2026-11-20T19:00:00Z', payload: { department: 'cucina 1', items: [{ name: 'SPAGHETTI DI SOIA MANZO', quantity: 1, menu_item_id: id }] } };
  const worker = Object.create(DesktopPrintWorker.prototype);
  let queried = null; worker.pushLog = () => {};
  worker.ensureSupabaseClient = () => ({ from: table => ({ select: () => ({ in: async (_column, ids) => { queried = { table, ids }; return { data: [{ id, translations: { zh: { name: '牛肉粉丝' } } }], error: null }; } }) }) });
  const enriched = await worker.withMenuTranslations(job, layout);
  assert.deepEqual(queried, { table: 'menu_items', ids: [id] });
  assert.equal(enriched.payload.items[0].translations.zh.name, '牛肉粉丝');
  assert.match(core.renderKitchenTicketCore(enriched.payload, { layout: { ...layout, render_mode: 'raster' } }).text, /SPAGHETTI DI SOIA MANZO\n牛肉粉丝/);
  worker.ensureSupabaseClient = () => ({ from: () => ({ select: () => ({ in: async () => ({ data: null, error: new Error('offline') }) }) }) });
  assert.equal(await worker.withMenuTranslations(job, layout), job, 'failure prints the menu names');
  queried = null;
  worker.ensureSupabaseClient = () => ({ from: table => ({ select: () => ({ in: async () => { queried = table; return { data: [], error: null }; } }) }) });
  const bar = { ...job, department: 'bar', payload: { ...job.payload, department: 'bar' } };
  assert.equal(await worker.withMenuTranslations(bar, layout), bar, 'other departments keep the payload');
  assert.equal(queried, null, 'no lookup for departments without translated names');
});

const sample = { table_number: '5', restaurant_name: 'Fixture', order_number: 7, department: 'cucina', created_at: '2026-10-29T10:00:00Z', items: [
  { name: 'Sushi Assortito', quantity: 2, item_number: 1, guest_name: 'Marco' },
  { name: 'Gyoza Fritti', quantity: 1, item_number: 2, notes: 'senza aglio', modifiers: [{ name: 'Wasabi', modifier_type: 'remove' }] },
] };

test('receipt extras reach the actual native socket with quantities, prices and one cut', async () => {
  const payload={restaurant_name:'Fixture',table_number:'5',payment_scope:'full_total',ayce_total:45,cover_total:5,extras_total:11,total_amount:61,route:{host:'fixture-only'},extra_items:[{name:'Acqua',quantity:2,unit_price:3,line_total:6},{name:'Budino',quantity:1,unit_price:5,line_total:5}]};
  const bytes=await print({payload},{render_mode:'native'},'sendToNonFiscalReceiptPrinter');
  assert.match(bytes.toString(),/2x Acqua/);assert.match(bytes.toString(),/1x Budino/);
  assert.match(bytes.toString(),/EUR 61,00/);assert.match(bytes.toString(),/EUR 6,00/);
  assert.equal(bytes.indexOf(Buffer.from([29,118,48])),-1);
  assert.equal(bytes.toString('latin1').split('\x1dV\x00').length-1,1);
});

test('paid lunch tariff quantities, covers and partial residue reach the native transport without unpaid desserts', async () => {
  const payload = { restaurant_name: 'Fixture', table_number: '23', payment_scope: 'selected_items', ayce_total: 55.6, cover_total: 16, extras_total: 2.6, total_amount: 74.2, route: { host: 'fixture-only' },
    receipt_breakdown: { version: 1, ayce_items: [{ id: 'standard', name: 'Menu pranzo', quantity: 2, unit_price: 17.9, line_total: 35.8 }, { id: 'baby', name: 'Baby', quantity: 2, unit_price: 9.9, line_total: 19.8 }, { id: 'cover_only', name: 'Solo coperto', quantity: 1, unit_price: 0, line_total: 0 }], cover_item: { name: 'Coperto', quantity: 8, unit_price: 2, line_total: 16 }, amount_due_after: 76.9 },
    extra_items: [{ name: 'ACQUA FRIZZANTE', quantity: 1, unit_price: 2.6, line_total: 2.6 }] };
  const bytes = await print({ payload }, { render_mode: 'native' }, 'sendToNonFiscalReceiptPrinter');
  for (const text of ['PAGAMENTO PARZIALE', '2x Menu pranzo', '2x Baby', '8x Coperto', '(EUR 17,90)', 'EUR 74,20', 'EUR 76,90']) assert.ok(bytes.toString().includes(text), text);
  assert.doesNotMatch(bytes.toString(), /DORAYAKI|TARTUFO/);
  assert.equal(bytes.toString('latin1').split('\x1dV\x00').length - 1, 1);
});

test('a sample print remains identifiable on paper with the optional header hidden', async () => {
  const layout = { render_mode: 'native', header: { visible: false } };
  const payload = { layout_test: true, layout: { receipt: layout }, restaurant_name: 'Fixture', total_amount: 61, route: { host: 'fixture-only' } };
  const bytes = await print({ payload }, layout, 'sendToNonFiscalReceiptPrinter');
  assert.match(bytes.toString(), /PROVA STAMPA/);
  assert.match(bytes.toString(), /DATI DI ESEMPIO/);
});

test('fast receipts use CUSTOM cells and absolute right-edge prices on the selected endpoint', async () => {
  const payload = { restaurant_name: 'Fixture', total_amount: 39.8, route: { host: 'fixture-only' } };
  const layout = { render_mode: 'native', width: 32, font: 'B', printable_dots: 576, printer_profiles: { 'fixture-only:9100': 'custom-kube-ii' } };
  const bytes = await print({ payload }, layout, 'sendToNonFiscalReceiptPrinter');
  assert.ok(bytes.includes(Buffer.from([27,193,1])), 'select documented CUSTOM CPI');
  const price = 'EUR 39,80', position = 576 - 8 - price.length * 10;
  assert.ok(bytes.includes(Buffer.concat([Buffer.from([27,36,position & 255,position >> 8]),Buffer.from(price)])), 'price ends at the printable right margin');
});

test('native-selected receipt extras with accents or Chinese use the exact shared graphic pixels', async () => {
  const receipt=require('../electron-dist/receiptTicket.cjs'),fonts=require('../electron-dist/ticketFonts.cjs');
  for(const name of ['Tiramisù','中文甜点']){
    const payload={restaurant_name:'Fixture',table_number:'5',extras_total:5,total_amount:5,route:{host:'fixture-only'},extra_items:[{name,quantity:1,unit_price:5,line_total:5}]};
    const layout=receipt.normalizeReceiptLayout({render_mode:'native',printable_dots:576,raster:{dpi:203,protocol:'gs-v0'}});
    const rendered=receipt.renderNonFiscalReceiptTicket(payload,{layout});
    assert.ok(rendered.lines.some(line=>line.size_pt!=null));
    const bytes=await print({payload},layout,'sendToNonFiscalReceiptPrinter');
    assert.deepEqual(bytes,fonts.buildPreciseTicket(rendered.lines,layout));
  }
});

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
test('long native text and controls stay within selected columns, including 2x rows', () => {
  for (const width of [32, 42, 48, 80]) {
    const result = core.renderKitchenTicketCore({ ...sample, items: [{ name: 'SUSHIASSORTITO'.repeat(12) + '\x1b@\x1dV0', quantity: 12, notes: 'N'.repeat(150) }] }, { layout: { width, items: { size: 'double' } } });
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


test('actual native-selected kitchen transport sends mixed Chinese text as bundled-font graphics', async () => {
  const fonts = require('../electron-dist/ticketFonts.cjs');
  const payload = { ...sample, items: [{ name: 'SPAGHETTI DI SOIA CON GAMBERI 虾仁粉丝', quantity: 1, item_number: 62, notes: 'No uova' }] };
  const layout = { render_mode: 'native', printable_dots: 576, styles: { items: { size_pt: 16 } } };
  const lines = core.renderKitchenTicketCore(payload, { layout }).lines;
  const bytes = await print({ payload }, layout);
  assert.deepEqual(bytes, fonts.buildPreciseTicket(lines, layout));
  assert.ok(bytes.includes(Buffer.from([29,118,48,0])));
});

test('dish number formats reach the real Desktop socket without a physical printer', async () => {
 const payload={restaurant_name:'UMAIYA',table_number:'5',items:[{name:'GUNKAN CETRIOLI EBI 2PZ',quantity:1,item_number:241}],route:{host:'fixture-only'}};
 for(const [style,expected] of [[undefined,'1x (241)'],['parentheses','1x (241)'],['hash','1x #241'],['plain','1x 241']]) {
  const layout=core.normalizeKitchenLayout({render_mode:'native',items:{item_number_style:style}});
  const bytes=await print({payload},layout);
  assert.ok(bytes.includes(Buffer.from(expected+' GUNKAN CETRIOLI EBI 2PZ')));
  assert.equal(bytes.subarray(-3).toString('hex'),'1d5600');
 }
});

test('custom category sheet groups (split_groups) split payloads on Desktop', () => {
 const barPayload = {
  table_number: '12',
  department: 'bar',
  items: [
   { name: 'Acqua', quantity: 1, category_id: 'c1', category_name: 'Acqua', category_sort_order: 1 },
   { name: 'Birra', quantity: 1, category_id: 'c2', category_name: 'Birre', category_sort_order: 2 },
   { name: 'Vino', quantity: 1, category_id: 'c3', category_name: 'Vini', category_sort_order: 3 },
   { name: 'Salsa', quantity: 1, category_id: 'c4', category_name: 'Salse', category_sort_order: 4 },
  ],
 };
 const togetherSheets = core.splitKitchenTicketPayload(barPayload, { items: { split_groups: { bar: { groups: [['Salse']], rest: 'together' } } } });
 assert.equal(togetherSheets.length, 2);
 assert.deepEqual(togetherSheets[0].items.map(i => i.name), ['Salsa']);
 assert.deepEqual(togetherSheets[1].items.map(i => i.name), ['Acqua', 'Birra', 'Vino']);
 const separateSheets = core.splitKitchenTicketPayload(barPayload, { items: { split_groups: { bar: { groups: [['Birre', 'Vini']], rest: 'separate' } } } });
 assert.equal(separateSheets.length, 3);
 assert.deepEqual(separateSheets[0].items.map(i => i.name), ['Birra', 'Vino']);
 assert.deepEqual(separateSheets[1].items.map(i => i.name), ['Acqua']);
 assert.deepEqual(separateSheets[2].items.map(i => i.name), ['Salsa']);
});
