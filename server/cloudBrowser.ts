import { chromium, type Browser } from "playwright-core";
import type { BillingTarget } from "../src/domain/billingRecords.ts";
import type { BillingBrowser, LaunchBrowser } from "./billingBrowser.ts";
import { BillingProfiles } from "./billingProfiles.ts";
import { readAccount } from "./billingReader.js";
import { setTimeout as delay } from "node:timers/promises";
import { BillingServiceError } from "./billingErrors.ts";

interface CloudConfig { apiKey: string; projectId?: string; directory: string }
type Request = (path: string, body?: unknown) => Promise<Record<string, unknown>>;

export function browserbaseRequest(apiKey: string, send: typeof fetch = fetch): Request {
  return async (path, body) => {
    let response: Response;
    try {
      response = await send(`https://api.browserbase.com/v1/${path}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new BillingServiceError("The cloud browser service could not be reached."); }
    if (!response.ok) throw new BillingServiceError(response.status === 401 || response.status === 403 ? "The cloud browser credentials or project permissions were rejected." : response.status === 429 ? "The cloud browser limit was reached. Check the service allowance before retrying." : `The cloud browser service failed (${response.status}).`);
    const value: unknown = await response.json().catch(() => null);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The cloud browser service returned an invalid response.");
    return value as Record<string, unknown>;
  };
}

export function cloudUrl(value: unknown, protocol: "https:" | "wss:"): string {
  if (typeof value !== "string") throw new Error("The cloud browser URL is missing.");
  const url = new URL(value);
  if (url.protocol !== protocol || url.username || url.password || url.port || !(url.hostname === "browserbase.com" || url.hostname.endsWith(".browserbase.com"))) throw new Error("The cloud browser returned an unexpected destination.");
  return url.href;
}

export function cloudBrowser(config: CloudConfig): LaunchBrowser {
  const request = browserbaseRequest(config.apiKey);
  const profiles = new BillingProfiles(config.directory);
  return async (onClose, target: BillingTarget): Promise<BillingBrowser> => {
    let contextId = await profiles.get(target);
    if (!contextId) {
      const context = await request("contexts", config.projectId ? { projectId: config.projectId } : {});
      if (typeof context.id !== "string") throw new Error("The cloud browser profile could not be created.");
      contextId = context.id;
      await profiles.set(target, contextId);
    }
    const session = await request("sessions", {
      ...(config.projectId ? { projectId: config.projectId } : {}), timeout: 840,
      browserSettings: { context: { id: contextId, persist: true }, solveCaptchas: false, recordSession: false, logSession: false },
    });
    if (typeof session.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(session.id)) throw new Error("The cloud browser session could not be created.");
    let browser: Browser | undefined;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await request(`sessions/${session.id}`, { status: "REQUEST_RELEASE" }).catch(() => undefined);
      await browser?.close().catch(() => undefined);
      await delay(5_000);
    };
    try {
      browser = await chromium.connectOverCDP(cloudUrl(session.connectUrl, "wss:"), { timeout: 30_000 });
      browser.on("disconnected", onClose);
      const context = browser.contexts()[0];
      if (!context) throw new Error("The cloud browser profile did not open.");
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
      const view = await request(`sessions/${session.id}/debug`);
      const loginUrl = cloudUrl(view.debuggerFullscreenUrl, "https:");
      return {
        mode: "cloud", loginUrl, close,
        read: async (identity) => {
          if (new URL(page.url()).origin !== "https://chatgpt.com") return { error: "Sign in to ChatGPT in the cloud browser, then retry." };
          return page.evaluate(readAccount, identity);
        },
      };
    } catch (error) { await close(); throw error; }
  };
}
