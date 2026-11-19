const {test}=require('node:test');const assert=require('node:assert/strict');
const {renderNonFiscalReceiptTicket}=require('../electron-dist/receiptTicket.cjs');
const payload={total_amount:42.8,receipt_breakdown:{version:1,ayce_items:[],amount_due_after:56.3}};
for(const render_mode of ['native','raster'])test(`custom partial labels reach Desktop rendering in ${render_mode} mode`,()=>{
 const result=renderNonFiscalReceiptTicket(payload,{layout:{render_mode,header:{visible:false},partial_payment:{title:'UMAIYA',subtitle:''}}});
 assert.match(result.text,/UMAIYA/);assert.doesNotMatch(result.text,/PAGAMENTO PARZIALE|Solo voci pagate/);assert.match(result.text,/56,30/);assert.match(result.text,/42,80/);
});
test('Chinese custom titles select graphic printing even in fast mode',()=>{
 const result=renderNonFiscalReceiptTicket(payload,{layout:{render_mode:'native',partial_payment:{title:'味屋',subtitle:''}}});
 assert.ok(result.lines.find(line=>line.text.includes('味屋')&&line.size_pt!=null));
});
