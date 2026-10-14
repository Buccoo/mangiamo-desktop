const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const generator = process.env.MANGIAMO_RUNTIME_SCRIPT_FOR_TEST || path.join(__dirname,"../scripts/desktop/generate-runtime-config.mjs");
const jwt = (role) => `fixture.${Buffer.from(JSON.stringify({role})).toString("base64url")}.fixture`;

function generateWith(key, inspect) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"mangiamo-runtime-test-"));
  try {
    const result = spawnSync(process.execPath,[generator],{
      cwd:directory,encoding:"utf8",env:{...process.env,VITE_SUPABASE_URL:"https://fixture.supabase.co",VITE_SUPABASE_PUBLISHABLE_KEY:key,VITE_SUPABASE_ANON_KEY:key},
    });
    inspect(result,path.join(directory,"electron/runtime-config.json"));
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(directory,{recursive:true,force:true});
  }
}

test("runtime generation accepts only public publishable or anon keys",() => {
  for (const key of ["sb_publishable_fixture",jwt("anon")]) generateWith(key,(result,filename) => {
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(filename,"utf8")).VITE_SUPABASE_ANON_KEY,key);
  });
});

test("runtime generation rejects privileged keys before writing client configuration",() => {
  for (const key of ["sb_secret_fixture",jwt("service_role")]) generateWith(key,(result,filename) => {
    assert.notEqual(result.status,0,"privileged key must never enter a client build");
    assert.equal(fs.existsSync(filename),false);
    assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key));
  });
});
