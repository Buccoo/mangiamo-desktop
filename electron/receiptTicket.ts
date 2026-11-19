const { ticketFontMetrics } = require('./kitchenTicket.cjs') as typeof import('./kitchenTicket');
import type { AnnotatedLine, EscPosFont, TicketRenderMode } from './kitchenTicket';
export function receiptUsesRaster(layout: Pick<ReceiptLayoutConfig, 'render_mode' | 'sizes_pt'>) {
  return layout.render_mode === 'raster' || layout.render_mode !== 'native' && Object.keys(layout.sizes_pt ?? {}).length > 0;
}
export interface ReceiptLayoutConfig {
  layer_order?: ReceiptLayer[];
  hidden_layers?: ReceiptLayer[];
  labels?: Partial<Record<'disclaimer'|'total'|'payment'|'residual'|'non_fiscal',string>>;
  partial_payment?: { title: string; subtitle: string };
  render_mode?: TicketRenderMode;
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

export const RECEIPT_LAYER_ORDER = ['partial_title','partial_subtitle','header','header_text','disclaimer','table','timestamp','ayce','extras','cover','discount','total','payment','residual','footer','non_fiscal'] as const;
export type ReceiptLayer = typeof RECEIPT_LAYER_ORDER[number];

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
  for(const key of ['disclaimer','total','payment','residual','non_fiscal'] as const){const value=(r.labels as Record<string,unknown>|undefined)?.[key];if(typeof value==='string'&&value.trim())labels[key]=partialText(value,'');}

