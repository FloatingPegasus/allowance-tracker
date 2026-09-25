import type { AppState } from "./types.ts";

export interface SyncSection<T> { data: T | null; updatedAt: string | null; error: string | null }
export interface BrowserBilling { active: boolean; interval: "monthly" | "annual" | null; currency: string | null; renewsAt: string | null; expiresAt: string | null; willRenew: boolean | null }
export interface BrowserSeat { type: string; label: string; purchased: number; assigned: number | null; available: number | null }
export interface BrowserMember { id: string; email: string; name: string | null; role: "member" | "admin" | "owner" | null; seat: string | null }
export interface BrowserInvoice { id: string; createdAt: string; amountMinor: number; currency: string; status: string; description: string }
export interface BrowserDetails {
  accountId: string;
  email: string;
  observedAt: string;
  billing: SyncSection<BrowserBilling>;
  seats: SyncSection<BrowserSeat[]>;
  invoices: SyncSection<BrowserInvoice[]>;
  directory: SyncSection<{ total: number; members: BrowserMember[] }>;
}

export interface BillingTarget { accountId: string; email: string; workspace: boolean }

const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).every((key) => names.includes(key)) && names.every((key) => Object.hasOwn(v, key));
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 500;
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const nullable = (test: (v: unknown) => boolean, v: unknown) => v === null || test(v);
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const currency = (v: unknown) => typeof v === "string" && /^[A-Z]{3}$/.test(v);
const section = (v: unknown, test: (v: unknown) => boolean) => rec(v) && keys(v, ["data", "updatedAt", "error"]) && nullable(text, v.error) && nullable(date, v.updatedAt) && (v.data === null ? v.updatedAt === null && text(v.error) : date(v.updatedAt) && test(v.data));
const billing = (v: unknown) => rec(v) && keys(v, ["active", "interval", "currency", "renewsAt", "expiresAt", "willRenew"]) && typeof v.active === "boolean" && [null, "monthly", "annual"].includes(v.interval as never) && nullable(currency, v.currency) && nullable(date, v.renewsAt) && nullable(date, v.expiresAt) && (v.willRenew === null || typeof v.willRenew === "boolean");
const seats = (v: unknown) => Array.isArray(v) && v.length <= 50 && new Set(v.map((item) => rec(item) ? item.type : null)).size === v.length && v.every((item) => rec(item) && keys(item, ["type", "label", "purchased", "assigned", "available"]) && text(item.type) && text(item.label) && count(item.purchased) && nullable(count, item.assigned) && nullable(count, item.available));
const invoices = (v: unknown) => Array.isArray(v) && v.length <= 100 && v.every((item) => rec(item) && keys(item, ["id", "createdAt", "amountMinor", "currency", "status", "description"]) && text(item.id) && date(item.createdAt) && typeof item.amountMinor === "number" && Number.isSafeInteger(item.amountMinor) && currency(item.currency) && text(item.status) && text(item.description));
const directory = (v: unknown) => rec(v) && keys(v, ["total", "members"]) && count(v.total) && Array.isArray(v.members) && v.members.length <= 1000 && v.total === v.members.length && new Set(v.members.map((item) => rec(item) ? item.id : null)).size === v.members.length && v.members.every((item) => rec(item) && keys(item, ["id", "email", "name", "role", "seat"]) && text(item.id) && text(item.email) && nullable(text, item.name) && [null, "owner", "admin", "member"].includes(item.role as never) && nullable(text, item.seat));

export function isBrowserDetails(v: unknown): v is BrowserDetails {
  return rec(v) && keys(v, ["accountId", "email", "observedAt", "billing", "seats", "invoices", "directory"]) && text(v.accountId) && text(v.email) && date(v.observedAt) && section(v.billing, billing) && section(v.seats, seats) && section(v.invoices, invoices) && section(v.directory, directory);
}

export function mergeBillingRecords(previous: BrowserDetails | undefined, next: BrowserDetails): BrowserDetails {
  if (!previous || previous.accountId !== next.accountId || previous.email.toLowerCase() !== next.email.toLowerCase()) return next;
  const merge = <T,>(old: SyncSection<T>, fresh: SyncSection<T>): SyncSection<T> => fresh.data === null && fresh.error ? { ...old, error: fresh.error } : fresh;
  return { ...next, billing: merge(previous.billing, next.billing), seats: merge(previous.seats, next.seats), invoices: merge(previous.invoices, next.invoices), directory: merge(previous.directory, next.directory) };
}

export function applyBillingRecord(state: AppState, value: unknown): AppState {
  if (!isBrowserDetails(value)) return state;
  const matches = state.subscriptions.filter((item) => ["codex", "chatgpt"].includes(item.provider) && item.providerAccountId === value.accountId && item.login.toLowerCase() === value.email.toLowerCase());
  if (matches.length !== 1) return state;
  const target = matches[0];
  if (target.browserDetails && Date.parse(target.browserDetails.observedAt) > Date.parse(value.observedAt)) return state;
  return { ...state, subscriptions: state.subscriptions.map((item) => item.id === target.id ? { ...item, browserDetails: mergeBillingRecords(item.browserDetails, value), billingError: undefined } : item) };
}

export function applyBillingFailure(state: AppState, target: BillingTarget, message: string, now: Date): AppState {
  const matches = state.subscriptions.filter((item) => ["codex", "chatgpt"].includes(item.provider) && item.providerAccountId === target.accountId && item.login.toLowerCase() === target.email.toLowerCase());
  if (matches.length !== 1 || !message.trim()) return state;
  return { ...state, subscriptions: state.subscriptions.map((item) => item.id === matches[0].id ? { ...item, billingError: { at: now.toISOString(), message: message.slice(0, 500) } } : item) };
}

export function invoiceMoney(invoice: BrowserInvoice): string {
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(invoice.amountMinor / 10 ** digits);
}
