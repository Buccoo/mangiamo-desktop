import * as opentype from 'opentype.js';

type Command = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };
type Glyph = { index: number; advanceWidth: number; getPath(x: number, y: number, size: number): { commands: Command[] }; getBoundingBox():{x1:number;y1:number;x2:number;y2:number} };
type VectorFont = { unitsPerEm: number; ascender: number; descender: number; charToGlyph(char: string): Glyph; getKerningValue(left: Glyph, right: Glyph): number };
export type RasterLine = { text: string; right_text?: string; type?: string; size?: string; size_pt?: number; bold?: boolean; font?: string; align?: string; section?: string; block?: string };
export type RasterImage = { width: number; height: number; data: Uint8Array; dpi?:number };
export type RasterRow = RasterLine & RasterImage & { y: number; inkWidth: number };
export type RasterTicket = RasterImage & { rows: RasterRow[]; dpi: number };
const fonts = new Map<string, VectorFont>();

export function registerTicketFont(id: 'regular' | 'bold' | 'cjk' | 'emoji', bytes: ArrayBuffer) {
  // The package's browser module has named exports; Node's CJS namespace
  // exposes its module object. Normalize without importing a missing default.
  const module = typeof opentype.parse==='function'?opentype:(Object.values(opentype) as unknown[]).find(value=>value!==null&&typeof value==='object'&&'parse' in value) as {parse:(data:ArrayBuffer)=>unknown}|undefined;
  if (!module)throw Error('TICKET_FONTS_UNAVAILABLE');
  if (!fonts.has(id)) fonts.set(id, module.parse(bytes) as VectorFont);
}
export function ticketFontsReady(cjk = false, emoji = false) { return fonts.has('regular') && fonts.has('bold') && (!cjk || fonts.has('cjk')) && (!emoji || fonts.has('emoji')); }
export function needsCjkFont(lines: RasterLine[]) { return lines.some(line => /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u.test(line.text)); }
export function needsEmojiFont(lines: RasterLine[]) { return lines.some(line => /[\u2600-\u27ff\u{1f000}-\u{1faff}]/u.test(line.text)); }
export function pointsToDots(points: number, dpi: number) {
  if (!Number.isFinite(points) || points < 4 || points > 72 || ![180, 203, 300].includes(dpi)) throw Error('TICKET_SIZE_INVALID');
  return points * dpi / 72;
}
export function effectivePointSize(line: Pick<RasterLine,'size_pt'|'font'|'size'>) { return line.size_pt ?? (line.font === 'B' ? 9 : 12) * (line.size === 'double' ? 2 : 1); }

function glyphFor(char: string, bold: boolean) {
  const primary = fonts.get(bold ? 'bold' : 'regular');
  if (!primary) throw Error('TICKET_FONTS_NOT_READY');
  let font = primary, glyph = font.charToGlyph(char);
  if (glyph.index === 0 && fonts.has('emoji') && fonts.get('emoji')!.charToGlyph(char).index !== 0) {font=fonts.get('emoji')!;glyph=font.charToGlyph(char);}
  if (glyph.index === 0 && fonts.has('cjk')) { font = fonts.get('cjk')!; glyph = font.charToGlyph(char); }
  if (glyph.index === 0) throw Error(`TICKET_GLYPH_UNSUPPORTED U+${char.codePointAt(0)!.toString(16).toUpperCase()}`);
  return { font, glyph };
}
const boundsCache=new WeakMap<VectorFont,Map<number,ReturnType<Glyph['getBoundingBox']>>>();
function textBounds(text: string, pixels: number, compact: number, bold: boolean) {
  let advance = 0,min=0,max=0, previous: ReturnType<typeof glyphFor> | undefined;
  for (const char of text) {
    const next = glyphFor(char, bold), scale = pixels / next.font.unitsPerEm * compact;
    if (previous?.font === next.font) advance += next.font.getKerningValue(previous.glyph, next.glyph) * scale;
    let cache=boundsCache.get(next.font);if(!cache){cache=new Map();boundsCache.set(next.font,cache);}
    let bounds=cache.get(next.glyph.index);if(!bounds){bounds=next.glyph.getBoundingBox();cache.set(next.glyph.index,bounds);}
    min=Math.min(min,advance+bounds.x1*scale);max=Math.max(max,advance+bounds.x2*scale+(bold&&next.font===fonts.get('cjk')?1:0));
    advance += next.glyph.advanceWidth * scale;
    previous = next;
  }
  max=Math.max(max,advance);return {min,max,width:max-min};
}
function measure(text:string,pixels:number,compact:number,bold:boolean){return textBounds(text,pixels,compact,bold).width;}
function wrap(text: string, maxWidth: number, pixels: number, compact: number, bold: boolean) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (measure(char, pixels, compact, bold) > maxWidth) throw Error('TICKET_GLYPH_TOO_WIDE');
      if (line && measure(line + char, pixels, compact, bold) > maxWidth) {
        const split = line.lastIndexOf(' ');
        if (split > 0) { lines.push(line.slice(0, split).trimEnd()); line = line.slice(split + 1); }
        else { lines.push(line.trimEnd()); line = ''; }
      }
      line += char;
      if (measure(line, pixels, compact, bold) > maxWidth) { lines.push(line.slice(0, -char.length).trimEnd()); line = char; }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

