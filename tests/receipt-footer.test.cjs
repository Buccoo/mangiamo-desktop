const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderNonFiscalReceiptTicket } = require('../electron-dist/receiptTicket.cjs');
for (const render_mode of ['native', 'raster']) test(`multiline receipt footer (${render_mode})`, () => {
 const result = renderNonFiscalReceiptTicket({ restaurant_name: 'Fixture', total_amount: 0 }, { layout: { render_mode, footer: { visible: true, custom_text: 'Grazie!\r\nA presto\n\nArrivederci', show_non_fiscal_label: false } } });
 assert.deepEqual(result.lines.filter(line => line.type === 'footer').map(line => line.text.trim()), ['Grazie!', 'A presto', '', 'Arrivederci']);
});
