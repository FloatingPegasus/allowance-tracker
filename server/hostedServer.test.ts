import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createHostedServer } from "./hostedServer";
import { hashOwnerPassword } from "./ownerAuth";

const password = "test-only-long-owner-password";
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashOwnerPassword(password); });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const target = { email: "owner@example.test", accountId: "account-one", workspace: false };
const exported = { subscriptions: [{ provider: "chatgpt", providerAccountId: target.accountId, login: target.email, plan: "Pro", readingSource: "live", accessToken: "must-not-be-stored" }] };
const at = "2026-09-26T12:00:00.000Z";
const unavailable = { data: null, updatedAt: null, error: "Not reported" };
const details = { accountId: target.accountId, email: target.email, observedAt: at, billing: { data: { active: true, interval: "monthly", currency: "USD", renewsAt: null, expiresAt: null, willRenew: true }, updatedAt: at, error: null }, seats: unavailable, directory: unavailable, invoices: unavailable };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "allowance-server-"));
  const assets = join(directory, "dist");
  await mkdir(assets); await writeFile(join(assets, "index.html"), "<h1>Allowance</h1>");
  await writeFile(join(directory, "private.txt"), "private-file");
  const read = vi.fn(async () => details);
  const launch = vi.fn(async () => ({ mode: "cloud" as const, loginUrl: "https://www.browserbase.com/test-only", read, close: async () => {} }));
  const server = createHostedServer({ origin: "https://allowance.example.test", directory, assets, passwordHash, encryptionKey: randomBytes(32).toString("base64"), apiKey: "test-only", launch });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const url = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const request = (path: string, body?: unknown, cookie = "", headers: Record<string, string> = {}): Promise<Response> => new Promise((resolve, reject) => {
    const req = httpRequest(`${url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Host: "allowance.example.test", Origin: "https://allowance.example.test", "Content-Type": "application/json", Cookie: cookie, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value || ""])) })));
    });
    req.on("error", reject); req.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
  });
  const login = async () => {
    const result = await request("/api/owner/login", { password });
    expect(result.status).toBe(200);
    const header = result.headers.get("set-cookie")!;
    expect(header).toMatch(/^__Host-allowance_owner=/);
    expect(header).toContain("HttpOnly; SameSite=Strict"); expect(header).toContain("Secure");
    return header.split(";")[0];
  };
  return { request, login, launch, read };
}

it("protects every account and billing endpoint behind owner authentication", async () => {
  const f = await fixture();
  for (const [path, body] of [["/api/accounts", undefined], ["/api/accounts/import", exported], ["/api/billing/start", { target }], ["/api/billing/read", {}]] as const) {
    expect((await f.request(path, body)).status).toBe(401);
  }
  expect((await f.request("/api/owner/login", { password: "incorrect" })).status).toBe(401);
  const cookie = await f.login();
  expect((await f.request("/api/accounts", undefined, cookie)).status).toBe(200);
  expect((await f.request("/api/owner/logout", {}, cookie)).status).toBe(200);
  expect((await f.request("/api/accounts", undefined, cookie)).status).toBe(401);
  expect(f.launch).not.toHaveBeenCalled();
});

it("rejects foreign origins and hosts and never serves files outside built assets", async () => {
  const f = await fixture();
  expect((await f.request("/api/owner/login", { password }, "", { Origin: "https://foreign.example" })).status).toBe(403);
  expect((await f.request("/api/owner/login", { password }, "", { "Content-Type": "text/plain" })).status).toBe(403);
  expect((await f.request("/api/accounts", undefined, "", { Host: "foreign.example" })).status).toBe(421);
  for (const path of ["/.env.local", "/allowance.sqlite", "/%2e%2e%2fprivate.txt", "/server/hostedStore.ts"]) expect((await f.request(path)).status).toBe(404);
  const page = await f.request("/");
  expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(await page.text()).toContain("Allowance");
});

it("saves billing only for imported identities and returns no imported credentials", async () => {
  const f = await fixture();
  const cookie = await f.login();
  expect((await f.request("/api/billing/start", { target }, cookie)).status).toBe(403);
  expect(f.launch).not.toHaveBeenCalled();
  const imported = await f.request("/api/accounts/import", exported, cookie);
  expect(imported.status).toBe(200); expect(await imported.text()).not.toContain("must-not-be-stored");
  const started = await f.request("/api/billing/start", { target }, cookie);
  const connection = await started.json();
  expect(started.status).toBe(200);
  expect((await f.request("/api/billing/read", { connectionId: connection.connectionId }, cookie)).status).toBe(200);
  const saved = await (await f.request("/api/accounts", undefined, cookie)).json();
  expect(saved.accounts[0].details).toEqual(details);
  expect(f.read).toHaveBeenCalledOnce();
});

it("limits failed sign-in attempts before doing further expensive password checks", async () => {
  const f = await fixture();
  for (let i = 0; i < 10; i++) expect((await f.request("/api/owner/login", { password: null })).status).toBe(401);
  expect((await f.request("/api/owner/login", { password })).status).toBe(429);
});