type Edge = [number, number, number, number];
function pathEdges(commands: Command[], startX: number, compact: number): Edge[] {
  const edges: Edge[] = [];
  let x = 0, y = 0, beginX = 0, beginY = 0;
  const tx = (value: number) => startX + (value - startX) * compact;
  const edge = (nextX: number, nextY: number) => { if (y !== nextY) edges.push([x, y, nextX, nextY]); x = nextX; y = nextY; };
  for (const command of commands) {
    if (command.type === 'M') { x = tx(command.x!); y = command.y!; beginX = x; beginY = y; }
    else if (command.type === 'L') edge(tx(command.x!), command.y!);
    else if (command.type === 'Z') edge(beginX, beginY);
    else if (command.type === 'Q' || command.type === 'C') {
      const x0 = x, y0 = y, x1 = tx(command.x1!), y1 = command.y1!, x3 = tx(command.x!), y3 = command.y!;
      const x2 = command.type === 'C' ? tx(command.x2!) : x1, y2 = command.type === 'C' ? command.y2! : y1;
      const steps = Math.min(96, Math.max(4, Math.ceil((Math.hypot(x1-x0,y1-y0)+Math.hypot(x3-x1,y3-y1)+Math.hypot(x2-x1,y2-y1))/2)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1-t;
        edge(command.type === 'Q' ? u*u*x0+2*u*t*x1+t*t*x3 : u*u*u*x0+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3,
          command.type === 'Q' ? u*u*y0+2*u*t*y1+t*t*y3 : u*u*u*y0+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3);
      }
    }
  }
  return edges;
}
function fillEdges(image: RasterImage, edges: Edge[]) {
  const stride = Math.ceil(image.width / 8);
  if (!edges.length) return;
  let minY = image.height, maxY = 0;
  for (const edge of edges) { minY = Math.min(minY, edge[1], edge[3]); maxY = Math.max(maxY, edge[1], edge[3]); }
  for (let row = Math.max(0, Math.floor(minY)); row < Math.min(image.height, Math.ceil(maxY)); row++) {
    const y = row + .5, hits: Array<[number, number]> = [];
    for (const [x0, y0, x1, y1] of edges) {
      if (y >= Math.min(y0,y1) && y < Math.max(y0,y1)) hits.push([x0+(y-y0)*(x1-x0)/(y1-y0), y1>y0?1:-1]);
    }
    hits.sort((a,b)=>a[0]-b[0]);
    let winding = 0, start = 0;
    for (const [x, direction] of hits) {
      if (!winding) start = x;
      winding += direction;
      if (!winding) for (let column = Math.max(0, Math.ceil(start-.5)); column < Math.min(image.width, Math.ceil(x-.5)); column++) image.data[row*stride+(column>>3)] |= 128>>(column&7);
    }
  }
}

/** One deterministic monochrome renderer for browser, staff and native printing.
 * Sizes are typographic em points, converted at the destination DPI. */
export function renderRasterTicket(input: RasterLine[], options: { width: number; dpi: number }): RasterTicket {
  const { width, dpi } = options;
  if (!Number.isInteger(width) || width < 128 || width > 1280 || input.length > 1024) throw Error('TICKET_RASTER_LIMIT');
  pointsToDots(12, dpi);
  if (!ticketFontsReady()) throw Error('TICKET_FONTS_NOT_READY');
  const stride = Math.ceil(width/8), rows: RasterRow[] = [];
  let y = 12, characters = 0;
  for (const source of input) {
    characters += source.text.length;
    if (source.text.length > 4096 || characters > 32000) throw Error('TICKET_RASTER_LIMIT');
    // eslint-disable-next-line no-control-regex, no-misleading-character-class -- strip printer controls and invisible direction/variation modifiers before glyph lookup.
    const text = source.text.normalize('NFC').replace(/\t/g, '    ').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufe0e\ufe0f]/g, '');
    const pixels = pointsToDots(effectivePointSize(source), dpi), compact = source.font === 'B' ? .82 : 1, bold = source.bold === true;
    const right = source.right_text ?? '', rightWidth = measure(right,pixels,compact,bold);
    if (rightWidth > width-24) throw Error('TICKET_GLYPH_TOO_WIDE');
    const chunks = source.type === 'separator' || source.type === 'blank' ? [''] : wrap(text, width-16-(right?rightWidth+8:0), pixels, compact, bold);
    for (const [chunkIndex,chunk] of chunks.entries()) {
      const rightText=chunkIndex===chunks.length-1?right:'';
      let ascent = pixels * 1.069, descent = pixels * .293;
      for (const char of chunk) { const {font} = glyphFor(char,bold); ascent=Math.max(ascent,font.ascender/font.unitsPerEm*pixels); descent=Math.max(descent,-font.descender/font.unitsPerEm*pixels); }
      const height = source.type === 'separator' ? Math.max(10,Math.round(dpi/16)) : source.type === 'blank' ? Math.round(dpi/8) : Math.ceil(ascent+descent)+4;
      if (y+height+Math.ceil(dpi*5/6)>16384) throw Error('TICKET_RASTER_LIMIT');
      const image: RasterRow = { ...source, right_text:rightText||undefined, text: source.type === 'separator' ? source.text : chunk, width, height, y, inkWidth: source.type === 'separator' ? width-16 : measure(chunk,pixels,compact,bold), data: new Uint8Array(stride*height) };
      if (source.type === 'separator') {
        const center = Math.floor(height/2);
        for (const ruleY of source.text.startsWith('=') ? [center-2,center+2] : [center]) for (let x=8;x<width-8;x++) image.data[ruleY*stride+(x>>3)] |= 128>>(x&7);
      } else {
        const paint = (text:string,start:number) => {
        let x = start;
        let previous: ReturnType<typeof glyphFor> | undefined;
        for (const char of text) {
          const next = glyphFor(char,bold), scale = pixels/next.font.unitsPerEm*compact;
          if (previous?.font === next.font) x += next.font.getKerningValue(previous.glyph,next.glyph)*scale;
          const edges = pathEdges(next.glyph.getPath(x,2+ascent,pixels).commands,x,compact);
          fillEdges(image,edges);
          // The CJK fallback is regular; a deterministic one-dot expansion adds emphasis.
          if (bold && next.font === fonts.get('cjk')) fillEdges(image,edges.map(([x0,y0,x1,y1])=>[x0+1,y0,x1+1,y1]));
          x += next.glyph.advanceWidth*scale; previous=next;
        }
        };
        const bounds=textBounds(chunk,pixels,compact,bold);
        paint(chunk,(right?8:source.align === 'right' ? width-8-image.inkWidth : source.align === 'center' ? (width-image.inkWidth)/2 : 8)-bounds.min);
        if(rightText){const rightBounds=textBounds(rightText,pixels,compact,bold);paint(rightText,width-8-rightBounds.max);}
      }
      rows.push(image); y+=height;
    }
  }
  const height = Math.ceil((y+Math.ceil(dpi*5/6))/24)*24, data = new Uint8Array(stride*height);
  for (const row of rows) data.set(row.data,row.y*stride);
  return { width,height,data,rows,dpi };
}

