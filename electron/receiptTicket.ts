const { ticketFontMetrics } = require('./kitchenTicket.cjs') as typeof import('./kitchenTicket');
import type { AnnotatedLine, EscPosFont, TicketRenderMode,TicketTextStyle } from './kitchenTicket';
export function receiptUsesRaster(layout: Pick<ReceiptLayoutConfig, 'render_mode' | 'sizes_pt'|'layer_styles'>) {
  return layout.render_mode === 'raster' || layout.render_mode !== 'native' && (Object.keys(layout.sizes_pt ?? {}).length > 0||Object.values(layout.layer_styles??{}).some(style=>style?.size_pt!=null));
}
export type ReceiptSeparatorsMode = 'all' | 'sections' | 'none';
export type ReceiptLayerStyle = TicketTextStyle & {
  separator_after?: boolean;
  separator_before?: boolean;
};
export interface ReceiptLayoutConfig {
  layer_order?: ReceiptLayer[];
  hidden_layers?: ReceiptLayer[];
  layer_styles?: Partial<Record<ReceiptLayer,Partial<ReceiptLayerStyle>>>;
  separators?: ReceiptSeparatorsMode;
  labels?: Partial<Record<'disclaimer'|'total'|'payment'|'residual'|'non_fiscal',string>>;
  partial_payment?: { title: string; subtitle: string };
  render_mode?: TicketRenderMode;
  /** Currency mark on amounts: "EUR 17,90" (default) or "€ 17,90" (printed as graphics). */
  currency?: 'EUR' | '€';
  native_profile?: 'custom-kube-ii';
  header: {
    visible: boolean;
    show_restaurant_name: boolean;
    custom_text: string;
  };
  table: {
    visible: boolean;
    label: string;
  };
  timestamp: {
    visible: boolean;
  };
  items: {
    show_ayce: boolean;
    show_cover: boolean;
    show_extras: boolean;
    show_extra_details?: boolean;
    /** Share/saldo receipts: list the whole table bill (default: only the amount paid now). */
    show_table_bill?: boolean;
    /** With the table bill: print "Totale tavolo" and "Diviso N" (default true). */
    show_table_total?: boolean;
    /** Share receipts: each table item reduced to this guest's part ("1/4" or "x0,25"). */
    share_items?: 'fraction' | 'decimal';
  };
  total: {
    visible: boolean;
    show_payment_method: boolean;
  };
  footer: {
    visible: boolean;
    custom_text: string;
    show_non_fiscal_label: boolean;
  };
  separator_char: "-" | "=" | "*";
  width: 32 | 42 | 48 | 80;
  font: EscPosFont;
  sizes_pt?: Partial<Record<'header'|'table'|'timestamp'|'items'|'total'|'footer',number>>;
  printable_dots?: 360|384|512|576|960;
  raster?: {dpi:180|203|300;protocol:'gs-v0'|'esc-star'};
}

export const RECEIPT_LAYER_ORDER = ['partial_title','partial_subtitle','header','header_text','disclaimer','table','timestamp','share_title','ayce','extras','cover','table_total','discount','total','payment','residual','footer','non_fiscal'] as const;
export type ReceiptLayer = typeof RECEIPT_LAYER_ORDER[number];

export function receiptSeparatorGroup(layer: ReceiptLayer): 'partial' | 'top' | 'items' | 'subtotal' | 'total' | 'footer' {
  if (layer === 'partial_title' || layer === 'partial_subtitle') return 'partial';
  if (['header', 'header_text', 'disclaimer', 'table', 'timestamp'].includes(layer)) return 'top';
  if (['share_title', 'ayce', 'extras', 'cover'].includes(layer)) return 'items';
  if (layer === 'table_total' || layer === 'discount') return 'subtotal';
  if (layer === 'total' || layer === 'payment' || layer === 'residual') return 'total';
  return 'footer';
}
export function receiptLinesHasSeparatorAfter(lines: readonly Pick<AnnotatedLine, 'type' | 'preview_layer'>[], layer: ReceiptLayer): boolean {
  let seen = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type !== 'separator' && line.type !== 'blank') {
      if (line.preview_layer === layer) { seen = true; continue; }
      if (seen) return false;
    } else if (seen && line.type === 'separator') {
      return true;
    }
  }
  return false;
}
export type ReceiptSeparatorTarget = { layer: ReceiptLayer; edge: 'after' | 'before' };
export function receiptSeparatorTarget(lines: readonly Pick<AnnotatedLine, 'type' | 'preview_layer'>[], index: number): ReceiptSeparatorTarget | null {
  if (lines[index]?.type !== 'separator') return null;
  let prev: Pick<AnnotatedLine, 'type' | 'preview_layer'> | undefined;
  for (let i = index - 1; i >= 0; i--) {
    if (lines[i].type !== 'separator' && lines[i].type !== 'blank') { prev = lines[i]; break; }
  }
  if (prev && !prev.preview_layer) return null;
  if (prev?.preview_layer && RECEIPT_LAYER_ORDER.includes(prev.preview_layer as ReceiptLayer)) {
    return { layer: prev.preview_layer as ReceiptLayer, edge: 'after' };
  }
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i].type !== 'separator' && lines[i].type !== 'blank') {
      const nextLayer = lines[i].preview_layer;
      if (nextLayer && RECEIPT_LAYER_ORDER.includes(nextLayer as ReceiptLayer)) {
        return { layer: nextLayer as ReceiptLayer, edge: 'before' };
      }
      break;
    }
  }
  return null;
}
export function receiptLayerSection(layer:ReceiptLayer):keyof NonNullable<ReceiptLayoutConfig['sizes_pt']>{
 if(['partial_title','partial_subtitle','header','header_text','disclaimer'].includes(layer))return 'header';
 if(layer==='footer'||layer==='non_fiscal')return 'footer';
 if(layer==='table'||layer==='timestamp'||layer==='total')return layer;
 return 'items';
}
export function receiptLayerStyle(layout:ReceiptLayoutConfig,layer:ReceiptLayer):ReceiptLayerStyle{
 const explicit=layout.layer_styles?.[layer]??{},font=explicit.font??layout.font;
 return {font,size:'normal',bold:layer==='total'||layer==='partial_title',align:['header','table','timestamp','footer'].includes(receiptLayerSection(layer))?'center':'left',space_after:0,...explicit,...(!receiptUsesRaster(layout)&&['ayce','extras','cover','discount','total','payment','residual'].includes(layer)?{align:'left' as const}:{}),size_pt:explicit.size_pt??layout.sizes_pt?.[receiptLayerSection(layer)]??(font==='B'?9:12)};
}

