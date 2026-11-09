const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const yaml=require('js-yaml');
const workflow=yaml.load(fs.readFileSync(path.join(__dirname,'../.github/workflows/build.yml'),'utf8'));
function allowed(expression,{event='workflow_dispatch',platform='all',ref='refs/tags/v1.5.51',windows='success',mac='success',release='success'}={}){
 assert.equal(typeof expression,'string','job must have an explicit platform/result guard');
 const source=expression.replace(/\$\{\{|\}\}/g,'').replace(/needs\.([a-z-]+)\.result/g,(_,job)=>`needs[${JSON.stringify(job)}].result`);
 return Boolean(new Function('github','inputs','needs','always','startsWith',`return (${source});`)({event_name:event,ref},{platform},{'build-windows':{result:windows},'build-mac':{result:mac},release:{result:release}},()=>true,(value,prefix)=>value.startsWith(prefix)));
}
test('manual dispatch offers all platforms by default and single-platform builds',()=>{
 const input=workflow.on.workflow_dispatch.inputs.platform;assert.equal(input.default,'all');assert.deepEqual(input.options,['all','windows','mac']);
 for(const platform of ['all','windows','mac']){
  assert.equal(allowed(workflow.jobs['build-windows'].if,{platform}),platform!=='mac');
  assert.equal(allowed(workflow.jobs['build-mac'].if,{platform}),platform!=='windows');
 }
 for(const name of ['build-windows','build-mac'])assert.equal(allowed(workflow.jobs[name].if,{event:'push',platform:undefined}),true);
});
test('public tag releases still require both platforms and never accept failed or cancelled jobs',()=>{
 const expression=workflow.jobs.release.if;
 assert.equal(allowed(expression),true);
 assert.equal(allowed(expression,{platform:'windows',mac:'skipped'}),false);
 assert.equal(allowed(expression,{platform:'mac',windows:'skipped'}),false);
 assert.equal(allowed(expression,{ref:'refs/heads/main'}),false);
 for(const result of ['failure','cancelled','skipped']) {
  assert.equal(allowed(expression,{event:'push',windows:result}),false);
  assert.equal(allowed(expression,{event:'push',mac:result}),false);
  assert.equal(allowed(expression,{platform:'windows',windows:result,mac:'skipped'}),false);
  assert.equal(allowed(expression,{platform:'mac',windows:'skipped',mac:result}),false);
 }
});
test('single-platform dispatch cannot publish a partial release or update the public feed',()=>{
 const proof=workflow.jobs.release.steps.find(step=>step.run?.includes('verify-release-artifacts.cjs'));
 assert.ok(proof,'every public release retains the packaged Windows proof gate');
 for(const platform of ['windows','mac']){
  const results=platform==='windows'?{platform,mac:'skipped'}:{platform,windows:'skipped'};
  assert.equal(allowed(workflow.jobs.release.if,results),false);
  assert.equal(allowed(workflow.jobs['update-feed'].if,{...results,release:'skipped'}),false);
 }
 assert.equal(allowed(workflow.jobs['update-feed'].if,{event:'push'}),true);
});
