const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
let raster;
test.before(() => {
  raster = require('../electron-dist/ticket-raster.cjs');
  for (const [id, file] of [['regular','NotoSans-Regular.ttf'],['bold','NotoSans-Bold.ttf'],['cjk','NotoSansCJKsc-Regular.otf'],['emoji','NotoEmoji.ttf']]) {
    const bytes = fs.readFileSync(path.join(__dirname, '../assets/printing', file));
    raster.registerTicketFont(id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
});
test('menu symbols and two-column prices keep their pixels and amounts',()=>{
  const image=raster.renderRasterTicket([row('Sushi 🍣',14),row('Coperto',16,{right_text:'25,00 €'})],{width:384,dpi:203});
  assert.ok(image.data.some(value=>value));
  assert.equal(image.rows.at(-1).right_text,'25,00 €');
});
const row = (text, size_pt = 12, extra = {}) => ({ text, size_pt, font: 'A', size: 'normal', bold: false, type: 'item', align: 'left', ...extra });
test('fractional point sizes convert with the selected physical DPI and render deterministically', () => {
  assert.equal(raster.pointsToDots(12, 203), 12 * 203 / 72);
  const a = raster.renderRasterTicket([row('Tavolo: 5', 13.5)], { width: 576, dpi: 203 });
  const b = raster.renderRasterTicket([row('Tavolo: 5', 13.5)], { width: 576, dpi: 203 });
  assert.deepEqual(a.data, b.data);
  assert.ok(a.data.some(value => value));
  assert.ok(raster.renderRasterTicket([row('Tavolo: 5', 27)], { width: 576, dpi: 203 }).height > a.height);
});
test('wraps physical pixel widths, including long words, accents and Chinese without losing text', () => {
  const result = raster.renderRasterTicket([row('Caffè 三文鱼 ' + 'GALLIPOLI'.repeat(12), 18)], { width: 384, dpi: 203 });
  assert.ok(result.rows.length > 3);
  assert.equal(result.rows.map(line => line.text).join('').replace(/\s/g,''), ('Caffè 三文鱼 ' + 'GALLIPOLI'.repeat(12)).replace(/\s/g,''));
  assert.ok(result.rows.every(line => line.inkWidth <= 368));
});
test('the preview PNG contains exactly the same monochrome pixel matrix', () => {
  const image = raster.renderRasterTicket([row('Sushi', 14)], { width: 384, dpi: 203 });
  const png = Buffer.from(raster.rasterPng(image));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  let offset = 8, blocks = [];
  while (offset < png.length) { const length = png.readUInt32BE(offset), name = png.subarray(offset+4, offset+8).toString(); if (name === 'IDAT') blocks.push(png.subarray(offset+8, offset+8+length)); offset += length+12; }
  const decoded = zlib.inflateSync(Buffer.concat(blocks)), stride = Math.ceil(image.width/8);
  for (let y=0;y<image.height;y++) { assert.equal(decoded[y*(stride+1)],0); for(let x=0;x<stride;x++) assert.equal(decoded[y*(stride+1)+1+x], image.data[y*stride+x]^255); }
});
test('bounds invalid sizes and resources and rejects unsupported glyphs before dispatch', () => {
  for (const size of [NaN, Infinity, 0, 73]) assert.throws(() => raster.renderRasterTicket([row('test',size)],{width:576,dpi:203}));
  assert.throws(() => raster.renderRasterTicket([row('x'.repeat(70000),12)],{width:576,dpi:203}));
  assert.throws(() => raster.renderRasterTicket([row('\u{10ffff}',12)],{width:576,dpi:203}), /GLYPH_UNSUPPORTED/);
});
test('GS-v0 image bands reconstruct the source pixels with no scaling and stay within small printer buffers', () => {
  const image = raster.renderRasterTicket([row('Sushi Assortito',24)], {width:576,dpi:203});
  const bytes = raster.encodeRasterTicket(image,'gs-v0');
  let offset=2, chunks=[];
  while(bytes[offset]===29 && bytes[offset+1]===118) { assert.equal(bytes[offset+3],0); const stride=bytes[offset+4]+256*bytes[offset+5], height=bytes[offset+6]+256*bytes[offset+7]; assert.ok(stride*height<=4096); chunks.push(bytes.slice(offset+8,offset+8+stride*height)); offset+=8+stride*height; }
  assert.deepEqual(Buffer.concat(chunks.map(Buffer.from)),Buffer.from(image.data));
  assert.throws(() => raster.encodeRasterTicket(image,'invented'), /GRAPHICS_UNSUPPORTED/);
});
test('ESC-star column bands reconstruct the same complete pixel matrix without an alternate send',()=>{
 const image=raster.renderRasterTicket([row('Compatibilità 13,5 pt',13.5)],{width:384,dpi:203});
 const bytes=raster.encodeRasterTicket(image,'esc-star'),stride=Math.ceil(image.width/8),decoded=new Uint8Array(image.data.length);
 assert.deepEqual(Array.from(bytes.slice(0,9)),[27,64,29,80,203,203,27,51,24]);
 // Starting from a half-dot default feed unit, GS P must explicitly select
 // 203 units/inch so each LF advances 24 physical dots, not 12.
 const verticalUnits=bytes[5],lineSpacing=bytes[8];
 let offset=9,y=0;
 while(bytes[offset]===27&&bytes[offset+1]===42){assert.equal(bytes[offset+2],33);const width=bytes[offset+3]+bytes[offset+4]*256;offset+=5;
  for(let x=0;x<width;x++)for(let block=0;block<3;block++){const value=bytes[offset++];for(let bit=0;bit<8;bit++)if(y+block*8+bit<image.height&&value&(128>>bit))decoded[(y+block*8+bit)*stride+(x>>3)]|=128>>(x&7);}
  assert.equal(bytes[offset++],10);y+=lineSpacing*image.dpi/verticalUnits;
 }
 assert.deepEqual(decoded,image.data);
 assert.throws(()=>raster.encodeRasterTicket({...image,dpi:300},'esc-star'),/GRAPHICS_UNSUPPORTED/);
});

test('large leading and trailing glyph bearings keep every outline inside both physical margins',()=>{
 for(const [text,align]of [['J','left'],['j','left'],['f','right']])for(const bold of [false,true]){
  const image=raster.renderRasterTicket([row(text,72,{align,bold})],{width:384,dpi:300});
  const stride=Math.ceil(image.width/8);
  assert.ok(image.data.some(value=>value));
  for(let y=0;y<image.height;y++)for(const x of [0,1,2,3,4,5,6,7,376,377,378,379,380,381,382,383])assert.equal(Boolean(image.data[y*stride+(x>>3)]&(128>>(x&7))),false,`${text} ${align} overhang at ${x},${y}`);
 }
});
