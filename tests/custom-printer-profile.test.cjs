const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../electron-dist/kitchenTicket.cjs');
const raw = { width: 80, printable_dots: 960, printer_profiles: { '192.168.68.101:9100': 'custom-kube-ii' } };

test('a detected CUSTOM profile is scoped to its exact endpoint, with safe width and native font metrics', () => {
  const custom = core.resolveKitchenPrinterLayout(raw, '192.168.68.101', 9100);
  assert.equal(custom.native_profile, 'custom-kube-ii');
  assert.equal(custom.printable_dots, 576);
  assert.deepEqual(core.ticketFontMetrics(custom, 'A'), { cell: 14, glyph: 24 });
  assert.deepEqual(core.ticketFontMetrics(custom, 'B'), { cell: 10, glyph: 24 });
  for (const [host, port] of [['192.168.68.102', 9100], ['192.168.68.101', 9101]]) {
    const other = core.resolveKitchenPrinterLayout(raw, host, port);
    assert.equal(other.native_profile, undefined);
    assert.deepEqual(core.ticketFontMetrics(other, 'A'), { cell: 12, glyph: 24 });
    assert.equal(other.printable_dots, 960);
    assert.ok(!Buffer.from(core.buildKitchenEscPos([], other)).includes(Buffer.from([27, 193, 1])));
  }
});

test('CUSTOM wrapping and separators use its physical cells; CPI is explicitly selected per ticket', () => {
  const layout = core.resolveKitchenPrinterLayout(raw, '192.168.68.101');
  const { lines } = core.renderKitchenTicketCore({ table_number: '5', items: [{ name: 'Sushi Assortito', quantity: 2, notes: 'senza aglio' }] }, { layout });
  for (const line of lines) {
    const metric = core.ticketFontMetrics(layout, line.font || layout.font);
    assert.ok(core.ticketTextColumns(line.text) * metric.cell * (line.size === 'double' ? 2 : 1) <= 576);
  }
  const bytes = Buffer.from(core.buildKitchenEscPos(lines, layout));
  assert.ok(bytes.includes(Buffer.from([27, 193, 1])));
  assert.equal(lines.filter(line => line.type === 'separator').length, 3);
});

test('unrecognized profiles and malformed target keys are discarded; legacy layouts stay unchanged', () => {
  const layout = core.normalizeKitchenLayout({ printer_profiles: { 'fixture:9100': 'invented', '../bad:9100': 'custom-kube-ii' } });
  assert.equal(layout.printer_profiles, undefined);
  assert.equal(layout.native_profile, undefined);
});

test('Umaiya narrow-font items use the paper area rather than the wider base-font column count', () => {
  const layout = core.resolveKitchenPrinterLayout({ width: 42, printable_dots: 576, font: 'A', render_mode: 'native',
    printer_profiles: { 'fixture:9100': 'custom-kube-ii' },
    items: { size: 'double', show_guest_name: false }, styles: { items: { font: 'B', size: 'double', align: 'left' } },
  }, 'fixture');
  const result = core.renderKitchenTicketCore({ table_number: '5', items: [
    { quantity: 2, item_number: 1, name: 'Sushi Assortito' },
    { quantity: 1, item_number: 2, name: 'Gyoza Fritti', notes: 'senza aglio' },
  ] }, { layout });
  const titles = result.lines.filter(line => line.type === 'item');
  assert.deepEqual(titles.map(line => line.text), ['2x #1 Sushi Assortito', '1x #2 Gyoza Fritti']);
  assert.ok(titles.every(line => line.font === 'B' && line.size === 'double'));
  assert.ok(Buffer.from(core.buildKitchenEscPos(result.lines, layout)).includes(Buffer.from('2x #1 Sushi Assortito\n')));
});