export const DEFAULT_RECEIPT_LAYOUT: ReceiptLayoutConfig = {
  partial_payment: { title: 'PAGAMENTO PARZIALE', subtitle: 'Solo voci pagate' },
  header: {
    visible: true,
    show_restaurant_name: true,
    custom_text: "",
  },
  table: {
    visible: true,
    label: "Tavolo",
  },
  timestamp: {
    visible: true,
  },
  items: {
    show_ayce: true,
    show_cover: true,
    show_extras: true,
    show_extra_details: true,
  },
  total: {
    visible: true,
    show_payment_method: true,
  },
  footer: {
    visible: true,
    custom_text: "Grazie per la visita!",
    show_non_fiscal_label: true,
  },
  separator_char: "-",
  width: 42,
  font: "B",
};

export function normalizeReceiptLayout(raw: unknown): ReceiptLayoutConfig {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_RECEIPT_LAYOUT;
  const h = r.header && typeof r.header === "object" ? (r.header as Record<string, unknown>) : {};
  const tb = r.table && typeof r.table === "object" ? (r.table as Record<string, unknown>) : {};
  const ts = r.timestamp && typeof r.timestamp === "object" ? (r.timestamp as Record<string, unknown>) : {};
  const it = r.items && typeof r.items === "object" ? (r.items as Record<string, unknown>) : {};
  const tot = r.total && typeof r.total === "object" ? (r.total as Record<string, unknown>) : {};
  const ft = r.footer && typeof r.footer === "object" ? (r.footer as Record<string, unknown>) : {};
  const partial = r.partial_payment && typeof r.partial_payment === 'object' && !Array.isArray(r.partial_payment) ? r.partial_payment as Record<string,unknown> : {};
  const partialText = (value: unknown, fallback: string) => typeof value === 'string' ? Array.from(value.replace(/\p{Cc}/gu,' ')).slice(0,80).join('').trim() : fallback;
  const sizes:NonNullable<ReceiptLayoutConfig['sizes_pt']>={};
  const rawSizes=r.sizes_pt&&typeof r.sizes_pt==='object'?r.sizes_pt as Record<string,unknown>:{};
  for(const key of ['header','table','timestamp','items','total','footer'] as const){const value=rawSizes[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=4&&value<=72)sizes[key]=Math.round(value*10)/10;}
  const raster=r.raster&&typeof r.raster==='object'?r.raster as Record<string,unknown>:null;
  const labels:ReceiptLayoutConfig['labels']={};
  const layerStyles:NonNullable<ReceiptLayoutConfig['layer_styles']>={};
  const rawStyles=r.layer_styles&&typeof r.layer_styles==='object'?r.layer_styles as Record<string,unknown>:{};
  for(const key of RECEIPT_LAYER_ORDER){const raw=rawStyles[key];if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;const value=raw as Record<string,unknown>,style:Partial<ReceiptLayerStyle>={};
    if(value.font==='A'||value.font==='B')style.font=value.font;
    if(value.size==='normal'||value.size==='double')style.size=value.size;
    if(typeof value.bold==='boolean')style.bold=value.bold;
    if(value.align==='left'||value.align==='center'||value.align==='right')style.align=value.align;
    if(value.space_after===0||value.space_after===1||value.space_after===2)style.space_after=value.space_after;
    if(typeof value.size_pt==='number'&&Number.isFinite(value.size_pt)&&value.size_pt>=4&&value.size_pt<=72)style.size_pt=Math.round(value.size_pt*10)/10;
    if(typeof value.separator_after==='boolean')style.separator_after=value.separator_after;
    if(typeof value.separator_before==='boolean')style.separator_before=value.separator_before;
    if(Object.keys(style).length)layerStyles[key]=style;
  }
  for(const key of ['disclaimer','total','payment','residual','non_fiscal'] as const){const value=(r.labels as Record<string,unknown>|undefined)?.[key];if(typeof value==='string'&&value.trim())labels[key]=partialText(value,'');}

  return {
    ...(Object.keys(layerStyles).length?{layer_styles:layerStyles}:{}),
    ...(r.separators==='sections'||r.separators==='none'?{separators:r.separators}:{}),
    ...(Object.keys(labels).length?{labels}:{}),
    ...(Array.isArray(r.layer_order)?{layer_order:[...new Set([...r.layer_order.filter((key):key is ReceiptLayer=>RECEIPT_LAYER_ORDER.includes(key as ReceiptLayer)),...RECEIPT_LAYER_ORDER])]}:{}),
    ...(Array.isArray(r.hidden_layers)?{hidden_layers:[...new Set(r.hidden_layers.filter((key):key is ReceiptLayer=>RECEIPT_LAYER_ORDER.includes(key as ReceiptLayer)&&key!=='discount'))]}:{}),
    partial_payment: { title: partialText(partial.title,d.partial_payment!.title), subtitle: partialText(partial.subtitle,d.partial_payment!.subtitle) },
    ...(r.native_profile === 'custom-kube-ii' ? { native_profile: 'custom-kube-ii' as const } : {}),
    ...(r.currency === '€' ? { currency: '€' as const } : {}),
    ...(r.render_mode === 'native' || r.render_mode === 'raster' ? { render_mode: r.render_mode } : {}),
    ...(Object.keys(sizes).length?{sizes_pt:sizes}:{}),
    ...(r.printable_dots!=null||Object.keys(sizes).length||r.render_mode==='raster'?{printable_dots:([360,384,512,576,960].includes(Number(r.printable_dots))?Number(r.printable_dots):Number(r.width)===32?384:Number(r.width)===80?960:576) as 360|384|512|576|960}:{}),
    ...(raster?{raster:{dpi:([180,203,300].includes(Number(raster.dpi))?Number(raster.dpi):203) as 180|203|300,protocol:raster.protocol==='esc-star'?'esc-star' as const:'gs-v0' as const}}:{}),
    header: {
      visible: h.visible !== false,
      show_restaurant_name: h.show_restaurant_name !== false,
      custom_text: typeof h.custom_text === "string" ? h.custom_text : "",
    },
    table: {
      visible: tb.visible !== false,
      label: typeof tb.label === "string" && tb.label.trim() ? tb.label.trim() : d.table.label,
    },
    timestamp: {
      visible: ts.visible !== false,
    },
    items: {
      show_ayce: it.show_ayce !== false,
      show_cover: it.show_cover !== false,
      show_extras: it.show_extras !== false,
      show_extra_details: it.show_extra_details !== false,
      ...(it.show_table_bill === true ? { show_table_bill: true } : {}),
      ...(it.show_table_total === false ? { show_table_total: false } : {}),
      ...(it.share_items === 'fraction' || it.share_items === 'decimal' ? { share_items: it.share_items } : {}),
    },
    total: {
      visible: tot.visible !== false,
      show_payment_method: tot.show_payment_method !== false,
    },
    footer: {
      visible: ft.visible !== false,
      custom_text: typeof ft.custom_text === "string" && ft.custom_text.trim() ? ft.custom_text : d.footer.custom_text,
      show_non_fiscal_label: ft.show_non_fiscal_label !== false,
    },
    separator_char: ["-", "=", "*"].includes(String(r.separator_char)) ? (String(r.separator_char) as "-" | "=" | "*") : d.separator_char,
    width: ([32, 42, 48, 80] as number[]).includes(Number(r.width)) ? (Number(r.width) as 32 | 42 | 48 | 80) : d.width,
    font: r.font === "A" ? "A" : "B",
  };
}