const crcTable = Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function u32(value:number) { return [(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255]; }
function chunk(name:string,data:Uint8Array) {
  const body = new Uint8Array(4+data.length); body.set(Array.from(name,char=>char.charCodeAt(0)));body.set(data,4);
  let crc=0xffffffff;for(const value of body)crc=crcTable[(crc^value)&255]^(crc>>>8);
  return Uint8Array.from([...u32(data.length),...body,...u32((crc^0xffffffff)>>>0)]);
}
/** PNG uses stored DEFLATE blocks: no platform canvas, native codec or rounding differences. */
export function rasterPng(image:RasterImage):Uint8Array {
  const stride=Math.ceil(image.width/8), scan=new Uint8Array((stride+1)*image.height);
  for(let y=0;y<image.height;y++)for(let x=0;x<stride;x++)scan[y*(stride+1)+1+x]=image.data[y*stride+x]^255;
  const blocks: number[]=[0x78,0x01];
  for(let start=0;start<scan.length;start+=65535){const count=Math.min(65535,scan.length-start);blocks.push(start+count===scan.length?1:0,count&255,count>>8,(~count)&255,((~count)>>>8)&255);for(let i=0;i<count;i++)blocks.push(scan[start+i]);}
  let a=1,b=0;for(const value of scan){a=(a+value)%65521;b=(b+a)%65521;}blocks.push(...u32((b*65536+a)>>>0));
  const parts=[Uint8Array.from([137,80,78,71,13,10,26,10]),chunk('IHDR',Uint8Array.from([...u32(image.width),...u32(image.height),1,0,0,0,0])),chunk('IDAT',Uint8Array.from(blocks)),chunk('IEND',new Uint8Array())];
  const result=new Uint8Array(parts.reduce((length,part)=>length+part.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
export function bytesBase64(bytes:Uint8Array) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';
  for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];result+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|((c??0)>>6)]:'=')+(i+2<bytes.length?alphabet[c&63]:'=');}return result;
}
export function rasterDataUri(image:RasterImage) {return 'data:image/png;base64,'+bytesBase64(rasterPng(image));}

