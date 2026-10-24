const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
function renderer(netOverride) {
  const filename = path.join(__dirname, '../electron-dist/printWorker.cjs');
  const module = { exports: {} };
  const actualRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.renderTest=renderTicket;module.exports.sendTest=DesktopPrintWorker.prototype.sendToPrinter;', {
    module, exports: module.exports, require: name => name === 'node:net' && netOverride ? netOverride : actualRequire(name), Buffer, process, __dirname: path.dirname(filename), setTimeout, clearTimeout,
  });
  return module.exports;
}
test('real desktop renderer honors saved kitchen label, footer and hidden metadata', () => {
  const worker = renderer();
  const job = { payload: { table_number: '8', restaurant_name: 'Locale', order_number: 7, items: [{ name: 'Riso', quantity: 2, notes: 'senza sale' }] }, department: 'cucina' };
  const layout = { table: { label: 'POSTAZIONE', size: 'normal' }, items: { size: 'normal', bold: false, show_notes: false }, header: { visible: false }, footer: { custom_text: 'Buon lavoro', show_restaurant_name: false, show_timestamp: false } };
  const text = worker.renderTest(job, layout);
  assert.match(text, /POSTAZIONE: 8/);
  assert.match(text, /Buon lavoro/);
  assert.doesNotMatch(text, /COMANDA|senza sale|Locale/);
});

test('actual desktop wire uses the chosen alignment, font and size, including payload fallback', async () => {
  for (const align of ['left', 'center', 'right']) {
    for (const font of ['A', 'B']) {
      for (const fromPayload of [false, true]) {
        let printed;
        class Socket extends EventEmitter {
          setNoDelay() {} setTimeout() {} destroy() {}
          connect(_port, _host, connected) { connected(); }
          write(payload, completed) { printed = Buffer.from(payload); completed(); }
          end(completed) { completed(); }
        }
        const layout = { align, font, header: { visible: false }, table: { label: 'POSTAZIONE', size: 'normal', bold: false }, items: { size: 'normal', bold: false, show_notes: false }, footer: { custom_text: 'Buon lavoro', show_timestamp: false, show_restaurant_name: false } };
        const job = { department: 'cucina', payload: { table_number: '8', items: [{ name: 'Riso', quantity: 2, notes: 'senza sale' }], ...(fromPayload ? { layout: { kitchen: layout } } : {}) } };
        await renderer({ Socket }).sendTest(job, { host: 'fixture-only', port: 9100 }, undefined, fromPayload ? undefined : layout);
        assert.deepEqual(printed.subarray(0, 5), Buffer.from([27, 64, 27, 77, font === 'A' ? 0 : 1]));
        assert.ok(printed.includes(Buffer.concat([Buffer.from([27, 97, ['left', 'center', 'right'].indexOf(align), 27, 69, 0, 29, 33, 0]), Buffer.from('POSTAZIONE: 8\n')])));
        assert.ok(printed.includes(Buffer.from('Buon lavoro')));
        assert.equal(printed.includes(Buffer.from('senza sale')), false);
        assert.equal(printed.includes(Buffer.from([29, 33, 17])), false);
        assert.deepEqual(printed.subarray(-6), Buffer.from([27, 100, 5, 29, 86, 0]));
      }
    }
  }
});
