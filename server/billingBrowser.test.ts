import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { createBillingRoutes } from "./billingBrowser";

const target = { accountId: "workspace-one", email: "owner@example.test", workspace: true };
const observedAt = "2026-09-25T12:00:00.000Z";
const unavailable = { data: null, updatedAt: null, error: "Not reported" };
const details = {
  accountId: target.accountId, email: target.email, observedAt,
  billing: { data: { active: true, interval: "monthly", currency: "USD", renewsAt: null, expiresAt: null, willRenew: true }, updatedAt: observedAt, error: null },
  seats: unavailable, directory: unavailable, invoices: unavailable,
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(options: { read?: () => Promise<unknown>; ttl?: number; failLaunch?: boolean } = {}) {
  let disconnected = () => {};
  const close = vi.fn(async () => { disconnected(); });
  const read = vi.fn(options.read ?? (async () => details));
  const launch = vi.fn(async (onClose: () => void) => {
    if (options.failLaunch) throw new Error("private browser internals");
    disconnected = onClose;
    return { read, close };
  });
  const routes = createBillingRoutes(launch, options.ttl);
  const server = createServer((req, res) => routes.middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => { routes.cleanup(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const post = (path: string, body: unknown, from = origin) => fetch(`${origin}/api/billing/${path}`, { method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const start = async () => {
    const response = await post("start", { target });
    expect(response.status).toBe(200);
    return await response.json() as { connectionId: string };
  };
  return { post, start, read, close, launch, disconnect: () => disconnected() };
}

it("rejects external origins and invalid identities before launching a browser", async () => {
  const f = await fixture();
  expect((await f.post("start", { target }, "https://external.example")).status).toBe(403);
  expect((await f.post("start", { target: { ...target, accountId: "../other" } })).status).toBe(400);
  expect((await f.post("start", { target: { ...target, accessToken: "not-accepted" } })).status).toBe(400);
  expect(f.launch).not.toHaveBeenCalled();
});

it("binds a single connection to its original account and closes it after one read", async () => {
  const f = await fixture();
  const connection = await f.start();
  expect((await f.post("start", { target })).status).toBe(409);
  expect((await f.post("read", { connectionId: "wrong" })).status).toBe(410);
  const response = await f.post("read", { ...connection, target: { ...target, accountId: "other" } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ details });
  expect(f.read).toHaveBeenCalledExactlyOnceWith(target);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect((await f.post("read", connection)).status).toBe(410);
});

it("keeps the window open on a wrong login or untrusted result, allowing a safe retry", async () => {
  const f = await fixture();
  f.read.mockResolvedValueOnce({ mismatch: true }).mockResolvedValueOnce({ ...details, accessToken: "secret" }).mockResolvedValueOnce({ ...details, accountId: "other" });
  const connection = await f.start();
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await f.post("read", connection);
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("secret");
  }
  expect(f.close).not.toHaveBeenCalled();
  expect((await f.post("read", connection)).status).toBe(200);
  expect(f.close).toHaveBeenCalledTimes(1);
});

it("discards a pending result after cancel and rejects concurrent reads", async () => {
  let finish!: (value: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const f = await fixture({ read: () => { entered(); return new Promise((resolve) => { finish = resolve; }); } });
  const connection = await f.start();
  const pending = f.post("read", connection);
  await started;
  expect((await f.post("read", connection)).status).toBe(409);
  expect((await f.post("cancel", connection)).status).toBe(200);
  finish(details);
  const response = await pending;
  expect(response.status).toBe(410);
  expect(await response.text()).not.toContain("details");
  expect(f.close).toHaveBeenCalledTimes(1);
});

it("expires abandoned sessions and releases the browser after a user closes it", async () => {
  const f = await fixture({ ttl: 250 });
  const connection = await f.start();
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledTimes(1));
  expect((await f.post("read", connection)).status).toBe(410);
  const next = await f.start();
  f.disconnect();
  expect((await f.post("read", next)).status).toBe(410);
  expect(f.close).toHaveBeenCalledTimes(2);
});

it("reports a launch failure without leaking internals or retaining a connection", async () => {
  const f = await fixture({ failLaunch: true });
  const response = await f.post("start", { target });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private browser internals");
  expect((await f.post("start", { target })).status).toBe(503);
  expect(f.launch).toHaveBeenCalledTimes(2);
});
