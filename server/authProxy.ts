import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/** Same public clients as src/domain/openaiLogin.ts and claudeLogin.ts. */
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

type Provider = "openai" | "claude";

interface Listener {
  server: ReturnType<typeof createServer>;
  redirectUri: string;
}

let listener: Listener | null = null;

function localOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.origin !== value) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
  return url.origin;
}

function closeListener(): void {
  listener?.server.close();
  listener = null;
}

function listen(port: number, path: string, appOrigin: string, provider: Provider, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== path || url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("This callback does not match the pending sign-in.");
        return;
      }
      const target = new URL("/auth/done", appOrigin);
      target.searchParams.set("provider", provider);
      for (const key of ["code", "state", "error", "error_description"]) {
        const value = url.searchParams.get(key);
        if (value && value.length < 2000) target.searchParams.set(key, value);
      }
      res.writeHead(302, { Location: target.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      res.end();
      if (listener?.server === server) listener = null;
      server.close();
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("Could not open callback.")); return; }
      const redirectUri = `http://${provider === "claude" ? "localhost" : "127.0.0.1"}:${address.port}${path}`;
      listener = { server, redirectUri };
      const timer = setTimeout(() => { if (listener?.server === server) closeListener(); }, 3 * 60 * 1000);
      server.once("close", () => clearTimeout(timer));
      resolve(redirectUri);
    });
  });
}

async function openListener(provider: Provider, appOrigin: string, state: string): Promise<string> {
  closeListener();
  if (provider === "claude") return listen(0, "/callback", appOrigin, provider, state);
  for (const port of [1455, 1457]) {
    try { return await listen(port, "/auth/callback", appOrigin, provider, state); }
    catch { /* Try the other registered callback port. */ }
  }
  throw new Error("ChatGPT sign-in needs port 1455 or 1457 to be available.");
}

export function trustedRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host || !localOrigin(`http://${host}`)) return false;
  const origin = req.headers.origin;
  if (origin !== `http://${host}` && origin !== `https://${host}`) return false;
  return req.headers["content-type"]?.split(";")[0]?.trim() === "application/json";
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_000) throw new Error("Sign-in request is too large.");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(payload);
}

function field(body: unknown, key: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

async function providerFetch(url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { status: response.status, text: await response.text() };
}

function tokenPayload(text: string): { accessToken: string; refreshToken: string; expiresIn: number; idToken: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; id_token?: unknown };
  if (typeof body.access_token !== "string") return null;
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : "",
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
    idToken: typeof body.id_token === "string" ? body.id_token : "",
  };
}

function failureMessage(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as { error_description?: unknown; error?: unknown };
    const error = parsed.error;
    const message =
      typeof parsed.error_description === "string"
        ? parsed.error_description
        : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : typeof error === "string"
            ? error
            : "";
    if (message && message.length < 160) return message;
  } catch {
    // Provider HTML stays off the page.
  }
  return `The provider rejected the sign-in (${status}).`;
}

export async function exchange(provider: Provider, body: unknown): Promise<{ status: number; payload: unknown }> {
  const code = field(body, "code");
  const redirectUri = field(body, "redirectUri");
  const verifier = field(body, "verifier");
  if (!code || !redirectUri || !verifier) return { status: 400, payload: { error: "Sign-in is missing the provider code." } };
  if (provider === "openai") {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    const result = await providerFetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
    });
    const tokens = result.status === 200 ? tokenPayload(result.text) : null;
    if (!tokens) return { status: 400, payload: { error: failureMessage(result.status, result.text) } };
    return { status: 200, payload: tokens };
  }
  const result = await providerFetch("https://platform.claude.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "claude-cli/2.1.0 (external, cli)",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLAUDE_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      state: field(body, "state"),
    }),
  });
  const tokens = result.status === 200 ? tokenPayload(result.text) : null;
  if (!tokens) return { status: 400, payload: { error: failureMessage(result.status, result.text) } };
  return { status: 200, payload: tokens };
}

