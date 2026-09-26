import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createBillingRoutes, type LaunchBrowser } from "./billingBrowser.ts";
import { cloudBrowser } from "./cloudBrowser.ts";
import { HostedStore } from "./hostedStore.ts";
import { verifyOwnerPassword } from "./ownerAuth.ts";

interface Options { origin: string; directory: string; encryptionKey: string; passwordHash: string; apiKey: string; projectId?: string; assets?: string; launch?: LaunchBrowser }
class RequestError extends Error {}

async function jsonBody(req: IncomingMessage, maximum = 2_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); length += bytes.length;
    if (length > maximum) throw new RequestError("Request too large.");
    chunks.push(bytes);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new RequestError("Invalid JSON request."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("Invalid request.");
  return value as Record<string, unknown>;
}

export function createHostedServer(options: Options) {
  const origin = new URL(options.origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  const cookieName = local ? "allowance_owner" : "__Host-allowance_owner";
  if (origin.origin !== options.origin || (!local && origin.protocol !== "https:")) throw new Error("ALLOWANCE_ORIGIN must be an exact HTTPS origin.");
  if (!/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(options.passwordHash) || !options.apiKey) throw new Error("Configure the owner password hash and cloud browser key before starting.");
  const store = new HostedStore(options.directory, options.encryptionKey);
  const assets = resolve(options.assets || "dist");
  const authorizedOrigin = (req: IncomingMessage) => req.headers.host === origin.host && req.headers.origin === origin.origin && req.headers["content-type"]?.split(";")[0]?.trim() === "application/json";
  const tokenFrom = (req: IncomingMessage) => req.headers.cookie?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || "";
  const cookie = (token: string, age: number) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${local ? "" : "; Secure"}`;
  const send = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
  let loginAttempts: number[] = [];
  let verifying = false;
  let starts: number[] = [];
  const billing = createBillingRoutes(options.launch ?? cloudBrowser({ apiKey: options.apiKey, projectId: options.projectId, directory: resolve(options.directory, "profiles") }), undefined, "The cloud billing browser could not start.", {
    authorize: authorizedOrigin, targetAllowed: (target) => store.matches(target), save: (details) => store.saveBilling(details), failure: (target, message) => store.saveFailure(target, message),
  });
  const server = createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (!local) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    void (async () => {
      const path = new URL(req.url || "/", origin).pathname;
      if (path === "/healthz" && req.method === "GET") { send(res, 200, { ok: true }); return; }
      if (req.headers.host !== origin.host) { send(res, 421, { error: "Unexpected host." }); return; }
      if (path === "/api/runtime" && req.method === "GET") { send(res, 200, { hosted: true }); return; }
      if (path.startsWith("/api/")) {
        if (req.method !== "GET" && !authorizedOrigin(req)) { send(res, 403, { error: "Requests must come from this app." }); return; }
        if (path === "/api/owner/login" && req.method === "POST") {
          loginAttempts = loginAttempts.filter((at) => at > Date.now() - 5 * 60_000);
          if (loginAttempts.length >= 10 || verifying) { send(res, 429, { error: "Too many sign-in attempts. Retry in five minutes." }); return; }
          loginAttempts.push(Date.now());
          verifying = true;
          try {
            const body = await jsonBody(req, 4096);
            if (!await verifyOwnerPassword(body.password, options.passwordHash)) { send(res, 401, { error: "Sign-in failed." }); return; }
            const token = store.createSession(options.passwordHash);
            res.setHeader("Set-Cookie", cookie(token, 7 * 86_400));
            send(res, 200, { signedIn: true });
          } finally { verifying = false; }
          return;
        }
        const token = tokenFrom(req);
        if (!store.session(token, options.passwordHash)) { send(res, 401, { error: "Sign in to Allowance." }); return; }
        if (path === "/api/owner/logout" && req.method === "POST") { store.logout(token); await billing.cleanup(); res.setHeader("Set-Cookie", cookie("", 0)); send(res, 200, { signedIn: false }); return; }
        if (path === "/api/accounts" && req.method === "GET") { send(res, 200, { accounts: store.accounts() }); return; }
        if (path === "/api/accounts/import" && req.method === "POST") {
          const body = await jsonBody(req);
          try { send(res, 200, { added: store.importAccounts(body), accounts: store.accounts() }); }
          catch { send(res, 400, { error: "The account export is invalid. Existing accounts were kept." }); }
          return;
        }
        if (path === "/api/billing/start" && req.method === "POST") {
          starts = starts.filter((at) => at > Date.now() - 60_000);
          if (starts.length >= 5) { send(res, 429, { error: "Wait a minute before starting another billing check." }); return; }
          starts.push(Date.now());
        }
        billing.middleware(req, res, () => send(res, 404, { error: "Unknown API route." }));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") { send(res, 405, { error: "Method not allowed." }); return; }
      let decoded: string;
      try { decoded = decodeURIComponent(path); } catch { send(res, 400, { error: "Invalid path." }); return; }
      const file = resolve(assets, `.${decoded === "/" ? "/index.html" : decoded}`);
      if (!file.startsWith(`${assets}${sep}`)) { send(res, 404, { error: "Not found." }); return; }
      let content: Buffer;
      try { content = await readFile(file); } catch { send(res, 404, { error: "Not found." }); return; }
      const contentType: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
      res.writeHead(200, { "Content-Type": contentType[extname(file)] || "application/octet-stream", "Cache-Control": file.endsWith(".html") ? "no-store" : "public, max-age=3600" });
      res.end(req.method === "HEAD" ? undefined : content);
    })().catch((error: unknown) => { if (!res.headersSent) send(res, error instanceof RequestError ? 400 : 500, { error: error instanceof RequestError ? error.message : "The request failed. Saved records were kept." }); else res.end(); });
  });
  server.once("close", () => { void billing.cleanup().finally(() => store.close()); });
  return server;
}
