import { isBrowserDetails, type BillingTarget, type BrowserDetails } from "./billingRecords";

export class BillingConnectionError extends Error {
  ended: boolean;
  constructor(message: string, ended = false) { super(message); this.ended = ended; }
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(`/api/billing/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new BillingConnectionError("Could not reach the local browser connector. Keep Allowance running on this computer.", true); }
  const value: unknown = await response.json().catch(() => null);
  if (path === "cancel" && response.status === 410) return {};
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!response.ok || !data) throw new BillingConnectionError(typeof data?.error === "string" ? data.error : "The local billing connector is unavailable.", response.status === 410 || !data);
  return data;
}

export async function openBillingBrowser(target: BillingTarget): Promise<string> {
  const result = await post("start", { target });
  if (typeof result.connectionId !== "string" || !/^[a-f0-9-]{36}$/.test(result.connectionId)) throw new BillingConnectionError("The browser connector returned an invalid connection.", true);
  return result.connectionId;
}

export async function readBillingBrowser(connectionId: string): Promise<BrowserDetails> {
  const result = await post("read", { connectionId });
  if (!isBrowserDetails(result.details)) throw new BillingConnectionError("Billing data could not be validated. Saved records were kept.", true);
  return result.details;
}

export async function closeBillingBrowser(connectionId: string): Promise<void> {
  await post("cancel", { connectionId });
}
