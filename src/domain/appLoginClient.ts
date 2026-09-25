import { claudeAuthorizeUrl, parseClaudeSnapshot } from "./claudeLogin";
import { openaiAuthorizeUrl, parseOpenAiSnapshot, readChatGptAccountId } from "./openaiLogin";
import type { LiveAccount } from "./openaiLogin";
import { createPkce } from "./pkce";
import type { AppLogin, AppLoginProvider } from "./sessions";

const PENDING = "allowance-login-pending";

export interface PendingLogin {
  subscriptionId: string;
  provider: AppLoginProvider;
  verifier: string;
  state: string;
  redirectUri: string;
}

export interface IssuedLogin {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  idToken: string;
}

async function post(path: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach sign-in. Run the app with the dev server.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string" ? (payload as { error: string }).error : "Sign-in failed.";
    throw new Error(message);
  }
  return payload;
}

function issued(payload: unknown): IssuedLogin {
  if (!payload || typeof payload !== "object") throw new Error("The provider returned an unreadable sign-in.");
  const body = payload as IssuedLogin;
  if (!body.accessToken) throw new Error("The provider returned an unreadable sign-in.");
  return { accessToken: body.accessToken, refreshToken: body.refreshToken || "", expiresIn: body.expiresIn || 3600, idToken: body.idToken || "" };
}

export function loadPending(): PendingLogin | null {
  try {
    const raw = sessionStorage.getItem(PENDING);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const pending = value as PendingLogin;
    if ((pending.provider !== "openai" && pending.provider !== "claude") || !pending.subscriptionId || !pending.verifier || !pending.state || !pending.redirectUri) {
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  sessionStorage.removeItem(PENDING);
}

export async function beginLogin(subscriptionId: string, provider: AppLoginProvider): Promise<void> {
  const pkce = await createPkce();
  const appOrigin = window.location.origin;
  const payload = await post("/api/auth/listen", { provider, appOrigin, state: pkce.state });
  const redirectUri = payload && typeof payload === "object" ? (payload as { redirectUri?: unknown }).redirectUri : null;
  if (typeof redirectUri !== "string" || !redirectUri) throw new Error("Couldn't open the provider sign-in.");
  const pending: PendingLogin = { subscriptionId, provider, verifier: pkce.verifier, state: pkce.state, redirectUri };
  sessionStorage.setItem(PENDING, JSON.stringify(pending));
  const authorize = provider === "openai" ? openaiAuthorizeUrl({ redirectUri, state: pkce.state, challenge: pkce.challenge }) : claudeAuthorizeUrl({ redirectUri, state: pkce.state, challenge: pkce.challenge });
  window.location.assign(authorize);
}

export async function finishLogin(pending: PendingLogin, code: string): Promise<AppLogin> {
  const payload = issued(
    await post("/api/auth/exchange", {
      provider: pending.provider,
      code,
      redirectUri: pending.redirectUri,
      verifier: pending.verifier,
      state: pending.state,
    }),
  );
  return {
    provider: pending.provider,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresAt: Date.now() + payload.expiresIn * 1000,
    accountId: pending.provider === "openai" ? readChatGptAccountId(payload.idToken) : null,
    email: null,
    plan: null,
    workspaceName: null,
  };
}

export async function refreshLogin(login: AppLogin): Promise<AppLogin> {
  if (login.expiresAt > Date.now() + 60_000) return login;
  const payload = issued(await post("/api/auth/refresh", { provider: login.provider, refreshToken: login.refreshToken }));
  return {
    ...login,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken || login.refreshToken,
    expiresAt: Date.now() + payload.expiresIn * 1000,
    accountId: login.provider === "openai" ? readChatGptAccountId(payload.idToken) ?? login.accountId : login.accountId,
  };
}

export async function fetchLiveAccount(login: AppLogin): Promise<LiveAccount> {
  const payload = await post("/api/auth/usage", {
    provider: login.provider,
    accessToken: login.accessToken,
    accountId: login.accountId ?? "",
  });
  if (!payload || typeof payload !== "object") throw new Error("Usage could not be read.");
  const body = payload as { usage?: unknown; accounts?: unknown; profile?: unknown };
  return login.provider === "openai" ? parseOpenAiSnapshot(body.usage, body.accounts) : parseClaudeSnapshot(body.usage, body.profile);
}

export function matchesCallback(pending: PendingLogin | null, state: string | null, provider: string | null): boolean {
  return !!pending && state === pending.state && provider === pending.provider;
}
