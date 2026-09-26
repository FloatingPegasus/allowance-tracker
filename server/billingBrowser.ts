import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { chromium } from "playwright-core";
import { trustedRequest } from "./authProxy.ts";
import { readAccount } from "./billingReader.js";
import { isBrowserDetails, type BillingTarget, type BrowserDetails } from "../src/domain/billingRecords.ts";
import { BillingServiceError } from "./billingErrors.ts";

export interface BillingBrowser { mode?: "local" | "cloud"; loginUrl?: string; read: (target: BillingTarget) => Promise<unknown>; close: () => Promise<void> }
export type LaunchBrowser = (onClose: () => void, target: BillingTarget) => Promise<BillingBrowser>;
interface Connection {
  id: string;
  origin: string;
  target: BillingTarget;
  expiresAt: number;
  browser: BillingBrowser | null;
  busy: boolean;
  closed: boolean;
  closing?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
}
type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const launchBrowser: LaunchBrowser = async (onClose) => {
  const browser = await chromium.launch({ channel: "chrome", headless: false, chromiumSandbox: true, timeout: 30_000 });
  browser.on("disconnected", onClose);
  try {
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    return {
      close: () => browser.close(),
      read: async (target) => {
        if (new URL(page.url()).origin !== "https://chatgpt.com") return { error: "Finish signing in to ChatGPT in the opened window, then retry." };
        return page.evaluate(readAccount, target);
      },
    };
  } catch { await browser.close(); throw new Error("launch_failed"); }
};

function targetFrom(value: unknown): BillingTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !["accountId", "email", "workspace"].includes(key))) return null;
  if (typeof item.accountId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(item.accountId) || typeof item.email !== "string" || !item.email.trim() || item.email.length > 200 || typeof item.workspace !== "boolean") return null;
  return { accountId: item.accountId, email: item.email.trim(), workspace: item.workspace };
}

async function bodyFrom(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 4096) throw new Error("body_too_large");
    chunks.push(buffer);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_body");
  return body as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}

interface BillingRouteOptions {
  authorize?: (req: IncomingMessage) => boolean;
  targetAllowed?: (target: BillingTarget) => boolean;
  save?: (details: BrowserDetails) => void;
  failure?: (target: BillingTarget, message: string) => void;
}
export function createBillingRoutes(launch: LaunchBrowser = launchBrowser, ttl = 14 * 60_000, launchError = "Could not open the billing window. Install Google Chrome and run Allowance on this computer.", options: BillingRouteOptions = {}) {
  let active: Connection | null = null;
  const fail = (res: ServerResponse, status: number, message: string, target: BillingTarget) => {
    try { options.failure?.(target, message); }
    catch { send(res, 500, { error: "The billing check failed and its status could not be saved. Previous records were kept." }); return; }
    send(res, status, { error: message });
  };
  const close = async (connection: Connection) => {
    if (connection.closing) return connection.closing;
    connection.closed = true;
    clearTimeout(connection.timer);
    const browser = connection.browser;
    connection.browser = null;
    connection.closing = Promise.resolve().then(async () => {
      await browser?.close().catch(() => undefined);
      if (active === connection) active = null;
    });
    await connection.closing;
  };

  const middleware: Middleware = (req, res, next) => {
    const path = req.url?.split("?")[0];
    if (!path?.startsWith("/api/billing/")) { next(); return; }
    if (!(options.authorize ?? trustedRequest)(req)) { send(res, 403, { error: "Billing requests must come from this app." }); return; }
    if (req.method !== "POST") { send(res, 405, { error: "Billing requests require POST." }); return; }
    void (async () => {
      let body;
      try { body = await bodyFrom(req); }
      catch { send(res, 400, { error: "Invalid billing request." }); return; }
      const origin = req.headers.origin!;
      if (path === "/api/billing/start") {
        const target = targetFrom(body.target);
        if (!target) { send(res, 400, { error: "Choose an account with a verified provider identity." }); return; }
        if (options.targetAllowed && !options.targetAllowed(target)) { send(res, 403, { error: "That account is not connected to this tracker." }); return; }
        if (active) { send(res, 409, { error: "Finish or cancel the open billing check first." }); return; }
        const connection: Connection = { id: randomUUID(), origin, target, expiresAt: Date.now() + ttl, browser: null, busy: false, closed: false };
        active = connection;
        connection.timer = setTimeout(() => { void close(connection); }, ttl);
        connection.timer.unref();
        try {
          connection.browser = await launch(() => { void close(connection); }, target);
          if (connection.closed) { await connection.browser.close().catch(() => undefined); send(res, 410, { error: "The billing window was closed. Open a new check to continue." }); return; }
          send(res, 200, { connectionId: connection.id, expiresAt: connection.expiresAt, mode: connection.browser.mode ?? "local", loginUrl: connection.browser.loginUrl });
        } catch (error) {
          await close(connection);
          fail(res, 503, error instanceof BillingServiceError ? error.message : launchError, target);
        }
        return;
      }
      if (path !== "/api/billing/read" && path !== "/api/billing/cancel") { send(res, 404, { error: "Unknown billing route." }); return; }
      const connection = active;
      if (!connection || connection.closed || body.connectionId !== connection.id || connection.origin !== origin) { send(res, 410, { error: "This billing check ended. Open a new check to continue." }); return; }
      if (Date.now() >= connection.expiresAt) { await close(connection); send(res, 410, { error: "The billing check expired. Open a new check to continue." }); return; }
      if (path === "/api/billing/cancel") { await close(connection); send(res, 200, { canceled: true }); return; }
      if (connection.busy || !connection.browser) { send(res, 409, { error: "A billing read is already running." }); return; }
      connection.busy = true;
      try {
        const result = await connection.browser.read(connection.target);
        if (connection.closed || active !== connection) { send(res, 410, { error: "The billing check ended. Its result was discarded." }); return; }
        if (result && typeof result === "object" && "mismatch" in result) { fail(res, 409, `Sign in as ${connection.target.email} in the billing window, then retry. No data from another account was saved.`, connection.target); return; }
        if (!isBrowserDetails(result)) {
          const message = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error.slice(0, 500) : "Billing could not be read. Finish signing in, then retry.";
          fail(res, 409, message, connection.target); return;
        }
        if (result.accountId !== connection.target.accountId || result.email.toLowerCase() !== connection.target.email.toLowerCase()) { fail(res, 409, "The billing result belongs to another account and was discarded.", connection.target); return; }
        try { options.save?.(result); }
        catch { send(res, 500, { error: "Billing was read but could not be saved. Retry before closing this check." }); return; }
        await close(connection);
        send(res, 200, { details: result });
      } catch {
        if (connection.closed) send(res, 410, { error: "The billing window closed. Open a new check to continue." });
        else fail(res, 409, "The billing window could not be read. Finish signing in, or cancel and start again.", connection.target);
      } finally { connection.busy = false; }
    })().catch(() => { if (!res.headersSent) send(res, 500, { error: "The billing request failed. Saved records were kept." }); else res.end(); });
  };
  return { middleware, cleanup: async () => { if (active) await close(active); } };
}
