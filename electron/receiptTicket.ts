import type { AnnotatedLine, EscPosFont } from './kitchenTicket';
export interface ReceiptLayoutConfig {
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
}

export const DEFAULT_RECEIPT_LAYOUT: ReceiptLayoutConfig = {
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

  return {
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
export interface NonFiscalReceiptPayload {
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
}

export interface NonFiscalReceiptRenderResult {
  text: string;
  html: string;
  lines: AnnotatedLine[];
}

function toStr(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function formatCurrency(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "EUR 0,00";
  const str = Math.abs(n).toFixed(2).replace(".", ",");
  return `EUR ${str}`;
}

function padRow(label: string, value: string, width: number): string {
  const gap = width - label.length - value.length;
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
  const width = layout.width;
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
  const extrasLabel = paymentScope === "roman_split"
    ? (personsAtPayment === 1 ? "1 Quota" : `${personsAtPayment} Quote`)
    : "Extra";

  const lines: AnnotatedLine[] = [];
  const addLine = (text: string, type: AnnotatedLine["type"]) =>
    { for (const chunk of wrapReceiptLine(text, width)) lines.push({ text: chunk, type, size: "normal", bold: false, align: "left" }); };
  const addSep = (char?: string) => addLine((char ?? sepChar).repeat(width), "separator");
  const addBlank = () => addLine("", "blank");

  // Header
  if (layout.header.visible) {
    addSep("=");
    if (layout.header.show_restaurant_name) {
      addLine(centerText(restaurantName, width), "header");
    }
    if (layout.header.custom_text.trim()) {
      addLine(centerText(layout.header.custom_text.trim(), width), "header");
    }
    addSep("=");
    addLine(centerText("SCONTRINO NON FISCALE", width), "header");
    addSep();
  }

  // Table + timestamp
  if (layout.table.visible) {
    addLine(centerText(`${layout.table.label}: ${tableLabel}`, width), "table");
  }
  if (layout.timestamp.visible && paidAt) {
    addLine(centerText(`Data:   ${paidAt}`, width), "timestamp");
  }
  if (layout.table.visible || layout.timestamp.visible) {
    addSep();
  }

  // Items breakdown
  let hasItems = false;
  if (layout.items.show_ayce && ayceTotal > 0) {
    addLine(padRow("AYCE", formatCurrency(ayceTotal), width), "item");
    hasItems = true;
  }
  if (layout.items.show_extras && extrasTotal > 0) {
    addLine(padRow(extrasLabel, formatCurrency(extrasTotal), width), "item");
    hasItems = true;
  }
  if (layout.items.show_cover && coverTotal > 0) {
    addLine(padRow("Coperto", formatCurrency(coverTotal), width), "item");
    hasItems = true;
  }
  if (hasItems) addSep();

  // Total
  if (layout.total.visible) {
    lines.push({ text: padRow("TOTALE", formatCurrency(totalAmount), width), type: "item", size: "normal", bold: true });
    if (layout.total.show_payment_method) {
      addLine(padRow("Pagamento", paymentLabel, width), "item");
    }
    addSep("=");
  }

  // Footer
  if (layout.footer.visible) {
    if (layout.footer.custom_text.trim()) {
      addLine(centerText(layout.footer.custom_text.trim(), width), "footer");
    }
    if (layout.footer.show_non_fiscal_label) {
      addLine(centerText("*** NON FISCALE ***", width), "footer");
    }
    addSep("=");
  }

  const text = lines.map((l) => l.text).join("\n");
  const htmlLines = lines
    .map((l) => {
      const styles: string[] = [];
      if (l.size === "double") styles.push("font-size:1.35em");
      if (l.bold) styles.push("font-weight:bold");
      const style = styles.join(";");
      return `<span${style ? ` style="${style}"` : ""}>${escapeHtml(l.text) || "\u00A0"}</span>`;
    })
    .join("\n");
  const html = `<div class="ticket-preview receipt-preview"><pre>${htmlLines}</pre></div>`;

  return { text, html, lines };
}

