const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../electron-dist/kitchenTicket.cjs');
const fonts=require('../electron-dist/ticketFonts.cjs');
const raster=require('../electron-dist/ticket-raster.cjs');
const payload={table_number:'8',num_covers:2,items:[
 {menu_item_id:'n',name:'Nigiri',quantity:1,category_id:'sushi',category_sort_order:2,notes:'No uova'},
 {name:'Gyoza',quantity:1,category_id:'starter',category_sort_order:1},
 {menu_item_id:'n',name:'Nigiri',quantity:2,category_id:'sushi',category_sort_order:2,notes:'No uova'},
 {name:'Sashimi',quantity:1,category_id:'sushi',category_sort_order:2},
]};
for(const render_mode of ['native','raster'])test(`category sorting, single boundaries and right-side covers reach ${render_mode} transport`,()=>{
 const layout=core.normalizeKitchenLayout({render_mode,header:{visible:false},footer:{visible:false},items:{show_guest_name:false}});
 const {lines}=core.renderKitchenTicketCore(payload,{layout});
 assert.deepEqual(lines.filter(l=>l.type==='item').map(l=>l.text),['1x Gyoza','3x Nigiri','1x Sashimi']);
 assert.equal(lines.filter(l=>l.type==='separator').length,2);
 const table=lines.find(l=>l.type==='table');assert.equal(table.right_text,'(2)');assert.equal(table.right_size_pt,12);
 if(render_mode==='native'){
  const bytes=Buffer.from(core.buildKitchenEscPos(lines,layout));
  assert.ok(bytes.includes(Buffer.from([29,33,0,27,36,20,2,40,50,41,10])));
 }else{
  fonts.prepareTicketFonts(lines);
  const image=raster.renderRasterTicket(lines,{width:576,dpi:203});
  const row=image.rows.find(l=>l.type==='table');
  const verticalInk=(start,end)=>{const ys=[];for(let y=0;y<row.height;y++)for(let x=start;x<end;x++)if(row.data[y*72+(x>>3)]&(128>>(x&7))){ys.push(y);break;}return Math.max(...ys)-Math.min(...ys)+1;};
  assert.ok(verticalInk(450,568)>0);assert.ok(verticalInk(450,568)<verticalInk(8,400),'covers use smaller glyphs');
  assert.ok(image.rows.every((row,i)=>!i||row.y>=image.rows[i-1].y+image.rows[i-1].height));
  assert.ok(fonts.buildPreciseTicket(lines,layout).includes(Buffer.from([29,118,48,0])));
 }
 const off=core.renderKitchenTicketCore(payload,{layout:{...layout,table:{...layout.table,show_covers:false},items:{...layout.items,group_by_category:false}}}).lines;
 assert.equal(off.some(l=>l.right_text),false);assert.equal(off.filter(l=>l.type==='separator').length,1);
 assert.deepEqual(off.filter(l=>l.type==='item').map(l=>l.text),['3x Nigiri','1x Gyoza','1x Sashimi']);
});
