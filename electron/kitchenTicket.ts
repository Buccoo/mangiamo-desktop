export type TicketAlignment = "left" | "center" | "right";
export type EscPosSize = "normal" | "double";
export type EscPosFont = "A" | "B";

export type LineType = "header" | "table" | "timestamp" | "item" | "item_sub" | "separator" | "footer" | "blank";

export interface AnnotatedLine {
  text: string;
  type: LineType;
  size: EscPosSize;
  bold: boolean;
  align?: TicketAlignment;
}

// ─── Kitchen layout ─────────────────────────────────────────────────────────

export interface KitchenLayoutConfig {
  align: TicketAlignment;
  header: {
    visible: boolean;
    size: EscPosSize;
    bold: boolean;
    show_order_number: boolean;
    show_department: boolean;
  };
  table: {
    visible: boolean;
    size: EscPosSize;
    bold: boolean;
    label: string;
  };
  items: {
    visible: boolean;
    size: EscPosSize;
    bold: boolean;
    show_item_number: boolean;
    show_quantity: boolean;
    show_guest_name: boolean;
    show_notes: boolean;
  };
  footer: {
    visible: boolean;
    show_restaurant_name: boolean;
    show_timestamp: boolean;
    custom_text: string;
  };
  separator_char: "-" | "=" | "*";
  width: 32 | 42 | 48 | 80;
  font: EscPosFont;
}

export const DEFAULT_KITCHEN_LAYOUT: KitchenLayoutConfig = {
  align: "center",
  header: {
    visible: true,
    size: "normal",
    bold: false,
    show_order_number: true,
    show_department: true,
  },
  table: {
    visible: true,
    size: "double",
    bold: true,
    label: "Tavolo",
  },
  items: {
    visible: true,
    size: "normal",
    bold: false,
    show_item_number: true,
    show_quantity: true,
    show_guest_name: true,
    show_notes: true,
  },
  footer: {
    visible: true,
    show_restaurant_name: true,
    show_timestamp: true,
    custom_text: "",
  },
  separator_char: "-",
  width: 42,
  font: "A",
};

export function normalizeKitchenLayout(raw: unknown): KitchenLayoutConfig {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_KITCHEN_LAYOUT;
  const h = r.header && typeof r.header === "object" ? (r.header as Record<string, unknown>) : {};
  const tb = r.table && typeof r.table === "object" ? (r.table as Record<string, unknown>) : {};
  const it = r.items && typeof r.items === "object" ? (r.items as Record<string, unknown>) : {};
  const ft = r.footer && typeof r.footer === "object" ? (r.footer as Record<string, unknown>) : {};

  return {
    align: r.align === "left" || r.align === "right" ? r.align : "center",
    header: {
      visible: h.visible !== false,
      size: h.size === "double" ? "double" : "normal",
      bold: h.bold === true,
      show_order_number: h.show_order_number !== false,
      show_department: h.show_department !== false,
    },
    table: {
      visible: tb.visible !== false,
      size: tb.size === "normal" ? "normal" : "double",
      bold: tb.bold !== false,
      label: typeof tb.label === "string" && tb.label.trim() ? tb.label.trim() : d.table.label,
    },
    items: {
      visible: it.visible !== false,
      size: it.size === "double" ? "double" : "normal",
      bold: it.bold === true,
      show_item_number: it.show_item_number !== false,
      show_quantity: it.show_quantity !== false,
      show_guest_name: it.show_guest_name !== false,
      show_notes: it.show_notes !== false,
    },
    footer: {
      visible: ft.visible !== false,
      show_restaurant_name: ft.show_restaurant_name !== false,
      show_timestamp: ft.show_timestamp !== false,
      custom_text: typeof ft.custom_text === "string" ? ft.custom_text : "",
    },
    separator_char: ["-", "=", "*"].includes(String(r.separator_char)) ? (String(r.separator_char) as "-" | "=" | "*") : d.separator_char,
    width: ([32, 42, 48, 80] as number[]).includes(Number(r.width)) ? (Number(r.width) as 32 | 42 | 48 | 80) : d.width,
    font: r.font === "B" ? "B" : "A",
  };
}


export interface KitchenTicketItem {
  order_item_id?: string;
  menu_item_id?: string | null;
  item_number?: number | null;
  name: string;
  quantity: number;
  notes?: string | null;
  modifiers?: Array<{
    id?: string | null;
    name?: string | null;
    price_adjustment?: number | string | null;
    qty?: number | null;
    modifier_type?: string | null;
  }> | null;
  guest_name?: string | null;
  added_by?: string | null;
  department?: string | null;
}

