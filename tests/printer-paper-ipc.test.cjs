const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('preload exposes paper detection through the existing printer namespace', async () => {
  let api;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron-dist/preload.cjs'), 'utf8'), {
    process: { argv: [] }, Buffer,
    require: name => {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (name, value) => { if (name === 'desktopShell') api = value; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); return { ok: false, reason: 'UNSUPPORTED_PRINTER' }; } } };
    },
  });
  const result = await api.printer.detectPaper({ host: '192.168.68.101', port: 9100 });
  assert.equal(result.reason, 'UNSUPPORTED_PRINTER');
  assert.deepEqual(calls, [['desktop:printer:detect-paper', { host: '192.168.68.101', port: 9100 }]]);
});

