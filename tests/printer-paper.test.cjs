const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPrinterPaper, parsePaperInformation } = require('../electron-dist/printerPaper.cjs');

test('paper status requires its complete framed width response and a documented model', () => {
  assert.deepEqual(parsePaperInformation('TM-T70II', Buffer.from([0x3d, 0x6e, 0x42, 0])), { width_mm: 80, printable_dots: 576, model: 'TM-T70II', source: 'escpos' });
  assert.deepEqual(parsePaperInformation('TM-T70II', Buffer.from([0x3d, 0x42, 0])), { width_mm: 80, printable_dots: 576, model: 'TM-T70II', source: 'escpos' });
  assert.equal(parsePaperInformation('Generic 80', Buffer.from([0x3d, 0x6e, 0x42, 0])), null);
  for (const bytes of [[0x42], [0x3d, 0x6e, 0x42], [0x3d, 0x21, 0x42, 0], [0x3d, 0x6e, 0x02, 0], [0x3d, 0x6e, 0x7f, 0]]) {
    assert.equal(parsePaperInformation('TM-T70II', Buffer.from(bytes)), null);
  }
  assert.equal(parsePaperInformation('TM-T70', Buffer.from([0x3d, 0x6e, 0x43, 0])).printable_dots, 384);
  assert.equal(parsePaperInformation('TM-T70', Buffer.from([0x3d, 0x6e, 0x41, 0])).printable_dots, 360);
});

test('automatic paper detection uses read-only queries and never infers width from model alone', async () => {
  const calls = [];
  const exchange = async (_host, _port, query) => {
    calls.push([...query]);
    if (query[2] === 66) return Buffer.from('_EPSON\0');
    if (query[2] === 67) return Buffer.from('_TM-T70II\0');
    return Buffer.from([0x3d, 0x6e, 0x42, 0]);
  };
  assert.deepEqual(await detectPrinterPaper('192.168.68.101', 9100, exchange), { ok: true, paper: { width_mm: 80, printable_dots: 576, model: 'TM-T70II', source: 'escpos' } });
  assert.deepEqual(calls, [[29, 73, 66], [29, 73, 67], [29, 73, 110]]);
  const unknown = await detectPrinterPaper('192.168.68.101', 9100, async (_h, _p, q) => q[2] === 66 ? Buffer.from('_EPSON\0') : Buffer.from('_TM-T70II\0'));
  assert.equal(unknown.ok, false);
});

test('unsupported, malformed and unreachable printers retain manual selection', async () => {
  const generic = await detectPrinterPaper('192.168.68.101', 9100, async () => Buffer.from('_Generic\0'));
  assert.equal(generic.reason, 'UNSUPPORTED_PRINTER');
  assert.equal((await detectPrinterPaper('192.168.68.101', 9100, async () => { throw new Error('timeout'); })).reason, 'PAPER_NOT_DETECTED');
  let called = false;
  const invalid = await detectPrinterPaper('bad\nhost', 9100, async () => { called = true; });
  assert.equal(invalid.ok, false); assert.equal(called, false);
});