export interface KitchenTicketPayload {
  service_protocol_version?: number;
  service_group_id?: string;
  execution_revision?: number;
  dedupe_key?: string;
  intent?: string;
  service_batch_id?: string;
  execution_fence?: string;
  not_before?: string;
  expires_at?: string;
  schema_version?: number;
  restaurant_id?: string;
  restaurant_name?: string;
  order_id?: string;
  order_number?: number;
  round_number?: number | null;
  session_id?: string;
  table_id?: string;
  table_number?: string | number | null;
  department?: string;
  trigger_mode?: "auto" | "manual_reprint" | string;
  created_at?: string;
  items?: KitchenTicketItem[];
}

export interface KitchenTicketRenderResult {
  text: string;
  html: string;
  lines: AnnotatedLine[];
}

function toStringValue(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function normalizeDepartmentLabel(value: string | null | undefined): string {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (!normalized) return "cucina";
  return normalized;
}

function separator(char = "-", width = 42): string {
  return char.repeat(width);
}

export function ticketTextColumns(text: string): number {
  return Array.from(text).reduce((sum, character) => sum + (/\p{Mark}/u.test(character) ? 0 : /[\u2e80-\u9fff\uf900-\ufaff\uac00-\ud7af\u{1f300}-\u{1faff}]/u.test(character) ? 2 : 1), 0);
}

export function wrapTicketText(input: string, width: number): string[] {
  const limit = Math.max(1, Math.floor(width));
  // Printer control characters are data here and must never reach the wire.
  // eslint-disable-next-line no-control-regex
  const safe = input.replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, ' ');
  const output: string[] = [];
  for (const paragraph of safe.split('\n')) {
    let current = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (current && ticketTextColumns(current + ' ' + word) > limit) { output.push(current); current = ''; }
      if (ticketTextColumns(word) <= limit) { current += (current ? ' ' : '') + word; continue; }
      for (const character of word) {
        if (current && ticketTextColumns(current + character) > limit) { output.push(current); current = ''; }
        current += character;
      }
    }
    output.push(current);
  }
  return output;
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