/** Select once before dispatch. No alternative protocol is attempted after writing. */
export function encodeRasterTicket(image:RasterImage, protocol:'gs-v0'|'esc-star'):Uint8Array {
  if (!['gs-v0','esc-star'].includes(protocol)) throw Error('TICKET_GRAPHICS_UNSUPPORTED');
  const stride=Math.ceil(image.width/8), result:number[]=[27,64];
  if(protocol==='gs-v0') {
    // Each GS-v0 command prints and feeds its own image. Group rows to reduce
    // repeated firmware print/feed cycles while bounding each image to 32 KiB.
    const band=Math.max(1,Math.min(256,Math.floor(32768/stride)));
    for(let y=0;y<image.height;y+=band){const count=Math.min(band,image.height-y);result.push(29,118,48,0,stride&255,stride>>8,count&255,count>>8);for(let i=y*stride;i<(y+count)*stride;i++)result.push(image.data[i]);}
  } else {
    const dpi=image.dpi??203;
    if(dpi!==180&&dpi!==203)throw Error('TICKET_GRAPHICS_UNSUPPORTED');
    // ESC 3 is expressed in motion units, not dots. Explicitly choose one
    // unit per rendered dot; Epson defaults can otherwise be half a dot.
    result.push(29,80,dpi,dpi,27,51,24);
    for(let y=0;y<image.height;y+=24){result.push(27,42,33,image.width&255,image.width>>8);for(let x=0;x<image.width;x++)for(let byte=0;byte<3;byte++){let value=0;for(let bit=0;bit<8;bit++){const row=y+byte*8+bit;if(row<image.height&&image.data[row*stride+(x>>3)]&(128>>(x&7)))value|=128>>bit;}result.push(value);}result.push(10);}
    result.push(27,50);
  }
  result.push(29,86,0);return Uint8Array.from(result);
}