function wrapReceiptLine(text: string, width: number): string[] {
  // Preserve amount-column spacing, but never pass printer control bytes.
  // eslint-disable-next-line no-control-regex -- text must not inject ESC/POS commands.
  const safe = text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  const rows: string[] = [];
  let row = '', columns = 0;
  for (const char of Array.from(safe)) {
    const size = /[\u2e80-\u9fff]/u.test(char) ? 2 : 1;
    if (columns + size > width) { rows.push(row); row = ''; columns = 0; }
    row += char; columns += size;
  }
  rows.push(row); return rows;
}
export interface ReceiptBreakdownItem { id?: string; name: string; quantity: number; unit_price: number; line_total: number }
export interface ReceiptBreakdown {
  version: 1;
  ayce_items: ReceiptBreakdownItem[];
  cover_item?: ReceiptBreakdownItem | null;
  amount_due_after?: number;
  /** Whole table bill (whole quantities) printed on share receipts and on a saldo after earlier payments. */
  table_bill?: ReceiptTableBill | null;
}
export interface ReceiptTableBillLine { kind?: string; name: string; quantity: number; unit_price?: number; line_total: number }
export interface ReceiptTableBill { lines: ReceiptTableBillLine[]; total: number; covers?: number; paid_before?: number }
export interface NonFiscalReceiptPayload {
  layout_test?: boolean;
  /** Preconto: the bill being prepared, printed before any payment is recorded. */
  pre_bill?: boolean;
  receipt_breakdown?: ReceiptBreakdown | null;
  restaurant_name?: string;
  table_number?: string | number | null;
  paid_at?: string | null;
  payment_method?: "card" | "cash" | string;
  payment_scope?: string;
  persons_at_payment?: number;
  ayce_total?: number;
  cover_total?: number;
  extras_total?: number;
  total_amount?: number;
  discount_total?: number;
  extra_items?: Array<{ name: string; quantity: number; unit_price: number; line_total: number }>;
}

