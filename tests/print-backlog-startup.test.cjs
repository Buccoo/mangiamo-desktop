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
test('switching restaurant during startup cannot start printing in the new scope',async()=>{
 let finish;const {worker,ticks}=fixture(async()=>await new Promise(resolve=>finish=resolve));const pending=worker.startService();await new Promise(resolve=>setImmediate(resolve));worker.authState.restaurant={id:'other'};finish({data:{ok:true,held_count:0},error:null});await pending;assert.equal(ticks(),0);
});
