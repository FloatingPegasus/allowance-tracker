import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { HostedStore } from "./hostedStore.ts";
import { hashOwnerPassword, verifyOwnerPassword } from "./ownerAuth.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "allowance-hosted-"));
  const key = randomBytes(32).toString("base64");
  const store = new HostedStore(directory, key);
  cleanups.push(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, directory, key };
}
const exported = { subscriptions: [{ provider: "chatgpt", providerAccountId: "account-one", login: "owner@example.test", plan: "Pro", readingSource: "live", accessToken: "never-import-this", refreshToken: "never-import-this" }] };

it("imports account identities without credentials and encrypts the saved records", async () => {
  const { store, directory } = await fixture();
  expect(store.importAccounts(exported)).toBe(1);
  expect(store.importAccounts(exported)).toBe(0);
  const accounts = store.accounts();
  expect(accounts[0].email).toBe("owner@example.test");
  expect(JSON.stringify(accounts)).not.toContain("never-import-this");
  for (const file of ["allowance.sqlite", "allowance.sqlite-wal"]) {
    const data = await readFile(join(directory, file));
    expect(data.includes(Buffer.from("owner@example.test"))).toBe(false);
  }
  expect(store.matches({ email: "owner@example.test", accountId: "account-one", workspace: false })).toBe(true);
  expect(store.matches({ email: "other@example.test", accountId: "account-one", workspace: false })).toBe(false);
});

it("rejects an invalid import without losing existing accounts", async () => {
  const { store } = await fixture();
  store.importAccounts(exported);
  expect(() => store.importAccounts({ subscriptions: [{ provider: "chatgpt", login: "invalid" }] })).toThrow();
  expect(store.accounts()).toHaveLength(1);
});

it("revokes sessions on logout or owner password changes", async () => {
  const { store } = await fixture();
  const token = store.createSession("credential-one");
  expect(store.session(token, "credential-one")).toBe(true);
  expect(store.session(token, "credential-two")).toBe(false);
  expect(store.session("guessed", "credential-one")).toBe(false);
  store.logout(token);
  expect(store.session(token, "credential-one")).toBe(false);
});

it("reopens encrypted accounts with the original key and fails closed with a different key", async () => {
  const { store, directory, key } = await fixture();
  store.importAccounts(exported);
  const reopened = new HostedStore(directory, key);
  expect(reopened.accounts()).toEqual(store.accounts());
  reopened.close();
  const wrong = new HostedStore(directory, randomBytes(32).toString("base64"));
  expect(() => wrong.accounts()).toThrow();
  wrong.close();
  expect(store.accounts()).toHaveLength(1);
});

it("persists failed-check timestamps without replacing successful billing", async () => {
  const { store } = await fixture();
  store.importAccounts(exported);
  const account = store.accounts()[0];
  const observedAt = "2026-09-26T12:00:00.000Z";
  const unavailable = { data: null, updatedAt: null, error: "Not reported" };
  const details = { accountId: account.accountId, email: account.email, observedAt, billing: { data: { active: true, interval: "monthly" as const, currency: "USD", renewsAt: null, expiresAt: null, willRenew: true }, updatedAt: observedAt, error: null }, seats: unavailable, directory: unavailable, invoices: unavailable };
  store.saveBilling(details);
  store.saveFailure(account, "Sign in again.");
  expect(store.accounts()[0].details).toEqual(details);
  expect(store.accounts()[0].billingError?.message).toBe("Sign in again.");
  expect(() => store.saveBilling({ ...details, email: "other@example.test" })).toThrow();
  store.saveBilling(details);
  expect(store.accounts()[0].billingError).toBeUndefined();
});

it("verifies salted owner password hashes without accepting malformed hashes", async () => {
  const hash = await hashOwnerPassword("test-only-long-owner-password");
  expect(hash).not.toContain("test-only");
  expect(await verifyOwnerPassword("test-only-long-owner-password", hash)).toBe(true);
  expect(await verifyOwnerPassword("incorrect", hash)).toBe(false);
  expect(await verifyOwnerPassword("test-only-long-owner-password", "malformed")).toBe(false);
});