export interface NonFiscalReceiptRenderResult {
  text: string;
  html: string;
  lines: AnnotatedLine[];
}

function toStr(value: unknown): string {
  if (value == null) return "";
  // eslint-disable-next-line no-control-regex -- never inject printer commands.
  return String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

function formatCurrency(value: unknown, mark = "EUR"): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${mark} 0,00`;
  const str = Math.abs(n).toFixed(2).replace(".", ",");
  return `${mark} ${str}`;
}

function padRow(label: string, value: string, width: number): string {
  const columns = (text: string) => Array.from(text).reduce((count, char) => count + (/[\u2e80-\u9fff]/u.test(char) ? 2 : 1), 0);
  const gap = width - columns(label) - columns(value);
  return label + " ".repeat(Math.max(1, gap)) + value;
}

function centerText(input: string, width: number): string {
  if (input.length >= width) return input;
  const pad = Math.floor((width - input.length) / 2);
  return " ".repeat(pad) + input;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Unknown when the venue does not ask the method (no fiscalization): no payment line is printed. */
function normalizePaymentMethod(raw: unknown): "card" | "cash" | null {
  const s = toStr(raw).toLowerCase().trim();
  return !s ? null : s === "cash" || s === "contanti" ? "cash" : "card";
}

export function renderNonFiscalReceiptTicket(
  payload: NonFiscalReceiptPayload,
  options?: { layout?: unknown },
): NonFiscalReceiptRenderResult {
  const currencyMark = normalizeReceiptLayout(options?.layout).currency === '€' ? '€' : 'EUR';
  const money = (value: unknown) => formatCurrency(value, currencyMark);
  const layout = normalizeReceiptLayout(options?.layout);
  const metric = ticketFontMetrics(layout, layout.font);
  const dots = layout.printable_dots;
  const width = dots != null ? Math.max(1, Math.floor((dots - 8) / metric.cell)) : layout.width;
  const sepChar = layout.separator_char;
  const sep = sepChar.repeat(width);
  const sepDouble = "=".repeat(width);

  const restaurantName = toStr(payload.restaurant_name).trim() || "Il Tuo Ristorante";
  const preBill = payload.pre_bill === true;
  const tableLabel = (preBill ? toStr(payload.table_number).replace(/ - PRECONTO$/, '') : toStr(payload.table_number)).trim() || "-";
  const paidAt = formatTimestamp(payload.paid_at);
  const paymentMethod = normalizePaymentMethod(payload.payment_method);
  const paymentLabel = paymentMethod === "cash" ? "Contanti" : paymentMethod === "card" ? "Carta" : null;
  const paymentScope = toStr(payload.payment_scope).toLowerCase().trim();
  const personsAtPayment = Math.max(1, Math.trunc(Number(payload.persons_at_payment ?? 1) || 1));
  const ayceTotal = Number(payload.ayce_total) || 0;
  const coverTotal = Number(payload.cover_total) || 0;
  const extrasTotal = Number(payload.extras_total) || 0;
  const totalAmount = Number(payload.total_amount) || 0;
  const breakdown = payload.receipt_breakdown?.version === 1 ? payload.receipt_breakdown : null;
  const ayceItems = Array.isArray(breakdown?.ayce_items) ? breakdown.ayce_items : [];
  const coverItem = breakdown?.cover_item;
  const remaining = breakdown?.amount_due_after;
  const partial = !preBill && typeof remaining === 'number' && Number.isFinite(remaining) && remaining > 0;
  const cents = (value: number) => Math.round(value * 100);
  const validItem = (item: ReceiptBreakdownItem | null | undefined): item is ReceiptBreakdownItem => Boolean(item &&
    toStr(item.name).trim() && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 1000 &&
    Number.isFinite(item.unit_price) && item.unit_price >= 0 && Number.isFinite(item.line_total) && item.line_total >= 0 &&
    cents(item.quantity * item.unit_price) === cents(item.line_total));
  const extrasLabel = paymentScope === "roman_split"
    ? (personsAtPayment === 1 ? "1 Quota" : `${personsAtPayment} Quote`)
    : "Extra";

  let lines: AnnotatedLine[] = [];
  let layer:ReceiptLayer|undefined;
  const pushLine=(line:AnnotatedLine)=>lines.push({...line,preview_layer:layer});
  let previewField: string | undefined = 'header';
  const partialLabels=layout.partial_payment??DEFAULT_RECEIPT_LAYOUT.partial_payment!;
  const content = [restaurantName, tableLabel,layout.table.label, ...Object.values(layout.labels??{}), layout.header.custom_text, layout.footer.custom_text, ...(partial?[partialLabels.title,partialLabels.subtitle]:[]), ...ayceItems.map(item => item?.name ?? ''), ...(payload.extra_items ?? []).map(item => item?.name ?? '')].join(' ');
  // The euro sign is not in the printers' ASCII text set: print it as graphics.
  const rasterMode=receiptUsesRaster(layout) || currencyMark === '€' || /[^\x20-\x7e]/u.test(toStr(content));
  const addLine = (text: string, type: AnnotatedLine["type"], pointSection?:keyof NonNullable<ReceiptLayoutConfig['sizes_pt']>,bold=false,right_text?:string) => {
    text = toStr(text);
    const section=pointSection??(type==='header'||type==='table'||type==='timestamp'||type==='footer'?type:'items');
    const explicit=layer&&type!=='separator'&&type!=='blank'?layout.layer_styles?.[layer]:undefined;
    const style=explicit&&layer?receiptLayerStyle(layout,layer):undefined;
    const font=style?.font??layout.font;
    if(rasterMode){pushLine({text:text.trim(),type,size:style?.size??'normal',bold:style?.bold??bold,align:style?.align??(['header','table','timestamp','footer'].includes(section)?'center':'left'),font,size_pt:style?.size_pt??layout.sizes_pt?.[section]??(layout.font==='B'?9:12),right_text,preview_field:type==='blank'||type==='separator'?undefined:previewField,section:section==='total'?'items':section});return;}
    const nativeMetric=ticketFontMetrics(layout,font),factor=style?.size==='double'?2:1;
    const available=dots!=null?dots-8:width*metric.cell;
    const columns=style?Math.max(1,Math.floor((available-(right_text?right_text.length*nativeMetric.cell+nativeMetric.cell:0))/(nativeMetric.cell*factor))):width;
    const chunks=wrapReceiptLine(style?text.trim():text,columns);
    for (const [index,chunk] of chunks.entries()) pushLine({ text: chunk, type, size: style?.size??'normal', bold:style?.bold??bold, align:style?.align??'left', font, cell_dots: nativeMetric.cell, glyph_dots: nativeMetric.glyph, ...(right_text&&index===chunks.length-1 ? { right_text } : {}), preview_field:type==='blank'||type==='separator'?undefined:previewField });
  };
  const addAmount=(label:string,value:string)=> {
    const safeLabel = toStr(label), safeValue = toStr(value);
    if (rasterMode) { addLine(safeLabel, 'item', 'items', false, safeValue); return; }
    if(layer&&layout.layer_styles?.[layer]){addLine(safeLabel,'item','items',false,safeValue);return;}
    const labelWidth = Math.max(1, width - safeValue.length - 1);
    const chunks = wrapReceiptLine(safeLabel, labelWidth);
    chunks.forEach((chunk, index) => addLine(chunk, 'item', 'items', false, index === chunks.length - 1 ? safeValue : undefined));
  };
  const addSep = (char?: string) => addLine((char ?? sepChar).repeat(width), "separator");
  const addBlank = () => addLine("", "blank");

  // These notices belong to the document, including when the editable header
  // is hidden. A synthetic print must never look like a customer's actual bill.
  previewField = undefined;
  if (payload.layout_test === true) {
    addLine(centerText('*** PROVA STAMPA ***', width), 'header', 'header', true);
    addLine(centerText('DATI DI ESEMPIO', width), 'header');
    addSep('=');
  }
  if (preBill) {
    layer='partial_title';
    addLine(centerText('PRECONTO', width), 'header', 'header', true);
    layer='partial_subtitle';
    addLine(centerText('Conto da pagare', width), 'header');
    addSep();
  }
  if (partial) {
    layer='partial_title';
    if(partialLabels.title) addLine(centerText(partialLabels.title, width), 'header', 'header', true);
    layer='partial_subtitle';
    if(partialLabels.subtitle) addLine(centerText(partialLabels.subtitle, width), 'header');
    if(partialLabels.title||partialLabels.subtitle) addSep();
  }
  previewField = 'header';

  // Header
  layer='header';
  if (layout.header.visible) {
    addSep("=");
    if (layout.header.show_restaurant_name) {
      addLine(centerText(restaurantName, width), "header");
    }
    layer='header_text';
    if (layout.header.custom_text.trim()) {
      addLine(centerText(layout.header.custom_text.trim(), width), "header");
    }
    addSep("=");
    layer='disclaimer';
    addLine(centerText(layout.labels?.disclaimer??"SCONTRINO NON FISCALE", width), "header");
    addSep();
  }

  // Table + timestamp
  layer='table';
  previewField = 'table';
  if (layout.table.visible) {
    addLine(centerText(`${layout.table.label}: ${tableLabel}`, width), "table");
  }
  layer='timestamp';
  previewField = 'timestamp';
  if (layout.timestamp.visible && paidAt) {
    addLine(centerText(`Data:   ${paidAt}`, width), "timestamp");
  }
  if (layout.table.visible || layout.timestamp.visible) {
    addSep();
  }

  // Items breakdown
  let hasItems = false;
  // Equal split and saldo after earlier payments: "Pagamento 1 quota su 4", the
  // whole table bill with whole quantities, "Totale tavolo", "Diviso 4 … cad."
  // (or "Già pagato"), then the amount paid now. No fractional lines.
  const romanShareGross = ayceTotal + extrasTotal + coverTotal;
  const rawBill = breakdown?.table_bill;
  const tableBill = rawBill && Array.isArray(rawBill.lines) && rawBill.lines.length > 0 && Number.isFinite(rawBill.total)
    && rawBill.lines.every(line => Boolean(line && toStr(line.name).trim() && Number.isSafeInteger(line.quantity) && line.quantity > 0 && Number.isFinite(line.line_total) && line.line_total >= 0))
    && rawBill.lines.reduce((total, line) => total + cents(line.line_total), 0) === cents(rawBill.total) ? rawBill : null;
  const billCovers = tableBill && Number.isSafeInteger(tableBill.covers) && Number(tableBill.covers) > 0 ? Number(tableBill.covers) : 0;
  const paidBefore = tableBill && Number.isFinite(tableBill.paid_before) ? Number(tableBill.paid_before) : 0;
  const saldoAfterPayments = paymentScope === 'full_total' && tableBill !== null && paidBefore > 0;
  const shareReceipt = paymentScope === 'roman_split' && romanShareGross > 0;
  // Default: a share (or a saldo after shares) shows only what this guest pays.
  // Share items: every table item reduced to the paid shares (needs equal shares).
  const shareRatioOk = Boolean(tableBill && billCovers > 0 && shareReceipt
    && Math.abs(Math.round(cents(tableBill.total) * personsAtPayment / billCovers) - cents(romanShareGross)) <= personsAtPayment);
  const shareItems = Boolean(layout.items.share_items && shareRatioOk);
  const detailedBill = Boolean(tableBill && (layout.items.show_table_bill || shareItems));
  const compactShare = (shareReceipt || saldoAfterPayments) && !detailedBill;
  if ((shareReceipt || saldoAfterPayments) && (layout.items.show_ayce || layout.items.show_extras || layout.items.show_cover)) {
    layer='extras';
    previewField = 'extras';
    const shareWord = personsAtPayment === 1 ? 'quota' : 'quote';
    const title = saldoAfterPayments ? (preBill ? 'Conto da saldare' : 'Saldo conto')
      : `${preBill ? 'Conto' : 'Pagamento'} ${personsAtPayment} ${shareWord}${billCovers >= personsAtPayment ? ` su ${billCovers}` : ''}`;
    if (tableBill && shareItems) {
      layer='share_title';
      previewField = 'share_title';
      addLine(title, 'item', 'items', true);
      const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
      const target = cents(romanShareGross);
      const amounts = tableBill.lines.map(line => Math.floor(cents(line.line_total) * personsAtPayment / billCovers));
      let rest = target - amounts.reduce((sum, value) => sum + value, 0);
      for (let index = 0; rest > 0 && index < amounts.length * 2; index++, rest--) amounts[index % amounts.length] += 1;
      tableBill.lines.forEach((line, index) => {
        const kind = line.kind === 'ayce' ? 'ayce' : line.kind === 'cover' ? 'cover' : 'extras';
        if (kind === 'ayce' ? !layout.items.show_ayce : kind === 'cover' ? !layout.items.show_cover : !layout.items.show_extras) return;
        layer = kind;
        previewField = kind;
        const numerator = line.quantity * personsAtPayment;
        const unit = Number.isFinite(line.unit_price) && Number(line.unit_price) > 0 ? money(line.unit_price) : null;
        const name = toStr(line.name).trim();
        let label: string;
        if (numerator % billCovers === 0) {
          const whole = numerator / billCovers;
          label = `${whole}x ${name}${whole > 1 && unit ? ` (${unit})` : ''}`;
        } else if (layout.items.share_items === 'decimal') {
          label = `${name} (${unit ? `${unit} ` : ''}x${String(Math.round(numerator / billCovers * 100) / 100).replace('.', ',')})`;
        } else {
          const divisor = gcd(numerator, billCovers);
          label = `${numerator / divisor}/${billCovers / divisor} ${name}${unit ? ` (${unit})` : ''}`;
        }
        addAmount(label, money(amounts[index] / 100));
      });
    } else if (tableBill && detailedBill) {
      layer='share_title';
      previewField = 'share_title';
      addLine(title, 'item', 'items', true);
      for (const line of tableBill.lines) {
        const kind = line.kind === 'ayce' ? 'ayce' : line.kind === 'cover' ? 'cover' : 'extras';
        if (kind === 'ayce' ? !layout.items.show_ayce : kind === 'cover' ? !layout.items.show_cover : !layout.items.show_extras) continue;
        layer = kind;
        previewField = kind;
        addAmount(`${line.quantity}x ${toStr(line.name).trim()}${line.quantity > 1 && Number.isFinite(line.unit_price) && Number(line.unit_price) > 0 ? ` (${money(line.unit_price)})` : ''}`, money(line.line_total));
      }
      layer='table_total';
      previewField = 'table_total';
      addSep();
      // "Totale tavolo" is optional; "Diviso N" always explains the share.
      const showTableTotal = layout.items.show_table_total !== false;
      if (showTableTotal) addAmount('Totale tavolo', money(tableBill.total));
      if (saldoAfterPayments) { if (showTableTotal) addAmount("Gia' pagato", `-${money(paidBefore)}`); }
      else if (billCovers > 0) {
        const perCents = Math.round(cents(tableBill.total) / billCovers);
        if (Math.abs(perCents * personsAtPayment - cents(romanShareGross)) <= personsAtPayment) addAmount(`Diviso ${billCovers}`, `${money(perCents / 100)} cad.`);
      }
    } else {
      addAmount(saldoAfterPayments ? title : `${personsAtPayment} ${shareWord}${billCovers >= personsAtPayment ? ` su ${billCovers}` : ''}`, money(totalAmount));
    }
    hasItems = true;
  }
  if (!shareReceipt && !(saldoAfterPayments && (layout.items.show_ayce || layout.items.show_extras || layout.items.show_cover))) {
  layer='ayce';
  previewField = 'ayce';
  const detailedAyce = ayceItems.length > 0 && ayceItems.every(validItem) &&
    ayceItems.reduce((total, item) => total + cents(item.line_total), 0) === cents(ayceTotal);
  if (layout.items.show_ayce && (ayceTotal > 0 || detailedAyce)) {
    if (detailedAyce) for (const item of ayceItems) {
      addAmount(`${item.quantity}x ${toStr(item.name).trim()}${item.quantity > 1 ? ` (${money(item.unit_price)})` : ''}`, money(item.line_total));
    }
    else addAmount(paymentScope === 'roman_split' ? 'Quota menu AYCE' : 'AYCE', money(ayceTotal));
    hasItems = true;
  }
  layer='extras';
  previewField = 'extras';
  if (layout.items.show_extras && extrasTotal > 0) {
    const items = Array.isArray(payload.extra_items) ? payload.extra_items : [];
    const cents = (value: number) => Math.round(value * 100);
    const valid = layout.items.show_extra_details !== false && paymentScope !== 'roman_split' && items.length > 0 && items.every(item =>
      item && toStr(item.name).trim() && Number.isInteger(item.quantity) && item.quantity > 0 &&
      Number.isFinite(item.unit_price) && item.unit_price > 0 && Number.isFinite(item.line_total) && item.line_total > 0 &&
      cents(item.quantity * item.unit_price) === cents(item.line_total)) &&
      items.reduce((total, item) => total + cents(item.line_total), 0) === cents(extrasTotal);
    if (valid) {
      for (const item of items) {
        addAmount(`${item.quantity}x ${toStr(item.name).trim()}${item.quantity > 1 ? ` (${money(item.unit_price)})` : ''}`, money(item.line_total));
      }
    } else addAmount(extrasLabel, money(extrasTotal));
    hasItems = true;
  }
  layer='cover';
  previewField = 'cover';
  if (layout.items.show_cover && coverTotal > 0) {
    if (validItem(coverItem) && cents(coverItem.line_total) === cents(coverTotal)) {
      addAmount(`${coverItem.quantity}x Coperto${coverItem.quantity > 1 ? ` (${money(coverItem.unit_price)})` : ''}`, money(coverTotal));
    } else addAmount("Coperto", money(coverTotal));
    hasItems = true;
  }
  }
  if (hasItems) addSep();
  previewField = undefined;
  layer='discount';
  if (!compactShare && Number.isFinite(payload.discount_total) && Number(payload.discount_total) > 0) {
    addAmount('Sconto', `-${money(payload.discount_total)}`);
    addSep();
  }

  // Total
  layer='total';
  previewField = 'total';
  if (layout.total.visible) {
    const totalLabel = layout.labels?.total ?? (shareReceipt && detailedBill && !shareItems ? (preBill ? 'QUOTA' : 'QUOTA PAGATA') : 'TOTALE');
    addLine(totalLabel, 'item', 'total', true, money(totalAmount));
    layer='payment';
  previewField = 'payment';
  if (layout.total.show_payment_method && paymentLabel) {
      addAmount(layout.labels?.payment??"Pagamento", paymentLabel);
    }
    addSep("=");
  }

  if (partial && !compactShare && !layout.hidden_layers?.includes('residual')) {
    layer='residual';
    previewField = undefined;
    addAmount(layout.labels?.residual??'Residuo dopo pagamento', money(remaining));
    addSep();
  }

  // Footer
  layer='footer';
  previewField = 'footer';
  if (layout.footer.visible) {
    if (layout.footer.custom_text.trim()) {
      for (const line of layout.footer.custom_text.trim().split(/\r\n|\r|\n/)) {
        addLine(centerText(line.trim(), width), "footer");
      }
    }
    layer='non_fiscal';
    if (layout.footer.show_non_fiscal_label) {
      addLine(centerText(layout.labels?.non_fiscal??"*** NON FISCALE ***", width), "footer");
    }
    addSep("=");
  }

  if(layout.layer_styles){
    lines=lines.flatMap((line,index,all)=>{const key=line.preview_layer as ReceiptLayer|undefined;const count=key?layout.layer_styles?.[key]?.space_after??0:0;
      if(!key||!count||all.slice(index+1).some(next=>next.preview_layer===key)||!all.some(row=>row.preview_layer===key&&row.type!=='blank'&&row.type!=='separator'))return [line];
      return [line,...Array.from({length:count},()=>({text:'',type:'blank' as const,size:'normal' as const,bold:false,preview_layer:key,...(rasterMode?{size_pt:9}:{})}))];
    });
  }
  if(!layout.layer_order&&layout.hidden_layers?.length){
    lines=lines.filter(line=>!line.preview_layer||!layout.hidden_layers?.includes(line.preview_layer as ReceiptLayer));
  }else if(layout.layer_order){
    const proof=lines.filter(line=>!line.preview_layer);
    const content=lines.filter(line=>line.preview_layer&&!layout.hidden_layers?.includes(line.preview_layer as ReceiptLayer));
    const ordered:AnnotatedLine[]=[...proof];
    for(const key of layout.layer_order??RECEIPT_LAYER_ORDER){
      const rows=content.filter(line=>line.preview_layer===key);
      if(!rows.some(line=>line.type!=='separator'&&line.type!=='blank'))continue;
      if(ordered.length&&ordered.at(-1)?.type!=='separator'&&rows[0].type!=='separator')ordered.push({text:sepChar.repeat(width),type:'separator',size:'normal',bold:false,font:layout.font,...(rasterMode?{size_pt:9}:{})});
      ordered.push(...rows);
    }
    lines=ordered;
  }
  const hasSeparatorOverrides = Object.values(layout.layer_styles ?? {}).some(
    style => typeof style?.separator_after === 'boolean' || typeof style?.separator_before === 'boolean',
  );
  if (layout.separators === 'sections' || layout.separators === 'none' || hasSeparatorOverrides) {
    const makeSep = (owner?: ReceiptLayer): AnnotatedLine => ({
      text: sepChar.repeat(width),
      type: 'separator',
      size: 'normal',
      bold: false,
      align: 'left',
      font: layout.font,
      ...(rasterMode
        ? { size_pt: layout.sizes_pt?.items ?? (layout.font === 'B' ? 9 : 12), section: 'items' as const }
        : { cell_dots: metric.cell, glyph_dots: metric.glyph }),
      ...(owner ? { preview_layer: owner } : {}),
    });
    const proofCount = payload.layout_test === true ? 3 : 0;
    const proof = lines.slice(0, proofCount);
    const body = lines.slice(proofCount);
    if (layout.separators === 'sections' || layout.separators === 'none') {
      const contentOnly = body.filter(
        line => line.preview_layer && line.type !== 'separator' && !layout.hidden_layers?.includes(line.preview_layer as ReceiptLayer),
      );
      const order = layout.layer_order ?? RECEIPT_LAYER_ORDER;
      const visibleLayers: Array<{ key: ReceiptLayer; rows: AnnotatedLine[] }> = [];
      for (const key of order) {
        const rows = contentOnly.filter(line => line.preview_layer === key);
        if (rows.some(line => line.type !== 'blank')) visibleLayers.push({ key, rows });
      }
      const assembled: AnnotatedLine[] = [...proof];
      visibleLayers.forEach((entry, idx) => {
        if (idx === 0 && layout.layer_styles?.[entry.key]?.separator_before === true) {
          assembled.push(makeSep(entry.key));
        }
        assembled.push(...entry.rows);
        const next = visibleLayers[idx + 1];
        const explicit = layout.layer_styles?.[entry.key]?.separator_after;
        const want = next
          ? (explicit ?? (layout.separators === 'sections' && receiptSeparatorGroup(entry.key) !== receiptSeparatorGroup(next.key)))
          : explicit === true;
        if (want) assembled.push(makeSep(entry.key));
      });
      lines = assembled;
    } else {
      // Legacy ('all') mode with selective per-layer separator overrides.
      const leadingSeps: AnnotatedLine[] = [];
      const runs: Array<{ key: ReceiptLayer; rows: AnnotatedLine[]; trailingSeps: AnnotatedLine[] }> = [];
      for (const line of body) {
        if (line.type === 'separator') {
          if (runs.length === 0) leadingSeps.push(line);
          else runs[runs.length - 1].trailingSeps.push(line);
        } else if (line.type === 'blank') {
          if (runs.length > 0) runs[runs.length - 1].rows.push(line);
        } else {
          const key = line.preview_layer as ReceiptLayer | undefined;
          if (!key) continue;
          const last = runs[runs.length - 1];
          if (last && last.key === key && last.trailingSeps.length === 0) {
            last.rows.push(line);
          } else {
            runs.push({ key, rows: [line], trailingSeps: [] });
          }
        }
      }
      const assembled: AnnotatedLine[] = [...proof];
      if (runs.length > 0) {
        const firstBefore = layout.layer_styles?.[runs[0].key]?.separator_before;
        if (firstBefore === true) {
          assembled.push(...(leadingSeps.length ? leadingSeps : [makeSep(runs[0].key)]));
        } else if (firstBefore !== false) {
          assembled.push(...leadingSeps);
        }
      }
      runs.forEach((run, idx) => {
        assembled.push(...run.rows);
        const isLast = idx === runs.length - 1;
        const after = layout.layer_styles?.[run.key]?.separator_after;
        if (after === false) {
          // explicitly hidden
        } else if (after === true) {
          assembled.push(...(run.trailingSeps.length ? run.trailingSeps : [makeSep(run.key)]));
        } else if (!isLast || run.trailingSeps.length) {
          assembled.push(...run.trailingSeps);
        }
      });
      lines = assembled;
    }
  }
  const text = lines.map((l) => l.right_text ? `${l.text}  ${l.right_text}` : l.text).join("\n");
  const htmlLines = lines
    .map((l) => {
      const styles: string[] = [];
      if (l.size === "double") styles.push("font-size:1.35em");
      if (l.bold) styles.push("font-weight:bold");
      const style = styles.join(";");
      return `<span${style ? ` style="${style}"` : ""}>${escapeHtml(l.right_text ? `${l.text}  ${l.right_text}` : l.text) || "\u00A0"}</span>`;
    })
    .join("\n");
  const html = `<div class="ticket-preview receipt-preview"><pre>${htmlLines}</pre></div>`;

  return { text, html, lines };
}
