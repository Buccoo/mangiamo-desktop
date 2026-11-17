const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const yaml=require('js-yaml');
const workflow=yaml.load(fs.readFileSync(path.join(__dirname,'../.github/workflows/build.yml'),'utf8'));
function allowed(expression,{event='workflow_dispatch',platform='all',ref='refs/tags/v1.5.51',windows='success',mac='success',release='success'}={}){
 assert.equal(typeof expression,'string','job must have an explicit platform/result guard');
 const source=expression.replace(/\$\{\{|\}\}/g,'').replace(/needs\.([a-z-]+)\.result/g,(_,job)=>`needs[${JSON.stringify(job)}].result`);
 return Boolean(new Function('github','inputs','needs','always','startsWith',`return (${source});`)({event_name:event,ref},{platform},{'build-windows':{result:windows},'build-mac':{result:mac},release:{result:release}},()=>true,(value,prefix)=>value.startsWith(prefix)));
}
test('manual dispatch offers all platforms by default and single-platform builds',()=>{
 const input=workflow.on.workflow_dispatch.inputs.platform;assert.equal(input.default,'windows');assert.deepEqual(input.options,['all','windows','mac']);
 for(const platform of ['all','windows','mac']){
  assert.equal(allowed(workflow.jobs['build-windows'].if,{platform}),platform!=='mac');
  assert.equal(allowed(workflow.jobs['build-mac'].if,{platform}),platform!=='windows');
 }
 assert.equal(allowed(workflow.jobs['build-windows'].if,{event:'push',platform:undefined}),true);
 assert.equal(allowed(workflow.jobs['build-mac'].if,{event:'push',platform:undefined}),false);
});
test('Windows releases allow paused Mac but reject failed or cancelled builds',()=>{
 const expression=workflow.jobs.release.if;
 assert.equal(allowed(expression),true);
 assert.equal(allowed(expression,{platform:'windows',mac:'skipped'}),true);
 assert.equal(allowed(expression,{platform:'mac',windows:'skipped'}),false);
 assert.equal(allowed(expression,{ref:'refs/heads/main',platform:'windows',mac:'skipped'}),true);
 for(const result of ['failure','cancelled','skipped']) {
  assert.equal(allowed(expression,{event:'push',windows:result}),false);
  assert.equal(allowed(expression,{event:'push',mac:result}),result==='skipped');
  assert.equal(allowed(expression,{platform:'windows',windows:result,mac:'skipped'}),false);
  assert.equal(allowed(expression,{platform:'mac',windows:'skipped',mac:result}),false);
 }
});
test('Windows-only releases retain startup proof before release and feed publication',()=>{
 const proof=workflow.jobs.release.steps.find(step=>step.run?.includes('verify-release-artifacts.cjs'));
 assert.ok(proof);
 assert.equal(allowed(workflow.jobs.release.if,{platform:'windows',mac:'skipped'}),true);
 assert.equal(allowed(workflow.jobs.release.if,{platform:'mac',windows:'skipped'}),false);
 assert.equal(allowed(workflow.jobs['update-feed'].if,{release:'success'}),true);
 for(const release of ['failure','cancelled','skipped'])assert.equal(allowed(workflow.jobs['update-feed'].if,{release}),false);
});
test('existing Windows artifacts require successful source build, unchanged code and matching installer proof',()=>{
 const reuse=yaml.load(fs.readFileSync(path.join(__dirname,'../.github/workflows/publish-windows.yml'),'utf8'));
 const steps=reuse.jobs['publish-windows'].steps;
 const guard=steps.find(step=>step.run?.includes('git diff --exit-code')).run;
 assert.ok(guard.includes('grep -qx success'));
 assert.ok(guard.includes('electron scripts assets package.json package-lock.json'));
 const verify=steps.findIndex(step=>step.run?.includes('verify-release-artifacts.cjs'));
 const release=steps.findIndex(step=>step.run?.includes('gh release create'));
 assert.ok(verify>=0&&verify<release);
 const publish=steps[release].run;
 assert.ok(publish.indexOf('--draft')<publish.indexOf('gh release upload'));
 assert.ok(publish.indexOf('gh release upload')<publish.indexOf('gh release edit'));
});

test('feed publication configures Git credentials for authenticated pull and push',()=>{
 const reuse=yaml.load(fs.readFileSync(path.join(__dirname,'../.github/workflows/publish-windows.yml'),'utf8'));
 for(const steps of [reuse.jobs['publish-windows'].steps,workflow.jobs['update-feed'].steps]) {
  const run=steps.find(step=>step.run?.includes('publish-desktop-updater.mjs')).run;
  assert.ok(run.indexOf('gh auth setup-git')>=0);
  assert.ok(run.indexOf('gh auth setup-git')<run.indexOf('git pull'));
 }
});
