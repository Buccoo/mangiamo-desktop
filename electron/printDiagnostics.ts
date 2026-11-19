import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

export type DiagnosticEventType = "app_start" | "app_stop" | "app_error" | "unclean_exit" | "service_start" | "service_stop" | "suspend" | "resume" | "update_pause" | "update_resume" | "poll_error" | "job_claim" | "job_sent" | "job_error" | "health" | "diagnostics_dropped";
export type DiagnosticScope = { restaurantId: string; userId: string; agentId: string };
export type DiagnosticDetails = {
  job_id?: string; queue?: "kitchen" | "physical" | "non_fiscal" | "fiscal";
  host?: string; port?: number; duration_ms?: number; error_code?: string;
  phase?: "app" | "service" | "poll" | "claim" | "transport" | "ack" | "update" | "power" | "diagnostics";
  service_state?: "running" | "stopped" | "processing" | "paused";
  last_poll_at?: string; last_success_at?: string; dropped_count?: number;
};
export type DiagnosticEvent = { id: string; session_id: string; seq: number; occurred_at: string; event_type: DiagnosticEventType; level: "info" | "warn" | "error"; app_version: string; details: DiagnosticDetails };
export type DiagnosticUploader = (scope: DiagnosticScope, events: DiagnosticEvent[], signal: AbortSignal) => Promise<{ accepted_ids?: unknown }>;
type StoredEvent = { scope: DiagnosticScope; event: DiagnosticEvent };
type Marker = { session_id: string; clean: boolean; scope: DiagnosticScope | null };
type Health = () => DiagnosticDetails;
type Options = {
  filename: string; appVersion: string; health?: Health;
  now?: () => number; uploadTimeoutMs?: number; uploadIntervalMs?: number; healthIntervalMs?: number;
  maxEvents?: number; maxBytes?: number; disk?: typeof fs;
};