export async function refresh(provider: Provider, refreshToken: string): Promise<{ status: number; payload: unknown }> {
  if (!refreshToken) return { status: 400, payload: { error: "Sign in again to refresh this seat." } };
  if (provider === "openai") {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: OPENAI_CLIENT_ID,
      refresh_token: refreshToken,
    });
    const result = await providerFetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
    });
    const tokens = result.status === 200 ? tokenPayload(result.text) : null;
    if (!tokens) return { status: 400, payload: { error: failureMessage(result.status, result.text) } };
    return { status: 200, payload: tokens };
  }
  const result = await providerFetch("https://platform.claude.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "claude-cli/2.1.0 (external, cli)",
    },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLAUDE_CLIENT_ID }),
  });
  const tokens = result.status === 200 ? tokenPayload(result.text) : null;
  if (!tokens) return { status: 400, payload: { error: failureMessage(result.status, result.text) } };
  return { status: 200, payload: tokens };
}

export async function usage(provider: Provider, accessToken: string, accountId: string): Promise<{ status: number; payload: unknown }> {
  if (!accessToken) return { status: 400, payload: { error: "Sign in again to read usage." } };
  if (provider === "openai") {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;
    const [usageResult, accountsResult] = await Promise.all([
      providerFetch("https://chatgpt.com/backend-api/wham/usage", { headers }),
      providerFetch("https://chatgpt.com/backend-api/wham/accounts/check", { headers }).catch(() => ({ status: 502, text: "" })),
    ]);
    if (usageResult.status !== 200) return { status: 400, payload: { error: failureMessage(usageResult.status, usageResult.text) } };
    let usageJson: unknown = null;
    let accountsJson: unknown = null;
    try {
      usageJson = JSON.parse(usageResult.text);
    } catch {
      return { status: 400, payload: { error: "ChatGPT returned usage that could not be read." } };
    }
    if (accountsResult.status === 200) {
      try {
        accountsJson = JSON.parse(accountsResult.text);
      } catch {
        accountsJson = null;
      }
    }
    return { status: 200, payload: { usage: usageJson, accounts: accountsJson } };
  }
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "anthropic-beta": "oauth-2025-04-20",
    "anthropic-version": "2023-06-01",
    "User-Agent": "claude-cli/2.1.0 (external, cli)",
  };
  const [usageResult, profileResult] = await Promise.all([
    providerFetch("https://api.anthropic.com/api/oauth/usage", { headers }),
    providerFetch("https://api.anthropic.com/api/oauth/profile", { headers }).catch(() => ({ status: 502, text: "" })),
  ]);
  if (usageResult.status !== 200) return { status: 400, payload: { error: failureMessage(usageResult.status, usageResult.text) } };
  let usageJson: unknown = null;
  let profileJson: unknown = null;
  try {
    usageJson = JSON.parse(usageResult.text);
  } catch {
    return { status: 400, payload: { error: "Claude returned usage that could not be read." } };
  }
  if (profileResult.status === 200) {
    try {
      profileJson = JSON.parse(profileResult.text);
    } catch {
      profileJson = null;
    }
  }
  return { status: 200, payload: { usage: usageJson, profile: profileJson } };
}

type Connect = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;

export function attachAuthRoutes(middlewares: { use: (handler: Connect) => void }): () => void {
  middlewares.use((req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (!path?.startsWith("/api/auth/")) {
      next();
      return;
    }
    if (!trustedRequest(req)) {
      send(res, 403, { error: "Sign-in requests must come from this local app." });
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "Sign-in only accepts POST." });
      return;
    }
    void (async () => {
      try {
        const body = await readBody(req);
        const provider = field(body, "provider");
        if (provider !== "openai" && provider !== "claude") {
          send(res, 400, { error: "Choose ChatGPT or Claude." });
          return;
        }
        if (path === "/api/auth/listen") {
          const origin = localOrigin(field(body, "appOrigin"));
          const state = field(body, "state");
          if (!origin || origin !== req.headers.origin || !/^[A-Za-z0-9_-]{22,128}$/.test(state)) {
            send(res, 400, { error: "Sign-in has to start from this app on localhost." });
            return;
          }
          const redirectUri = await openListener(provider, origin, state);
          send(res, 200, { redirectUri });
          return;
        }
        if (path === "/api/auth/exchange") {
          const result = await exchange(provider, body);
          send(res, result.status, result.payload);
          return;
        }
        if (path === "/api/auth/refresh") {
          const result = await refresh(provider, field(body, "refreshToken"));
          send(res, result.status, result.payload);
          return;
        }
        if (path === "/api/auth/usage") {
          const result = await usage(provider, field(body, "accessToken"), field(body, "accountId"));
          send(res, result.status, result.payload);
          return;
        }
        send(res, 404, { error: "Unknown sign-in route." });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sign-in failed.";
        send(res, 400, { error: message });
      }
    })();
  });
  return closeListener;
}
