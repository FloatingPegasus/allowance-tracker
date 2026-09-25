import { describe, expect, it, vi } from "vitest";
import { readAccount } from "../../extension/reader.js";
import { applyBrowserDetails, applyBrowserFailure, invoiceMoney, isBrowserDetails, mergeBrowserDetails } from "./browserSync";
import { createProviderAccount } from "./applyLogin";
import { parseState } from "./storage";
import type { BrowserDetails, BrowserTarget } from "./browserSync";
import type { AppState } from "./types";
const target: BrowserTarget = { accountId: "workspace-one", email: "owner@example.test", workspace: true };
const subscription = { entitlement: { has_active_subscription: true, renews_at: "2026-10-01T00:00:00Z", billing_period: "monthly", billing_currency: "inr" }, will_renew: true, seat_capacity: [{ type: "default", paid: 2, available: 1 }, { type: "prolite", paid: 1, available: 0 }], assigned: { default: 1, prolite: 1 } };
const member = (id: string) => ({ id, name: `Person ${id}`, email: `${id}@example.test`, role: "standard-user", seat_type: "default" });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const fetcher = (overrides: Record<string, unknown> = {}) => vi.fn(async (url: string | URL | Request) => {
  const path = new URL(String(url)).pathname;
  if (path in overrides) return response(overrides[path]);
  if (path === "/api/auth/session") return response({ accessToken: "secret-must-stay-in-chatgpt", user: { email: target.email } });
  if (path === "/backend-api/subscriptions") return response(subscription);
  if (path === "/backend-api/accounts/check/v4-2023-04-27") return response({ accounts: { [target.accountId]: { entitlement: subscription.entitlement } } });
  if (path.endsWith("/users")) return response({ items: [member("one"), { ...member("two"), role: "account-owner", seat_type: "prolite" }], total: 2, offset: 0 });
  if (path.endsWith("transaction-history")) return response({ transactions: [{ id: "invoice-one", type: "invoice", amount: 429601, currency: "inr", status: "paid", created_at: "2026-09-14T00:00:00Z", invoice_url: "https://invoice.stripe.com/private-capability", product: { is_seat_purchase: true } }] });
  throw new Error("Unexpected endpoint");
});
async function snapshot(): Promise<BrowserDetails> {
  const result = await readAccount(target, fetcher() as typeof fetch);
  if (!isBrowserDetails(result)) throw new Error("Fixture is invalid");
  return result;
}

