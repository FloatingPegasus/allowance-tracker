import type { OrgRole, WindowKind, WindowReading } from "./types";

/** Public Codex CLI client. Sign-in uses the provider's page, then the tokens stay in this app. */
export const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

const OPENAI_SCOPES = "openid profile email offline_access api.connectors.read api.connectors.invoke";

export function openaiAuthorizeUrl(input: { redirectUri: string; state: string; challenge: string }): string {
  const url = new URL("https://auth.openai.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", OPENAI_SCOPES);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export interface LiveAccount {
  email: string | null;
  accountId: string | null;
  plan: string | null;
  role: OrgRole | null;
  workspaceName: string | null;
  windows: WindowReading[];
  bankedResets: number | null;
}

export function readChatGptAccountId(idToken: string): string | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const padded = payload.replaceAll("-", "+").replaceAll("_", "/");
    const json: unknown = JSON.parse(atob(padded));
    if (!json || typeof json !== "object") return null;
    const auth = (json as Record<string, unknown>)["https://api.openai.com/auth"];
    if (!auth || typeof auth !== "object") return null;
    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    return typeof accountId === "string" && accountId ? accountId : null;
  } catch {
    return null;
  }
}

function kindForSeconds(seconds: number): WindowKind | null {
  if (seconds >= 20 * 24 * 3600) return "monthly";
  if (seconds >= 6 * 24 * 3600) return "weekly";
  if (seconds > 0 && seconds <= 6 * 3600) return "five_hour";
  return null;
}

function roleFromAccount(value: string): OrgRole | null {
  if (["owner", "account-owner"].includes(value)) return "owner";
  if (["admin", "account-admin"].includes(value)) return "admin";
  if (["member", "account-member"].includes(value)) return "member";
  return null;
}

function planLabel(planType: string): string {
  if (planType.startsWith("self_serve_business") || ["business", "business_premium", "team"].includes(planType)) return "Business";
  if (planType.includes("plus")) return "Plus";
  if (planType === "pro" || planType.endsWith("_pro")) return "Pro";
  if (planType === "free") return "Free";
  return planType;
}

interface AccountRow {
  id?: string;
  plan_type?: string;
  account_user_role?: string;
  name?: string | null;
  structure?: string;
}

function preferredAccount(accounts: unknown, fallbackId: string | null): AccountRow | null {
  if (!accounts || typeof accounts !== "object") return null;
  const rows = (accounts as { accounts?: unknown }).accounts;
  if (!Array.isArray(rows)) return null;
  const typed = rows.filter((row): row is AccountRow => !!row && typeof row === "object");
  if (!fallbackId) return null;
  const matches = typed.filter((row) => row.id === fallbackId);
  return matches.length === 1 ? matches[0] : null;
}

export function parseOpenAiSnapshot(usage: unknown, accounts: unknown): LiveAccount {
  const empty: LiveAccount = {
    email: null,
    accountId: null,
    plan: null,
    role: null,
    workspaceName: null,
    windows: [],
    bankedResets: null,
  };
  if (!usage || typeof usage !== "object") return empty;
  const body = usage as {
    email?: unknown;
    account_id?: unknown;
    plan_type?: unknown;
    rate_limit?: { primary_window?: unknown; secondary_window?: unknown };
    rate_limit_reset_credits?: { available_count?: unknown };
  };
  const accountId = typeof body.account_id === "string" ? body.account_id : null;
  const account = preferredAccount(accounts, accountId);
  const windows: WindowReading[] = [];
  for (const raw of [body.rate_limit?.primary_window, body.rate_limit?.secondary_window]) {
    if (!raw || typeof raw !== "object") continue;
    const window = raw as { used_percent?: unknown; limit_window_seconds?: unknown; reset_at?: unknown };
    if (typeof window.used_percent !== "number" || typeof window.limit_window_seconds !== "number") continue;
    const kind = kindForSeconds(window.limit_window_seconds);
    if (!kind || windows.some((item) => item.kind === kind)) continue;
    const reset = typeof window.reset_at === "number" ? new Date(window.reset_at * 1000) : null;
    const resetsAt = reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : null;
    windows.push({
      kind,
      usedPercent: window.used_percent,
      resetsAt,
      status: window.used_percent >= 100 ? "rate-limited" : "ok",
    });
  }
  const banked = body.rate_limit_reset_credits?.available_count;
  const planType = typeof body.plan_type === "string" ? body.plan_type : typeof account?.plan_type === "string" ? account.plan_type : null;
  const workspace = account?.structure === "workspace" || (planType != null && ["Business", "team", "enterprise"].includes(planLabel(planType)));
  const role = workspace && typeof account?.account_user_role === "string" ? roleFromAccount(account.account_user_role) : null;
  return {
    email: typeof body.email === "string" ? body.email : null,
    accountId: account?.id ?? accountId,
    plan: planType ? planLabel(planType) : null,
    role,
    workspaceName: typeof account?.name === "string" ? account.name : null,
    windows,
    bankedResets: typeof banked === "number" && Number.isFinite(banked) ? Math.max(0, Math.round(banked)) : null,
  };
}
