import type { LiveAccount } from "./openaiLogin";
import type { WindowReading } from "./types";

/** Public Claude Code client. The password stays on Claude's page. */
export const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

const CLAUDE_SCOPES = "user:inference user:profile user:sessions:claude_code user:mcp_servers user:file_upload";

export function claudeAuthorizeUrl(input: { redirectUri: string; state: string; challenge: string }): string {
  const url = new URL("https://claude.ai/oauth/authorize");
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLAUDE_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", CLAUDE_SCOPES);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  return url.toString();
}

function percentWindow(raw: unknown, kind: WindowReading["kind"]): WindowReading | null {
  if (!raw || typeof raw !== "object") return null;
  const window = raw as { utilization?: unknown; resets_at?: unknown };
  if (typeof window.utilization !== "number" || !Number.isFinite(window.utilization)) return null;
  return {
    kind,
    usedPercent: window.utilization,
    resetsAt: typeof window.resets_at === "string" ? window.resets_at : null,
    status: window.utilization >= 100 ? "rate-limited" : "ok",
  };
}

export function parseClaudeSnapshot(usage: unknown, profile: unknown): LiveAccount {
  const windows: WindowReading[] = [];
  if (usage && typeof usage === "object") {
    const body = usage as { five_hour?: unknown; seven_day?: unknown };
    const session = percentWindow(body.five_hour, "five_hour");
    const weekly = percentWindow(body.seven_day, "weekly");
    if (session) windows.push(session);
    if (weekly) windows.push(weekly);
  }
  const account = profile && typeof profile === "object" ? (profile as { account?: unknown; organization?: unknown }).account : null;
  const organization = profile && typeof profile === "object" ? (profile as { organization?: unknown }).organization : null;
  const accountRecord = account && typeof account === "object" ? (account as { email?: unknown; uuid?: unknown; has_claude_max?: unknown; has_claude_pro?: unknown }) : null;
  const orgRecord = organization && typeof organization === "object" ? (organization as { name?: unknown }) : null;
  const plan = accountRecord?.has_claude_max === true ? "Max" : accountRecord?.has_claude_pro === true ? "Pro" : null;
  return {
    email: typeof accountRecord?.email === "string" ? accountRecord.email : null,
    accountId: typeof accountRecord?.uuid === "string" ? accountRecord.uuid : null,
    plan,
    role: null,
    workspaceName: typeof orgRecord?.name === "string" ? orgRecord.name : null,
    windows,
    bankedResets: null,
  };
}
