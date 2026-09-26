import { isBrowserDetails, type BillingTarget, type BrowserDetails } from "./billingRecords";

export class BillingConnectionError extends Error {
  ended: boolean;
  status?: number;
  constructor(message: string, ended = false, status?: number) { super(message); this.ended = ended; this.status = status; }
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(`/api/billing/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new BillingConnectionError("Could not reach the billing service. Retry when the connection is restored.", true); }
  const value: unknown = await response.json().catch(() => null);
  if (path === "cancel" && response.status === 410) return {};
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!response.ok || !data) throw new BillingConnectionError(typeof data?.error === "string" ? data.error : "The billing service is unavailable.", response.status === 410 || response.status === 401 || !data, response.status);
  return data;
}

export interface BillingConnection { connectionId: string; mode: "local" | "cloud"; loginUrl?: string; expiresAt: number }
export async function openBillingBrowser(target: BillingTarget): Promise<BillingConnection> {
  const result = await post("start", { target });
  if (typeof result.connectionId !== "string" || !/^[a-f0-9-]{36}$/.test(result.connectionId)) throw new BillingConnectionError("The browser connector returned an invalid connection.", true);
  if (result.mode !== "local" && result.mode !== "cloud") throw new BillingConnectionError("The browser connector returned an invalid mode.", true);
  if (typeof result.expiresAt !== "number" || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new BillingConnectionError("The billing check expired. Open a new check to continue.", true);
  let loginUrl: string | undefined;
  if (result.mode === "cloud") {
    if (typeof result.loginUrl !== "string") throw new BillingConnectionError("The cloud sign-in link is missing.", true);
    const url = new URL(result.loginUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname === "browserbase.com" || url.hostname.endsWith(".browserbase.com"))) throw new BillingConnectionError("The cloud sign-in link could not be validated.", true);
    loginUrl = url.href;
  }
  return { connectionId: result.connectionId, mode: result.mode, loginUrl, expiresAt: result.expiresAt };
}

export async function readBillingBrowser(connectionId: string): Promise<BrowserDetails> {
  const result = await post("read", { connectionId });
  if (!isBrowserDetails(result.details)) throw new BillingConnectionError("Billing data could not be validated. Saved records were kept.", true);
  return result.details;
}

export async function closeBillingBrowser(connectionId: string): Promise<void> {
  await post("cancel", { connectionId });
}
