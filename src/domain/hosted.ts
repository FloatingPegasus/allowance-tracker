import { isBrowserDetails, type BillingTarget, type BrowserDetails } from "./billingRecords";

export interface HostedAccount extends BillingTarget {
  id: string;
  plan: string;
  workspaceName: string | null;
  role: "owner" | "admin" | "member" | null;
  details?: BrowserDetails;
  billingError?: { at: string; message: string };
}

export function hostedAccounts(value: unknown): HostedAccount[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("The saved accounts could not be validated.");
  const accounts = value.map((item: unknown): HostedAccount => {
    if (!item || typeof item !== "object") throw new Error("Invalid saved account.");
    const a = item as Record<string, unknown>;
    if (typeof a.id !== "string" || !/^[a-f0-9]{64}$/.test(a.id) || typeof a.accountId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(a.accountId) || typeof a.email !== "string" || !a.email.includes("@") || a.email.length > 200 || typeof a.plan !== "string" || a.plan.length > 100 || typeof a.workspace !== "boolean" || (a.workspaceName !== null && (typeof a.workspaceName !== "string" || a.workspaceName.length > 200)) || ![null, "owner", "admin", "member"].includes(a.role as never)) throw new Error("Invalid saved account.");
    if (a.details !== undefined && (!isBrowserDetails(a.details) || a.details.accountId !== a.accountId || a.details.email.toLowerCase() !== a.email.toLowerCase())) throw new Error("Invalid saved billing.");
    if (a.billingError !== undefined) {
      const error = a.billingError as Record<string, unknown> | null;
      if (!error || typeof error.at !== "string" || !Number.isFinite(Date.parse(error.at)) || typeof error.message !== "string" || error.message.length > 500) throw new Error("Invalid billing status.");
    }
    return { id: a.id, accountId: a.accountId, email: a.email, plan: a.plan, workspace: a.workspace, workspaceName: a.workspaceName as string | null, role: a.role as HostedAccount["role"], ...(a.details ? { details: a.details as BrowserDetails } : {}), ...(a.billingError ? { billingError: a.billingError as HostedAccount["billingError"] } : {}) };
  });
  if (new Set(accounts.map((a) => a.id)).size !== accounts.length) throw new Error("Duplicate saved accounts.");
  return accounts;
}