describe("automatic browser account sync", () => {
  it("reads actual renewals, invoices, purchased seats and assigned member types without exporting credentials", async () => {
    const request = fetcher();
    const result = await readAccount(target, request as typeof fetch);
    expect(isBrowserDetails(result)).toBe(true);
    const value = result as BrowserDetails;
    expect(value.billing.data?.currency).toBe("INR");
    expect(value.seats.data?.map((seat) => [seat.label, seat.purchased, seat.assigned])).toEqual([["Standard", 2, 1], ["Premium", 1, 1]]);
    expect(value.directory.data?.members[1].seat).toBe("Premium");
    expect(invoiceMoney(value.invoices.data![0])).toBe("₹4,296.01");
    expect(JSON.stringify(result)).not.toMatch(/secret-must-stay|accessToken|invoice_url|private-capability/);
    expect(request.mock.calls.every(([url]) => String(url).startsWith("https://chatgpt.com/"))).toBe(true);
  });
  it("does not read another signed-in user's billing", async () => {
    const request = fetcher({ "/api/auth/session": { accessToken: "private", user: { email: "other@example.test" } } });
    expect(await readAccount(target, request as typeof fetch)).toEqual({ mismatch: true });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("reads all member pages and rejects changing totals or partial results", async () => {
    const normal = fetcher();
    const pages = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      if (!parsed.pathname.endsWith("/users")) return normal(url);
      const offset = Number(parsed.searchParams.get("offset"));
      return response({ total: 26, offset, items: offset === 0 ? Array.from({ length: 25 }, (_, i) => member(String(i))) : [member("25")] });
    });
    const full = await readAccount(target, pages as typeof fetch) as BrowserDetails;
    expect(full.directory.data?.members).toHaveLength(26);
    const incomplete = await readAccount(target, fetcher({ "/backend-api/accounts/workspace-one/users": { items: [], total: 2, offset: 0 } }) as typeof fetch) as BrowserDetails;
    expect(incomplete.directory.data).toBeNull();
    expect(incomplete.directory.error).toContain("incomplete");
  });
  it("keeps billing available when member access fails and preserves stale data with a visible error", async () => {
    const normal = fetcher();
    const request = vi.fn(async (url: string | URL | Request) => String(url).includes("/users?") ? response({}, 403) : normal(url));
    const next = await readAccount(target, request as typeof fetch) as BrowserDetails;
    expect(next.billing.data?.active).toBe(true);
    expect(next.directory.error).toContain("denied");
    const old = await snapshot();
    const merged = mergeBrowserDetails(old, next);
    expect(merged.directory.data).toEqual(old.directory.data);
    expect(merged.directory.error).toContain("denied");
    expect(isBrowserDetails(merged)).toBe(true);
  });
  it("does not default malformed fields to free capacity or zero cost", async () => {
    const result = await readAccount(target, fetcher({ "/backend-api/subscriptions": { entitlement: {}, seat_capacity: [{ type: "default", paid: "3" }] } }) as typeof fetch) as BrowserDetails;
    expect(result.billing.data).toBeNull();
    expect(result.seats.data).toBeNull();
    expect(result.invoices.data).toHaveLength(1);
  });
  it("requires an unambiguous provider ID and login, rejects extra credential fields and round trips exports", async () => {
    const value = await snapshot();
    const state: AppState = { version: 1, holdCodex: true, intent: "balanced", subscriptions: [{ ...createProviderAccount("chatgpt", "one", new Date()), login: target.email, providerAccountId: target.accountId }] };
    expect(applyBrowserDetails(state, { ...value, accountId: "other" })).toBe(state);
    expect(applyBrowserDetails(state, { ...value, email: "other@example.test" })).toBe(state);
    expect(applyBrowserDetails(state, { ...value, accessToken: "bad" })).toBe(state);
    const applied = applyBrowserDetails(state, value);
    expect(parseState(JSON.stringify(applied))).toEqual(applied);
    expect(applyBrowserDetails({ ...state, subscriptions: [...state.subscriptions, { ...state.subscriptions[0], id: "duplicate" }] }, value).subscriptions.every((item) => !item.browserDetails)).toBe(true);
    expect(isBrowserDetails({ ...value, directory: { ...value.directory, data: { total: 100, members: [] } } })).toBe(false);
  });
  it("does not request a personal account's member directory", async () => {
    const request = fetcher();
    const result = await readAccount({ ...target, workspace: false }, request as typeof fetch) as BrowserDetails;
    expect(result.billing.data?.renewsAt).toBe("2026-10-01T00:00:00.000Z");
    expect(isBrowserDetails(result)).toBe(true);
    expect(request.mock.calls.some(([url]) => String(url).includes("/users?"))).toBe(false);
    expect(request.mock.calls.some(([url]) => new URL(String(url)).pathname === "/backend-api/subscriptions")).toBe(false);
  });
  it("never borrows personal billing from the default account", async () => {
    const result = await readAccount({ ...target, workspace: false }, fetcher({ "/backend-api/accounts/check/v4-2023-04-27": { accounts: { default: { entitlement: subscription.entitlement } } } }) as typeof fetch) as BrowserDetails;
    expect(result.billing.data).toBeNull();
    expect(result.billing.error).toContain("No other account");
  });
  it("distinguishes browser challenges from an account permission rejection", async () => {
    const normal = fetcher();
    const request = vi.fn(async (url: string | URL | Request) => String(url).includes("/subscriptions?") ? new Response("challenge", { status: 403, headers: { "cf-mitigated": "challenge" } }) : normal(url));
    const result = await readAccount(target, request as typeof fetch) as BrowserDetails;
    expect(result.billing.error).toContain("interactive browser check");
    expect(result.billing.error).not.toContain("denied access");
  });
  it("records a failed check only on the matching entry while keeping its last checked billing", async () => {
    const details = await snapshot();
    const state: AppState = { version: 1, holdCodex: false, intent: "balanced", subscriptions: [
      { ...createProviderAccount("chatgpt", "one", new Date()), login: target.email, providerAccountId: target.accountId, browserDetails: details },
      { ...createProviderAccount("chatgpt", "two", new Date()), login: "other@example.test", providerAccountId: "personal-two" },
    ] };
    const now = new Date();
    const next = applyBrowserFailure(state, target, "Switch to the matching ChatGPT account.", now);
    expect(next.subscriptions[0].browserDetails).toEqual(details);
    expect(next.subscriptions[0].browserSyncError?.at).toBe(now.toISOString());
    expect(next.subscriptions[1]).toBe(state.subscriptions[1]);
    expect(parseState(JSON.stringify(next))).toEqual(next);
    expect(applyBrowserFailure(state, { ...target, email: "other@example.test" }, "wrong", now)).toBe(state);
    const fresh = applyBrowserDetails(next, { ...details, observedAt: now.toISOString() });
    expect(fresh.subscriptions[0].browserSyncError).toBeUndefined();
    const malformed = { ...next, subscriptions: [{ ...next.subscriptions[0], browserSyncError: { at: "not a date", message: "failed" } }] };
    expect(parseState(JSON.stringify(malformed))).toBeNull();
  });
});
