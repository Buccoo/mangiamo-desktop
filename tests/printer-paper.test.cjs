const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPrinterPaper, parsePaperInformation, parseCustomPrinterPages } = require('../electron-dist/printerPaper.cjs');

const customIndex = '<html><title>KUBE II ETH PRINTER - CUSTOM ENGINEERING</title><frame src="info.htm"></html>';
const customInfo = '<script>Tab("Printer Model:","KUBE II ETH");Tab("Firmware Version:","1.34");</script>';

test('recognizes actual CUSTOM identity but labels its conservative geometry as a model profile', () => {
  assert.deepEqual(parseCustomPrinterPages(customIndex, customInfo), {
    width_mm: 80, printable_dots: 576, model: 'CUSTOM KUBE II ETH', source: 'model-profile',
    native_profile: 'custom-kube-ii', dpi: 203, firmware: '1.34',
  });
  for (const [index, info] of [
    ['<title>Other printer</title>', customInfo],
    [customIndex, '<script>Tab("Printer Model:","KUBE II SCANNER");</script>'],
    [customIndex, '<form>Password:<input type="password"></form>'],
    [customIndex, '<script>Tab("Printer Model:",getModel());</script>'],
  ]) assert.equal(parseCustomPrinterPages(index, info), null);
});

test('CUSTOM detection reads fixed information pages only and sends no raw printer bytes', async () => {
  const pages = [], queries = [];
  const result = await detectPrinterPaper('192.168.68.101', 9100,
    async (...args) => { queries.push(args); throw Error('no raw probes expected'); },
    async (_host, page) => { pages.push(page); return page === '/' ? customIndex : customInfo; });
  assert.equal(result.ok, true);
  assert.equal(result.paper.source, 'model-profile');
  assert.deepEqual(pages, ['/', '/info.htm']);
  assert.equal(queries.length, 0);
});

test('a confirmed CUSTOM web identity with unavailable details never sends unsupported Epson query codes', async () => {
  let rawQueries = 0;
  const result = await detectPrinterPaper('fixture', 9100, async () => { rawQueries++; return Buffer.from('_EPSON\0'); }, async (_host, page) => {
    if (page === '/') return customIndex;
    throw Error('info unavailable');
  });
  assert.equal(result.ok, false);
  assert.equal(rawQueries, 0);
});

test('a web page failure falls back to documented Epson queries; other raw ports never borrow a web identity', async () => {
  const exchange = async (_h, _p, query) => query[2] === 66 ? Buffer.from('_EPSON\0') : query[2] === 67 ? Buffer.from('_TM-T70II\0') : Buffer.from([0x3d, 0x42, 0]);
  assert.equal((await detectPrinterPaper('fixture', 9100, exchange, async () => { throw Error('HTTP timeout'); })).paper.source, 'escpos');
  let pageReads = 0;
  const result = await detectPrinterPaper('fixture', 9101, async () => Buffer.from('_Unknown\0'), async () => { pageReads++; return customIndex; });
  assert.equal(result.ok, false);
  assert.equal(pageReads, 0);
});

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
