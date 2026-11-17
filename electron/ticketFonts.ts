import fs from 'node:fs';
import path from 'node:path';
import type * as Raster from './ticket-raster';
const raster = require('./ticket-raster.cjs') as typeof Raster;

/** Bundled, pinned font bytes; never depend on Windows fonts or download at print time. */
export function prepareTicketFonts(lines: Raster.RasterLine[]) {
  const files = { regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf', cjk: 'NotoSansCJKsc-Regular.otf', emoji:'NotoEmoji.ttf' } as const;
  for (const id of ['regular', 'bold', ...(raster.needsCjkFont(lines) ? ['cjk'] : []), ...(raster.needsEmojiFont(lines)?['emoji']:[])] as Array<keyof typeof files>) {
    if (id === 'cjk' ? raster.ticketFontsReady(true) : id==='emoji'?raster.ticketFontsReady(false,true):raster.ticketFontsReady()) continue;
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'assets', 'printing', files[id]));
    raster.registerTicketFont(id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
}

export function buildPreciseTicket(lines: Raster.RasterLine[], layout: { printable_dots?: number; raster?: { dpi: number; protocol: 'gs-v0' | 'esc-star' } }) {
  prepareTicketFonts(lines);
  const image = raster.renderRasterTicket(lines, { width: layout.printable_dots ?? 576, dpi: layout.raster?.dpi ?? 203 });
  return Buffer.from(raster.encodeRasterTicket(image, layout.raster?.protocol ?? 'gs-v0'));
}