const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set<DiagnosticEventType>(["app_start", "app_stop", "app_error", "unclean_exit", "service_start", "service_stop", "suspend", "resume", "update_pause", "update_resume", "poll_error", "job_claim", "job_sent", "job_error", "health", "diagnostics_dropped"]);
const SEMVER = /^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?(\+[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$/;
const sameScope = (a: DiagnosticScope | null, b: DiagnosticScope | null) => !!a && !!b && a.restaurantId === b.restaurantId && a.userId === b.userId && a.agentId === b.agentId;
const validScope = (scope: unknown): scope is DiagnosticScope => {
  if (!scope || typeof scope !== "object") return false;
  const s = scope as DiagnosticScope;
  return typeof s.restaurantId === "string" && UUID.test(s.restaurantId) && typeof s.userId === "string" && UUID.test(s.userId) && typeof s.agentId === "string" && /^[a-z0-9._:-]{1,64}$/.test(s.agentId);
};
const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const integer = (value: unknown, max = 2147483647): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max;

/** Never copy an exception message, request body, URL, order or arbitrary string. */
export function sanitizeDiagnosticDetails(input: unknown): DiagnosticDetails {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const out: DiagnosticDetails = {};
  if (typeof raw.job_id === "string" && UUID.test(raw.job_id)) out.job_id = raw.job_id;
  if (["kitchen", "physical", "non_fiscal", "fiscal"].includes(String(raw.queue))) out.queue = raw.queue as DiagnosticDetails["queue"];
  if (typeof raw.host === "string" && raw.host.length <= 253 && (isIP(raw.host) || (!/^\d+\.\d+\.\d+\.\d+$/.test(raw.host) && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(raw.host)))) out.host = raw.host;
  if (integer(raw.port, 65535) && Number(raw.port) > 0) out.port = raw.port;
  if (integer(raw.duration_ms, 86400000)) out.duration_ms = raw.duration_ms;
  if (integer(raw.dropped_count, 1000000000)) out.dropped_count = raw.dropped_count;
  if (typeof raw.error_code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(raw.error_code)) out.error_code = raw.error_code;
  if (["app", "service", "poll", "claim", "transport", "ack", "update", "power", "diagnostics"].includes(String(raw.phase))) out.phase = raw.phase as DiagnosticDetails["phase"];
  if (["running", "stopped", "processing", "paused"].includes(String(raw.service_state))) out.service_state = raw.service_state as DiagnosticDetails["service_state"];
  for (const key of ["last_poll_at", "last_success_at"] as const) if (iso(raw[key])) out[key] = raw[key];
  // Postgres jsonb text adds whitespace; reserve room under its 512-byte limit.
  if (Buffer.byteLength(JSON.stringify(out)) > 440) delete out.host;
  return out;
}

export function classifyDiagnosticError(error: unknown, phase: DiagnosticDetails["phase"] = "poll"): string {
  const value = error && typeof error === "object" ? error as { code?: unknown; name?: unknown; message?: unknown } : {};
  const code = String(value.code || "").toUpperCase();
  if (["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "ENOSPC", "EACCES", "EPERM"].includes(code)) return code;
  if (code === "PGRST202" || code === "42883") return "RPC_UNAVAILABLE";
  if (code === "42501" || code === "PGRST301" || code === "401" || code === "403") return "AUTHORIZATION_FAILED";
  const message = typeof value.message === "string" ? value.message : "";
  // Socket wrappers preserve only message text. Extract finite public codes only.
  for (const known of ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "ENOSPC", "EACCES", "EPERM"]) {
    if (new RegExp(`\\b${known}\\b`, "i").test(message)) return known;
  }
  if (value.name === "AbortError" || /timeout|timed out/i.test(message)) return "TIMEOUT";
  if (/DELIVERY_UNCERTAIN/i.test(message)) return "DELIVERY_UNCERTAIN";
  if (/PRINT_SERVICE_CHANGED/i.test(message)) return "PRINT_SERVICE_CHANGED";
  if (/LAYOUT_UNAVAILABLE/i.test(message)) return "LAYOUT_UNAVAILABLE";
  if (/INVALID_SERVICE_PRINT_PROTOCOL|INVALID_PIN_SLIP/i.test(message)) return "INVALID_PRINT_PAYLOAD";
  if (/PHYSICAL_RT_FISCAL_MAPPING_UNVERIFIED/i.test(message)) return "PHYSICAL_RT_FISCAL_MAPPING_UNVERIFIED";
  if (/PHYSICAL_RT_BRAND_UNSUPPORTED/i.test(message)) return "PHYSICAL_RT_BRAND_UNSUPPORTED";
  if (/NO_PRINTER_HOST/i.test(message)) return "PRINTER_ROUTE_MISSING";
  if (/fetch failed|network|failed to fetch/i.test(message)) return "NETWORK_ERROR";
  return phase === "ack" ? "ACK_FAILED" : phase === "transport" ? "TRANSPORT_FAILED" : phase === "claim" ? "CLAIM_FAILED" : "OPERATION_FAILED";
}

/** A bounded best-effort side channel. Public record() never waits for disk/network. */
export class PrintDiagnostics {
  readonly sessionId = randomUUID();
  private readonly now: () => number;
  private readonly disk: typeof fs;
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private seq = 0;
  private events: StoredEvent[] = [];
  private scope: DiagnosticScope | null = null;
  private uploader: DiagnosticUploader | null = null;
  private marker: Marker = { session_id: this.sessionId, clean: false, scope: null };
  private started = false;
  private closed = false;
  private starting: Promise<void> | null = null;
  private appStartPending = true;
  private dropped = 0;
  private dirty = false;
  private persisting: Promise<void> | null = null;
  private uploading: Promise<void> | null = null;
  private uploadAbort: AbortController | null = null;
  private scopeGeneration = 0;
  private timers: NodeJS.Timeout[] = [];
  private early: Array<{ type: DiagnosticEventType; details: DiagnosticDetails; level: DiagnosticEvent["level"]; scope: DiagnosticScope }> = [];

  constructor(private readonly options: Options) {
    this.now = options.now || Date.now;
    this.disk = options.disk || fs;
    this.maxEvents = Math.max(50, Math.min(5000, options.maxEvents ?? 2000));
    this.maxBytes = Math.max(16384, Math.min(4 * 1024 * 1024, options.maxBytes ?? 2 * 1024 * 1024));
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.load().catch(() => { this.dropped++; }).then(() => {
      if (this.closed) return;
      this.started = true;
      this.bindAppStart();
      for (const item of this.early) this.record(item.type, item.details, item.level, item.scope);
      this.early = [];
      this.requestPersist();
      const upload = setInterval(() => { void this.flush(); }, this.options.uploadIntervalMs ?? 10000);
      const health = setInterval(() => { this.recordHealth(); }, this.options.healthIntervalMs ?? 60000);
      upload.unref?.(); health.unref?.();
      this.timers.push(upload, health);
    });
    return this.starting;
  }

  captureScope(): DiagnosticScope | null { return this.scope ? { ...this.scope } : null; }

  setScope(scope: DiagnosticScope | null, uploader: DiagnosticUploader | null = null) {
    const next = validScope(scope) ? { ...scope } : null;
    const changed = !sameScope(this.scope, next) && (this.scope !== null || next !== null);
    if (changed) {
      this.scopeGeneration++;
      this.uploadAbort?.abort();
    }
    this.scope = next;
    this.uploader = next ? uploader : null;
    this.marker.scope = next;
    if (this.started && !this.closed) {
      this.bindAppStart();
      if (changed) this.requestPersist();
    }
  }

  record(type: DiagnosticEventType, details: DiagnosticDetails = {}, level: DiagnosticEvent["level"] = "info", scope = this.scope): void {
    if (this.closed || !validScope(scope) || !TYPES.has(type)) return;
    if (!this.started) {
      if (this.starting && this.early.length < 50) this.early.push({ type, details: sanitizeDiagnosticDetails(details), level, scope: { ...scope } });
      else if (this.starting) this.dropped++;
      return;
    }
    this.events.push({ scope: { ...scope }, event: this.makeEvent(type, details, level) });
    this.prune();
    this.requestPersist();
  }

  recordHealth() {
    if (!this.scope || this.closed) return;
    try {
      if (this.dropped) {
        const count = this.dropped;
        this.dropped = 0;
        this.record("diagnostics_dropped", { phase: "diagnostics", dropped_count: Math.min(1000000000, count), error_code: "LOCAL_EVENTS_DROPPED" }, "warn");
      }
      this.record("health", this.options.health?.() || {});
    } catch { /* Health collection cannot interrupt printing or recurse through a logger. */ }
  }

  flush(): Promise<void> {
    if (this.uploading) return this.uploading;
    if (!this.started || this.closed || !this.scope || !this.uploader) return Promise.resolve();
    this.uploading = this.uploadBatch().catch(() => {}).finally(() => { this.uploading = null; });
    return this.uploading;
  }

  /** A shutdown deadline bounds even a broken disk, network or uploader. */
  async shutdown(timeoutMs = 1200): Promise<void> {
    if (this.closed) return;
    this.record("app_stop", { phase: "app" });
    this.marker.clean = true;
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.uploadAbort?.abort();
    this.requestPersist();
    await this.persistWithin(timeoutMs);
  }

  async persistWithin(timeoutMs = 1200): Promise<void> {
    const pending = this.persisting || Promise.resolve();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([pending, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(1, timeoutMs)); })]);
    if (timer) clearTimeout(timer);
  }

  private makeEvent(type: DiagnosticEventType, details: DiagnosticDetails, level: DiagnosticEvent["level"]): DiagnosticEvent {
    const version = SEMVER.test(this.options.appVersion) && this.options.appVersion.length <= 64 ? this.options.appVersion : "0.0.0";
    return { id: randomUUID(), session_id: this.sessionId, seq: ++this.seq, occurred_at: new Date(this.now()).toISOString(), event_type: type, level, app_version: version, details: sanitizeDiagnosticDetails(details) };
  }

  private bindAppStart() {
    if (!this.appStartPending || !this.scope) return;
    this.appStartPending = false;
    this.record("app_start", { phase: "app" });
    this.recordHealth();
  }

  private async load() {
    try {
      const stat = await this.disk.stat(this.options.filename);
      if (stat.size > this.maxBytes) { this.dropped++; return; }
      const raw = JSON.parse(await this.disk.readFile(this.options.filename, "utf8"));
      if (raw.version !== 1 || !Array.isArray(raw.events)) throw new Error("INVALID_SPOOL");
      for (const row of raw.events.slice(-this.maxEvents)) {
        const e = row?.event as DiagnosticEvent;
        if (!validScope(row?.scope) || !e || !UUID.test(e.id) || !UUID.test(e.session_id) || !Number.isSafeInteger(e.seq) || e.seq <= 0 || e.seq > 2147483647 || !iso(e.occurred_at) || !TYPES.has(e.event_type) || !["info", "warn", "error"].includes(e.level) || !SEMVER.test(e.app_version) || e.app_version.length > 64) { this.dropped++; continue; }
        this.events.push({ scope: { restaurantId: row.scope.restaurantId, userId: row.scope.userId, agentId: row.scope.agentId }, event: { id: e.id, session_id: e.session_id, seq: e.seq, occurred_at: e.occurred_at, event_type: e.event_type, level: e.level, app_version: e.app_version, details: sanitizeDiagnosticDetails(e.details) } });
      }
      this.dropped += Math.max(0, raw.events.length - this.maxEvents);
      if (raw.marker?.clean === false && UUID.test(raw.marker.session_id) && validScope(raw.marker.scope)) {
        this.events.push({ scope: { ...raw.marker.scope }, event: this.makeEvent("unclean_exit", { phase: "app", error_code: "UNCLEAN_EXIT_UNKNOWN" }, "warn") });
      }
      this.prune();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.dropped++;
    }
  }

  private prune() {
    const before = this.events.length;
    const cutoff = this.now() - RETENTION_MS;
    this.events = this.events.filter(row => Date.parse(row.event.occurred_at) > cutoff && Date.parse(row.event.occurred_at) <= this.now() + 5 * 60000);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    this.dropped += before - this.events.length;
  }

  private requestPersist() {
    this.dirty = true;
    if (!this.started || this.persisting) return;
    this.persisting = Promise.resolve().then(() => this.persistLoop()).catch(() => { this.dropped++; this.dirty = false; }).finally(() => { this.persisting = null; if (this.dirty) this.requestPersist(); });
  }

  private async persistLoop() {
    while (this.dirty) {
      this.dirty = false;
      this.prune();
      let json = JSON.stringify({ version: 1, marker: this.marker, events: this.events });
      while (Buffer.byteLength(json) > this.maxBytes && this.events.length) {
        this.events.shift(); this.dropped++;
        json = JSON.stringify({ version: 1, marker: this.marker, events: this.events });
      }
      await this.disk.mkdir(path.dirname(this.options.filename), { recursive: true });
      const temporary = `${this.options.filename}.tmp`;
      const handle = await this.disk.open(temporary, "w", 0o600);
      try { await handle.writeFile(json, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await this.disk.rename(temporary, this.options.filename);
    }
  }

  private async uploadBatch() {
    const scope = this.captureScope();
    const uploader = this.uploader;
    if (!scope || !uploader) return;
    const generation = this.scopeGeneration;
    this.prune();
    const batch = this.events.filter(row => sameScope(row.scope, scope)).slice(0, 50).map(row => row.event);
    if (!batch.length) return;
    const controller = new AbortController();
    this.uploadAbort = controller;
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => uploader(scope, batch, controller.signal)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("DIAGNOSTICS_UPLOAD_TIMEOUT")); }, this.options.uploadTimeoutMs ?? 8000); }),
        new Promise<never>((_, reject) => { controller.signal.addEventListener("abort", () => reject(new Error("DIAGNOSTICS_UPLOAD_ABORTED")), { once: true }); }),
      ]);
      if (controller.signal.aborted || generation !== this.scopeGeneration || !sameScope(scope, this.scope)) return;
      const sent = new Set(batch.map(event => event.id));
      const accepted = new Set(Array.isArray(result?.accepted_ids) ? result.accepted_ids.filter((id): id is string => typeof id === "string" && sent.has(id)) : []);
      this.events = this.events.filter(row => !sameScope(row.scope, scope) || !accepted.has(row.event.id));
      if (accepted.size) this.requestPersist();
    } finally {
      if (timer) clearTimeout(timer);
      if (this.uploadAbort === controller) this.uploadAbort = null;
    }
  }
}
