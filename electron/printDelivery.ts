import fs from "node:fs/promises";
import path from "node:path";

export type PrintQueue = "kitchen" | "physical" | "non_fiscal" | "fiscal";
export type PrintOperation = { jobId: string; restaurantId: string; consumerId: string; queue?: PrintQueue; generation?: number };
export type PrintDeliveryEntry = PrintOperation & { state: "sending" | "sent" | "uncertain"; error?: string; receiptId?: string };

/** Only proven failures before the first write may be retried automatically. */
export class PrintNotSentError extends Error {}

const sameOperation = (left: PrintOperation, right: PrintOperation) => left.jobId === right.jobId &&
  (left.queue || "kitchen") === (right.queue || "kitchen") && (left.generation || 0) === (right.generation || 0);

export class LocalPrintJournal {
  constructor(private readonly filename: string) {}

  async list(): Promise<PrintDeliveryEntry[]> {
    let raw: string;
    try { raw = await fs.readFile(this.filename, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const parsed = JSON.parse(raw) as { version?: number; entries?: PrintDeliveryEntry[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.some((entry) =>
      !entry.jobId || !entry.restaurantId || !entry.consumerId || !["sending", "sent", "uncertain"].includes(entry.state) ||
      (entry.queue != null && !["kitchen", "physical", "non_fiscal", "fiscal"].includes(entry.queue)) ||
      (entry.generation != null && (!Number.isInteger(entry.generation) || entry.generation < 0)))) {
      throw new Error("PRINT_JOURNAL_INVALID: verificare il registro locale prima di riprendere la stampa");
    }
    return parsed.entries;
  }

  private async write(entries: PrintDeliveryEntry[]) {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.tmp`;
    const file = await fs.open(temporary, "w");
    try {
      await file.writeFile(JSON.stringify({ version: 1, entries }), "utf8");
      await file.sync();
    } finally { await file.close(); }
    await fs.rename(temporary, this.filename);
  }

  async set(operation: PrintOperation, state: PrintDeliveryEntry["state"], error?: string, receiptId?: string) {
    const entries = (await this.list()).filter((entry) => !sameOperation(entry, operation));
    entries.push({ ...operation, state, ...(error ? { error: error.slice(0, 500) } : {}), ...(receiptId ? { receiptId } : {}) });
    await this.write(entries);
  }

  async remove(operation: PrintOperation) {
    await this.write((await this.list()).filter((entry) => !sameOperation(entry, operation)));
  }
}

type Acknowledge = (success: boolean, error: string | null, meta: { delivery_state: "sent" | "uncertain" | "not_sent"; receipt_id?: string; delivery_generation: number }) => Promise<void>;

/** A TCP write is transport evidence, not proof that paper was produced. */
export async function deliverPrintJob(journal: LocalPrintJournal, operation: PrintOperation, send: () => Promise<void | string>, acknowledge: Acknowledge) {
  const existing = (await journal.list()).find((entry) => sameOperation(entry, operation));
  if (existing?.state === "sent") {
    await acknowledge(true, null, { delivery_state: "sent", delivery_generation: operation.generation || 0, ...(existing.receiptId ? { receipt_id: existing.receiptId } : {}) });
    await journal.remove(operation);
    return "sent" as const;
  }
  if (existing) {
    const error = `DELIVERY_UNCERTAIN: ${existing.error || "invio interrotto; verificare carta prima di una ristampa manuale"}`;
    await journal.set(operation, "uncertain", error);
    await acknowledge(false, error, { delivery_state: "uncertain", delivery_generation: operation.generation || 0 });
    await journal.remove(operation);
    return "uncertain" as const;
  }

  await journal.set(operation, "sending");
  let receiptId: string | void;
  try { receiptId = await send(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof PrintNotSentError) {
      await journal.remove(operation);
      await acknowledge(false, message, { delivery_state: "not_sent", delivery_generation: operation.generation || 0 });
      return "not_sent" as const;
    }
    const uncertain = `DELIVERY_UNCERTAIN: ${message}`;
    await journal.set(operation, "uncertain", uncertain);
    await acknowledge(false, uncertain, { delivery_state: "uncertain", delivery_generation: operation.generation || 0 });
    await journal.remove(operation);
    return "uncertain" as const;
  }
  // A lost acknowledgement must leave durable sent evidence, never trigger a resend.
  await journal.set(operation, "sent", undefined, receiptId || undefined);
  await acknowledge(true, null, { delivery_state: "sent", delivery_generation: operation.generation || 0, ...(receiptId ? { receipt_id: receiptId } : {}) });
  await journal.remove(operation);
  return "sent" as const;
}
