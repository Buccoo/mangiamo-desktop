const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopPrintWorker } = require('../electron-dist/printWorker.cjs');
function fixture(rpc) {
 const worker=Object.create(DesktopPrintWorker.prototype);
 worker.serviceStartPromise=null;worker.serviceStartGeneration=0;
 worker.service={running:false,timer:null};worker.authState={restaurant:{id:'venue'}};
 worker.config={consumerId:'bridge'};worker.ensureSignedIn=async()=>{};
 worker.ensureSupabaseClient=()=>({rpc});worker.getPublicState=()=>({running:worker.service.running});
 worker.pushLog=()=>{};worker.broadcastState=()=>{};worker.heartbeatAgent=async()=>{};
 let ticks=0;worker.runTick=async()=>{ticks++};return {worker,ticks:()=>ticks};
}
test('no claim or paper before the server confirms startup review; concurrent starts share one request',async()=>{
 let finish;let calls=0;const {worker,ticks}=fixture(async(name,args)=>{calls++;assert.equal(name,'print_hold_startup_jobs');assert.deepEqual(args,{p_restaurant_id:'venue',p_consumer_id:'bridge'});return await new Promise(resolve=>finish=resolve)});
 const first=worker.startService();const second=worker.startService();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(ticks(),0);
 finish({data:{ok:true,held_count:3},error:null});await Promise.all([first,second]);assert.equal(ticks(),1);assert.equal(worker.service.running,true);
});
test('missing or failed startup review fails closed without claiming jobs',async()=>{
 for(const reply of [{data:null,error:null},{data:{ok:true,held_count:-1},error:null},{data:null,error:{message:'RPC missing'}}]){
 const {worker,ticks}=fixture(async()=>reply);await assert.rejects(worker.startService());assert.equal(ticks(),0);assert.equal(worker.service.running,false);
 }
});
test('stopping during startup does not revive the worker after the reply',async()=>{
 let finish;const {worker,ticks}=fixture(async()=>await new Promise(resolve=>finish=resolve));const pending=worker.startService();await new Promise(resolve=>setImmediate(resolve));await worker.stopService();finish({data:{ok:true,held_count:0},error:null});await pending;assert.equal(ticks(),0);assert.equal(worker.service.running,false);
});
test('a start invalidated by a session sync is retried instead of leaving the service silently stopped',async()=>{
 const finishers=[];let calls=0;const {worker,ticks}=fixture(async()=>{calls++;return await new Promise(resolve=>finishers.push(resolve))});
 const stale=worker.startService();await new Promise(resolve=>setImmediate(resolve));
 await worker.stopService(); // renderer session sync / restart race
 const fresh=worker.startService();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,2,'new start must issue its own review, not reuse the invalidated promise');
 finishers[0]({data:{ok:true,held_count:0},error:null});finishers[1]({data:{ok:true,held_count:0},error:null});
 await Promise.all([stale,fresh]);assert.equal(worker.service.running,true);assert.equal(ticks(),1);
});
test('watchdog restarts a stopped bridge with a saved session, but respects an explicit staff stop',async()=>{
 const {worker,ticks}=fixture(async()=>({data:{ok:true,held_count:0},error:null}));
 worker.config.autoStart=true;worker.savedSession={access_token:'a',refresh_token:'r'};worker.updatePaused=false;worker.recordDiagnostic=()=>{};
 await worker.ensureServiceRunning();assert.equal(worker.service.running,true);assert.equal(ticks(),1);
 await worker.stopService({byUser:true});await worker.ensureServiceRunning();assert.equal(worker.service.running,false,'staff stop is respected');
 await worker.startService();assert.equal(worker.service.running,true,'manual start clears the staff stop');
 await worker.stopService();await worker.ensureServiceRunning();assert.equal(worker.service.running,true,'non-staff stop is healed');
 worker.savedSession=null;await worker.stopService();await worker.ensureServiceRunning();assert.equal(worker.service.running,false,'logged-out bridge stays stopped');
});
test('watchdog keeps retrying after a failed start',async()=>{
 let fail=true;const {worker}=fixture(async()=>fail?{data:null,error:{message:'NETWORK_ERROR'}}:{data:{ok:true,held_count:0},error:null});
 worker.config.autoStart=true;worker.savedSession={access_token:'a',refresh_token:'r'};worker.updatePaused=false;let diag=0;worker.recordDiagnostic=()=>{diag++};
 await worker.ensureServiceRunning();assert.equal(worker.service.running,false);assert.equal(diag,1,'failure is recorded, not swallowed');
 fail=false;await worker.ensureServiceRunning();assert.equal(worker.service.running,true);
});
test('switching restaurant during startup cannot start printing in the new scope',async()=>{
 let finish;const {worker,ticks}=fixture(async()=>await new Promise(resolve=>finish=resolve));const pending=worker.startService();await new Promise(resolve=>setImmediate(resolve));worker.authState.restaurant={id:'other'};finish({data:{ok:true,held_count:0},error:null});await pending;assert.equal(ticks(),0);
});