  return {
    ...(Object.keys(labels).length?{labels}:{}),
    ...(Array.isArray(r.layer_order)?{layer_order:[...new Set([...r.layer_order.filter((key):key is ReceiptLayer=>RECEIPT_LAYER_ORDER.includes(key as ReceiptLayer)),...RECEIPT_LAYER_ORDER])]}:{}),
    ...(Array.isArray(r.hidden_layers)?{hidden_layers:[...new Set(r.hidden_layers.filter((key):key is ReceiptLayer=>RECEIPT_LAYER_ORDER.includes(key as ReceiptLayer)&&key!=='residual'&&key!=='discount'))]}:{}),
    partial_payment: { title: partialText(partial.title,d.partial_payment!.title), subtitle: partialText(partial.subtitle,d.partial_payment!.subtitle) },
    ...(r.native_profile === 'custom-kube-ii' ? { native_profile: 'custom-kube-ii' as const } : {}),
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
}
export interface NonFiscalReceiptPayload {
  layout_test?: boolean;
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

function formatCurrency(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "EUR 0,00";
  const str = Math.abs(n).toFixed(2).replace(".", ",");
  return `EUR ${str}`;
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

function normalizePaymentMethod(raw: unknown): "card" | "cash" {
  const s = toStr(raw).toLowerCase().trim();
  return s === "cash" || s === "contanti" ? "cash" : "card";
}

export function renderNonFiscalReceiptTicket(
  payload: NonFiscalReceiptPayload,
  options?: { layout?: unknown },
): NonFiscalReceiptRenderResult {
  const layout = normalizeReceiptLayout(options?.layout);
  const metric = ticketFontMetrics(layout, layout.font);
  const dots = layout.printable_dots;
  const width = dots != null ? Math.max(1, Math.floor((dots - 8) / metric.cell)) : layout.width;
  const sepChar = layout.separator_char;
  const sep = sepChar.repeat(width);
  const sepDouble = "=".repeat(width);

  const restaurantName = toStr(payload.restaurant_name).trim() || "Il Tuo Ristorante";
  const tableLabel = toStr(payload.table_number).trim() || "-";
  const paidAt = formatTimestamp(payload.paid_at);
  const paymentMethod = normalizePaymentMethod(payload.payment_method);
  const paymentLabel = paymentMethod === "cash" ? "Contanti" : "Carta";
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
  const partial = typeof remaining === 'number' && Number.isFinite(remaining) && remaining > 0;
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
  const rasterMode=receiptUsesRaster(layout) || /[^\x20-\x7e]/u.test(toStr(content));
  const addLine = (text: string, type: AnnotatedLine["type"], pointSection?:keyof NonNullable<ReceiptLayoutConfig['sizes_pt']>,bold=false,right_text?:string) => {
    text = toStr(text);
    const section=pointSection??(type==='header'||type==='table'||type==='timestamp'||type==='footer'?type:'items');
    if(rasterMode){pushLine({text:text.trim(),type,size:'normal',bold,align:['header','table','timestamp','footer'].includes(section)?'center':'left',font:layout.font,size_pt:layout.sizes_pt?.[section]??(layout.font==='B'?9:12),right_text,preview_field:type==='blank'||type==='separator'?undefined:previewField,section:section==='total'?'items':section});return;}
    for (const chunk of wrapReceiptLine(text, width)) pushLine({ text: chunk, type, size: "normal", bold, align: "left", font: layout.font, cell_dots: metric.cell, glyph_dots: metric.glyph, ...(right_text ? { right_text } : {}), preview_field:type==='blank'||type==='separator'?undefined:previewField });
  };
  const addAmount=(label:string,value:string)=> {
    const safeLabel = toStr(label), safeValue = toStr(value);
    if (rasterMode) { addLine(safeLabel, 'item', 'items', false, safeValue); return; }
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
  layer='ayce';
  previewField = 'ayce';
  const detailedAyce = paymentScope !== 'roman_split' && ayceItems.length > 0 && ayceItems.every(validItem) &&
    ayceItems.reduce((total, item) => total + cents(item.line_total), 0) === cents(ayceTotal);
  if (layout.items.show_ayce && (ayceTotal > 0 || detailedAyce)) {
    if (detailedAyce) for (const item of ayceItems) {
      addAmount(`${item.quantity}x ${toStr(item.name).trim()}`, formatCurrency(item.line_total));
      if (item.quantity > 1) addLine(`${formatCurrency(item.unit_price)} cad.`, 'item_sub');
    }
    else addAmount(paymentScope === 'roman_split' ? 'Quota menu AYCE' : 'AYCE', formatCurrency(ayceTotal));
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
        addAmount(`${item.quantity}x ${toStr(item.name).trim()}`, formatCurrency(item.line_total));
        if (item.quantity > 1) addLine(`  ${formatCurrency(item.unit_price)} cad.`, 'item_sub');
      }
    } else addAmount(extrasLabel, formatCurrency(extrasTotal));
    hasItems = true;
  }
  layer='cover';
  previewField = 'cover';
  if (layout.items.show_cover && coverTotal > 0) {
    if (validItem(coverItem) && cents(coverItem.line_total) === cents(coverTotal)) {
      addAmount(`${coverItem.quantity}x Coperto`, formatCurrency(coverTotal));
      if (coverItem.quantity > 1) addLine(`${formatCurrency(coverItem.unit_price)} cad.`, 'item_sub');
    } else addAmount("Coperto", formatCurrency(coverTotal));
    hasItems = true;
  }
  if (hasItems) addSep();
  previewField = undefined;
  layer='discount';
  if (Number.isFinite(payload.discount_total) && Number(payload.discount_total) > 0) {
    addAmount('Sconto', `-${formatCurrency(payload.discount_total)}`);
    addSep();
  }

  // Total
  layer='total';
  previewField = 'total';
  if (layout.total.visible) {
    if(rasterMode)addLine(layout.labels?.total??"TOTALE",'item','total',true,formatCurrency(totalAmount));
    else addLine(layout.labels?.total??"TOTALE", "item", "total", true, formatCurrency(totalAmount));
    layer='payment';
  previewField = 'payment';
  if (layout.total.show_payment_method) {
      addAmount(layout.labels?.payment??"Pagamento", paymentLabel);
    }
    addSep("=");
  }

  if (partial) {
    layer='residual';
    previewField = undefined;
    addAmount(layout.labels?.residual??'Residuo dopo pagamento', formatCurrency(remaining));
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
