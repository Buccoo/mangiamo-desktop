import { Socket } from 'node:net';

export type PrinterPaperProfile = {
  width_mm: 58 | 80;
  printable_dots: 360 | 384 | 512 | 576;
  model: string;
  source: 'escpos' | 'model-profile';
  native_profile?: 'custom-kube-ii';
  dpi?: number;
  firmware?: string;
};
export type PrinterPaperResult = { ok: true; paper: PrinterPaperProfile } | { ok: false; reason: string };
type Exchange = (host: string, port: number, query: Buffer) => Promise<Buffer>;
type ReadPage = (host: string, path: '/' | '/info.htm') => Promise<string>;

/** Identity comes from two fixed read-only device pages. Never execute their JS.
 * KUBE II's active width/CPI setup can require authentication. This is explicitly
 * a conservative 72mm model profile (below both documented 76/80mm areas), not
 * a measurement of the currently fitted roll or the protected device settings.
 * CUSTOM DOMC-0006I and KUBE II ETH user guide 769000000332_2.01.
 */
export function parseCustomPrinterPages(index: string, info: string): PrinterPaperProfile | null {
  if (index.length > 65536 || info.length > 65536 || !/<title>\s*KUBE II ETH PRINTER\s*-\s*CUSTOM ENGINEERING\s*<\/title>/i.test(index)) return null;
  if (!/\bTab\(\s*["']Printer Model:["']\s*,\s*["']KUBE II ETH["']\s*\)/.test(info)) return null;
  const firmware = info.match(/\bTab\(\s*["']Firmware Version:["']\s*,\s*["']([0-9.]{1,16})["']\s*\)/)?.[1];
  return { width_mm: 80, printable_dots: 576, model: 'CUSTOM KUBE II ETH', source: 'model-profile', native_profile: 'custom-kube-ii', dpi: 203, ...(firmware ? { firmware } : {}) };
}

async function readPrinterPage(host: string, path: '/' | '/info.htm'): Promise<string> {
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const response = await fetch(`http://${authority}${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(1200), credentials: 'omit' });
  if (!response.ok || !/text\/(?:html|plain)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new Error('PRINTER_INFO_UNAVAILABLE'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PRINTER_INFO_EMPTY');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw new Error('PRINTER_INFO_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

// GS I 110 has model-specific meanings. Only interpret the width/resolution
// bit field for models whose Epson command reference documents that format.
const widthInformationModels = new Set(['TM-T70', 'TM-T70II']);

export function parsePaperInformation(model: string, data: Buffer): PrinterPaperProfile | null {
  if (!widthInformationModels.has(model) || data[0] !== 0x3d || data[data.length - 1] !== 0) return null;
  // The model-specific reference describes three bytes; the general
  // information-A framing additionally includes identifier 110.
  const value = data.length === 3 ? data[1] : data.length === 4 && data[1] === 110 ? data[2] : -1;
  if ((value & 0xfc) !== 0x40) return null;
  const narrow = Boolean(value & 1);
  const highResolution = Boolean(value & 2);
  return { width_mm: narrow ? 58 : 80, printable_dots: narrow ? highResolution ? 384 : 360 : highResolution ? 576 : 512, model, source: 'escpos' };
}

function informationText(data: Buffer): string | null {
  if (data.length < 3 || data.length > 96 || data[0] !== 0x5f || data[data.length - 1] !== 0) return null;
  const text = data.subarray(1, -1).toString('ascii');
  return /^[\x20-\x7e]+$/.test(text) ? text.trim() : null;
}

function exchangeInformation(host: string, port: number, query: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => finish(new Error('PAPER_QUERY_TIMEOUT')), 1500);
    function finish(error?: Error, data?: Buffer) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(data!);
    }
    socket.on('error', error => finish(error));
    socket.on('end', () => finish(new Error('PAPER_QUERY_INCOMPLETE')));
    socket.on('close', () => { if (!settled) finish(new Error('PAPER_QUERY_CLOSED')); });
    socket.on('data', chunk => {
      size += chunk.length;
      if (size > 128) { finish(new Error('PAPER_QUERY_TOO_LARGE')); return; }
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (data.includes(0)) finish(undefined, data);
    });
    socket.connect(port, host, () => socket.write(query));
  });
}

/** Read-only printer queries: no reset, feed, cut, paper setting or print data. */
export async function detectPrinterPaper(host: string, port = 9100, exchange: Exchange = exchangeInformation, readPage: ReadPage | undefined = exchange === exchangeInformation ? readPrinterPage : undefined): Promise<PrinterPaperResult> {
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.:[\]_-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: 'INVALID_PRINTER' };
  if (port === 9100 && readPage) {
    try {
      const index = await readPage(host, '/');
      if (/<title>\s*KUBE II ETH PRINTER\s*-\s*CUSTOM ENGINEERING\s*<\/title>/i.test(index)) {
        try {
          const paper = parseCustomPrinterPages(index, await readPage(host, '/info.htm'));
          return paper ? { ok: true, paper } : { ok: false, reason: 'PAPER_NOT_DETECTED' };
        } catch { return { ok: false, reason: 'PAPER_NOT_DETECTED' }; }
      }
    } catch { /* Missing/unsupported web interface: try the documented Epson queries. */ }
  }
  try {
    const maker = informationText(await exchange(host, port, Buffer.from([29, 73, 66])));
    if (maker !== 'EPSON') return { ok: false, reason: 'UNSUPPORTED_PRINTER' };
    const model = informationText(await exchange(host, port, Buffer.from([29, 73, 67])));
    if (!model || !widthInformationModels.has(model)) return { ok: false, reason: 'UNSUPPORTED_PRINTER' };
    const paper = parsePaperInformation(model, await exchange(host, port, Buffer.from([29, 73, 110])));
    return paper ? { ok: true, paper } : { ok: false, reason: 'PAPER_NOT_DETECTED' };
  } catch { return { ok: false, reason: 'PAPER_NOT_DETECTED' }; }
}
