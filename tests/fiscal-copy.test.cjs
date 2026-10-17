const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const filename = path.join(__dirname, '../electron-dist/printWorker.cjs');
const moduleFixture = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.render = renderFiscalReceiptTicket;', {
 module: moduleFixture, exports: moduleFixture.exports, require: createRequire(filename), Buffer, process,
 __dirname: path.dirname(filename), AbortController, setTimeout, clearTimeout,
});
const { render } = moduleFixture.exports;
const job = { id:'copy-job',created_at:'2026-10-17T20:00:00Z',payload:{
 payment_event_id:'event-1',receipt_number:'DCW2026/0001-0002',
 fiscal_proof:{version:1,operation_id:'operation-1',record_id:'provider-record',compliance_number:'DCW2026/0001-0002',provider_state:'COMPLETED',provider_mode:'FINISHED',environment:'test',source_event_id:'event-1'},
 schema:{ekabs_v0:{head:{number:'DCW2026/0001-0002',seller:{name:'Fixture'}},data:{full_amount_incl_vat:'25.00',lines:[],payment_types:[{name:'card'}]}}},
} };
test('fiscal copy shows official progressive, copy label and unmistakable TEST environment',()=>{
 const ticket=render(job);
 assert.match(ticket,/COPIA DOCUMENTO COMMERCIALE/);
 assert.match(ticket,/TEST - NON VALIDO FISCALMENTE/);
 assert.match(ticket,/DCW2026\/0001-0002/);
 assert.doesNotMatch(ticket,/SCONTRINO FISCALE|via Fiskaly eReceipt/);
 assert.doesNotMatch(render({...job,payload:{...job.payload,fiscal_proof:{...job.payload.fiscal_proof,environment:'live'}}}),/NON VALIDO FISCALMENTE/);
});
test('legacy, foreign, pending or local fabricated fiscal evidence is refused before transport',()=>{
 for(const proof of [null,{...job.payload.fiscal_proof,source_event_id:'foreign'},{...job.payload.fiscal_proof,provider_state:'ACCEPTED'},{...job.payload.fiscal_proof,compliance_number:'TB-123'},{...job.payload.fiscal_proof,environment:'other'}])
  assert.throws(()=>render({...job,payload:{...job.payload,fiscal_proof:proof}}),/FISCAL_COPY_PROOF_REQUIRED/);
 assert.throws(()=>render({...job,payload:{...job.payload,schema:{ekabs_v0:{head:{number:'TB-local'}}}}}),/FISCAL_COPY_PROOF_REQUIRED/);
});
test('the real server copy payload crosses the desktop proof gate and uses original eight-decimal VAT', {skip:!fs.existsSync(path.join(__dirname,'../../mangiamo-manager/supabase/functions/_shared/fiscal-copy-payload.ts'))}, ()=>{
 const script = `
 import {buildFiscalPaymentSnapshot} from './supabase/functions/_shared/fiscal-payment-snapshot.ts';
 import {buildRecordTransaction} from './supabase/functions/_shared/fiskaly-record-contract.ts';
 import {buildFiscalCopyPayload} from './supabase/functions/_shared/fiscal-copy-payload.ts';
 const snapshot=buildFiscalPaymentSnapshot({id:'event-1',paid_total:0.15,ayce_total:0,cover_total:0,extras_total:0.15,discount_allocated_amount:0,payment_line_items:[4,10,22].map((v,i)=>({order_item_id:'item'+i,name:'Item '+i,quantity:1,unit_price:0.05,gross:0.05,vat_rate:v})),paid_at:'2026-10-17T18:00:00Z',payment_method:'cash'}, {rates:[4,10,22].map(v=>({code:'VAT_'+v,percentage:v}))});
 const context={environment:'test',base_url:'https://test.api.fiskaly.com',api_version:'2026-02-03',system_id:'system',vat_rates:[4,10,22].map(v=>({code:'VAT_'+v,percentage:v})),document_number:'M-1',issued_at:'2026-10-17T18:00:00Z'};
 const operation={id:'op',restaurant_id:'venue',payment_event_id:'event-1',kind:'sale',status:'emitted',provider_state:'COMPLETED',provider_mode:'FINISHED',compliance_number:'DCW2026/0001-0002',record_id:'record',intention_id:'intent',snapshot,context};
 operation.transaction_payload=buildRecordTransaction(operation,'intent');
 console.log(JSON.stringify(buildFiscalCopyPayload(operation,{name:'Fixture'})));
 `;
 const payload=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','--experimental-default-type=module','--input-type=module','-e',script],{cwd:path.join(__dirname,'../../mangiamo-manager'),encoding:'utf8'}));
 assert.equal(payload.payment_event_id,payload.fiscal_proof.source_event_id);
 assert.equal(payload.schema.ekabs_v0.data.total_vat_amount,'0.01548492');
 const ticket=render({...job,payload});
 assert.match(ticket,/COPIA DOCUMENTO COMMERCIALE/);
 assert.match(ticket,/IVA totale\s+EUR 0,02/);
});