export function groupTicketItemsByDepartment(items: KitchenTicketItem[]): Record<string, KitchenTicketItem[]> {
  return items.reduce<Record<string, KitchenTicketItem[]>>((acc, item) => {
    const key = normalizeDepartmentLabel(item.department);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

export function renderKitchenTicketCore(
  payload: KitchenTicketPayload,
  options?: { jobId?: string; layout?: unknown; serviceHeadings?: string[] },
): KitchenTicketRenderResult {
  const headings = options?.serviceHeadings ?? [];
  const service = headings.length > 0;
  const layout = normalizeKitchenLayout(options?.layout);
  const width = layout.width;
  const sepChar = layout.separator_char;

  const items = Array.isArray(payload.items) ? payload.items : [];
  const department = normalizeDepartmentLabel(payload.department);
  const restaurantName = toStringValue(payload.restaurant_name).trim() || "Ristorante";
  const tableLabel = toStringValue(payload.table_number).trim() || "-";
  const orderLabel = payload.order_number != null ? `#${payload.order_number}` : "#-";
  const createdAt = formatTimestamp(payload.created_at);
  const jobId = toStringValue(options?.jobId).trim();

  const lines: AnnotatedLine[] = [];

  const addLine = (text: string, type: AnnotatedLine["type"], size: AnnotatedLine["size"] = "normal", bold = false) => {
    const indent = type === 'item_sub' && layout.align === 'left' ? ' ' : '';
    const columns = Math.max(1, Math.floor(width / (size === 'double' ? 2 : 1)) - indent.length);
    for (const chunk of wrapTicketText(text, columns)) lines.push({ text: indent + chunk, type, size, bold, align: layout.align });
  };
  const addSep = (char = sepChar) => addLine(separator(char, width), "separator");
  const addBlank = () => addLine("", "blank");

  if (service) {
    for (const heading of headings) addLine(heading, "header", "normal", true);
    addSep("=");
  }

  // ── Header ──────────────────────────────────────────────────────────────
  if (layout.header.visible) {
    const parts: string[] = [];
    if (layout.header.show_order_number) parts.push(orderLabel);
    if (layout.header.show_department) parts.push(`COMANDA ${department}`);
    if (parts.length > 0) {
      addLine(parts.join(" - "), "header", layout.header.size, layout.header.bold);
    }
  }

  addSep();
  addBlank();

  // ── Table ────────────────────────────────────────────────────────────────
  if (layout.table.visible) {
    const tableText = `${layout.table.label}: ${tableLabel}`;
    addLine(tableText, "table", layout.table.size, layout.table.bold);
    addBlank();
  }

  // ── Items ────────────────────────────────────────────────────────────────
  if (layout.items.visible || service) {
    for (const item of items) {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const numberPrefix = layout.items.show_item_number && item.item_number != null ? `#${item.item_number} ` : "";
      const qtyPrefix = layout.items.show_quantity || service ? `${qty}x ` : "";
      const itemTitle = `${qtyPrefix}${numberPrefix}${toStringValue(item.name).trim()}`;

      addLine(itemTitle, "item", layout.items.size, layout.items.bold);

      if (layout.items.show_guest_name) {
        const guest = toStringValue(item.guest_name).trim();
        if (guest) {
          addLine(`Ospite: ${guest}`, "item_sub");
        }
      }

      if (layout.items.show_notes) {
        const notes = toStringValue(item.notes).trim();
        if (notes) {
          addLine(`Nota: ${notes}`, "item_sub");
        }
      }

      const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
      if (modifiers.length > 0) {
        for (const modifier of modifiers) {
          const modifierName = toStringValue(modifier?.name).trim();
          if (!modifierName) continue;
          const type = toStringValue(modifier?.modifier_type).trim().toLowerCase() || "variant";
          const qty = Math.max(1, Number(modifier?.qty ?? 1) || 1);
          const modifierPrice = Number(modifier?.price_adjustment ?? 0);

          let line: string;
          const qtySuffix = qty > 1 ? ` x${qty}` : "";
          if (type === "remove" || type === "removal") {
            line = `SENZA ${modifierName}${qtySuffix}`;
          } else {
            const prefix = type === "extra" || type === "addon" ? "+ " : "Variante: ";
            const priceSuffix = Number.isFinite(modifierPrice) && modifierPrice > 0
              ? ` (+${modifierPrice.toFixed(2)} EUR)`
              : "";
            line = `${prefix}${modifierName}${qtySuffix}${priceSuffix}`;
          }
          addLine(line, "item_sub");
        }
      }
    }
  }

  addSep();

  // ── Footer ───────────────────────────────────────────────────────────────
  if (layout.footer.visible) {
    const footerParts: string[] = [];
    if (layout.footer.show_restaurant_name) footerParts.push(restaurantName);
    if (layout.footer.show_timestamp && createdAt) footerParts.push(createdAt);
    const footerLine = footerParts.join(" - ");
    if (footerLine) addLine(footerLine, "footer");
    if (layout.footer.custom_text.trim()) {
      addLine(layout.footer.custom_text.trim(), "footer");
    }
  }

  addSep("=");

  const text = lines.map((l) => l.text).join("\n");
  const htmlLines = lines
    .map((l) => {
      const styles: string[] = [];
      if (l.size === "double") styles.push("font-size:2em");
      styles.push(`display:block;text-align:${l.align ?? "left"}`);
      if (l.bold) styles.push("font-weight:bold");
      const style = styles.join(";");
      return `<span${style ? ` style="${style}"` : ""}>${escapeHtml(l.text) || "\u00A0"}</span>`;
    })
    .join("");
  const html = `<div class="ticket-preview" data-job-id="${escapeHtml(jobId || "-")}"><pre style="font-family:monospace;line-height:1.5;white-space:pre;width:${width}ch">${htmlLines}</pre></div>`;

  return { text, html, lines };
}


/** Per-line styling is explicit: product names must never act as ESC/POS commands. */
export function buildKitchenEscPos(lines: AnnotatedLine[], rawLayout?: unknown): Uint8Array {
  const layout = normalizeKitchenLayout(rawLayout);
  // Use the same fixed cell geometry as the preview. The printer must support
  // this printable width; 80 columns is intended for wide-format hardware.
  const dots = layout.width * (layout.font === 'A' ? 12 : 9);
  const bytes: number[] = [27, 64, 27, 77, layout.font === 'A' ? 0 : 1, 27, 32, 0,
    29, 76, 0, 0, 29, 87, dots & 255, dots >> 8];
  const encoder = new TextEncoder();
  for (const line of lines) {
    bytes.push(27, 97, line.align === 'right' ? 2 : line.align === 'left' ? 0 : 1);
    const lineDots = Math.max(36, (layout.font === 'A' ? 24 : 17) * (line.size === 'double' ? 2 : 1) + 8);
    bytes.push(27, 69, line.bold ? 1 : 0, 29, 33, line.size === 'double' ? 17 : 0, 27, 51, lineDots);
    // eslint-disable-next-line no-control-regex -- prevent ESC/POS command injection from ticket text.
    bytes.push(...encoder.encode(line.text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ') + '\n'));
  }
  bytes.push(27, 69, 0, 29, 33, 0, 27, 97, 0, 27, 77, 0, 27, 50, 27, 100, 5, 29, 86, 0);
  return Uint8Array.from(bytes);
}
