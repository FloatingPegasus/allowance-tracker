import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { isBrowserDetails, mergeBillingRecords, type BillingTarget, type BrowserDetails } from "../src/domain/billingRecords.ts";

import type { HostedAccount } from "../src/domain/hosted.ts";

export class HostedStore {
  private db: DatabaseSync;
  private key: Buffer;
  constructor(directory: string, encryptionKey: string) {
    this.key = Buffer.from(encryptionKey, "base64");
    if (this.key.length !== 32) throw new Error("ALLOWANCE_ENCRYPTION_KEY must encode 32 random bytes.");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "allowance.sqlite"));
    chmodSync(join(directory, "allowance.sqlite"), 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, credential TEXT NOT NULL);");
  }
  close() { this.db.close(); }
  private encrypt(account: HostedAccount) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(account.id));
    const body = Buffer.concat([cipher.update(JSON.stringify(account), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  private decrypt(id: string, value: string): HostedAccount {
    const bytes = Buffer.from(value, "base64");
    const cipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const account = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8")) as HostedAccount;
    if (account.id !== id) throw new Error("Saved account integrity check failed.");
    return account;
  }
  accounts(): HostedAccount[] {
    return this.db.prepare("SELECT id, value FROM accounts ORDER BY rowid").all().map((row) => this.decrypt(String(row.id), String(row.value)));
  }
  matches(target: BillingTarget) {
    return this.accounts().filter((a) => a.accountId === target.accountId && a.email.toLowerCase() === target.email.toLowerCase() && a.workspace === target.workspace).length === 1;
  }
  importAccounts(value: unknown): number {
    if (!value || typeof value !== "object" || !("subscriptions" in value) || !Array.isArray(value.subscriptions) || value.subscriptions.length > 100) throw new Error("Choose a valid Allowance account export.");
    const workspaces = "workspaces" in value && Array.isArray(value.workspaces) ? value.workspaces : [];
    const existing = this.accounts();
    const added: HostedAccount[] = [];
    for (const item of value.subscriptions) {
      if (!item || typeof item !== "object" || !["chatgpt", "codex"].includes(item.provider) || item.readingSource === "seed") continue;
      if (typeof item.providerAccountId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(item.providerAccountId) || typeof item.login !== "string" || !item.login.includes("@") || item.login.length > 200 || typeof item.plan !== "string" || item.plan.length > 100) throw new Error("An account is missing its verified provider identity.");
      const email = item.login.trim().toLowerCase();
      const id = createHash("sha256").update(JSON.stringify([email, item.providerAccountId])).digest("hex");
      if (existing.some((a) => a.id === id) || added.some((a) => a.id === id)) continue;
      const workspace = workspaces.find((w) => w && typeof w === "object" && w.id === item.workspaceId);
      const account: HostedAccount = { id, email, accountId: item.providerAccountId, plan: item.plan, workspace: !!item.workspaceId, workspaceName: typeof workspace?.name === "string" ? workspace.name.slice(0, 200) : null, role: ["owner", "admin", "member"].includes(item.accountRole) ? item.accountRole : null };
      if (isBrowserDetails(item.browserDetails) && item.browserDetails.accountId === account.accountId && item.browserDetails.email.toLowerCase() === email) account.details = item.browserDetails;
      added.push(account);
    }
    if (existing.length + added.length > 100) throw new Error("This tracker supports up to 100 accounts.");
    if (!added.length) return 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const account of added) this.db.prepare("INSERT INTO accounts (id,value) VALUES (?,?)").run(account.id, this.encrypt(account));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return added.length;
  }
  saveBilling(details: BrowserDetails) {
    if (!isBrowserDetails(details)) throw new Error("Invalid billing record.");
    const matches = this.accounts().filter((a) => a.accountId === details.accountId && a.email.toLowerCase() === details.email.toLowerCase());
    if (matches.length !== 1) throw new Error("Billing identity did not match one saved account.");
    const account = matches[0];
    if (account.details && Date.parse(account.details.observedAt) > Date.parse(details.observedAt)) return;
    account.details = mergeBillingRecords(account.details, details);
    delete account.billingError;
    this.db.prepare("UPDATE accounts SET value=? WHERE id=?").run(this.encrypt(account), account.id);
  }
  saveFailure(target: BillingTarget, message: string) {
    const account = this.accounts().find((a) => a.accountId === target.accountId && a.email.toLowerCase() === target.email.toLowerCase() && a.workspace === target.workspace);
    if (!account) throw new Error("Unknown account.");
    account.billingError = { at: new Date().toISOString(), message: message.slice(0, 500) };
    this.db.prepare("UPDATE accounts SET value=? WHERE id=?").run(this.encrypt(account), account.id);
  }
  createSession(credential: string): string {
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires < ? OR credential != ?").run(Date.now(), credential);
    this.db.prepare("INSERT INTO sessions (hash,expires,credential) VALUES (?,?,?)").run(this.hash(token), Date.now() + 7 * 86_400_000, credential);
    return token;
  }
  session(token: string, credential: string) {
    return /^[a-f0-9]{64}$/.test(token) && !!this.db.prepare("SELECT hash FROM sessions WHERE hash=? AND expires>? AND credential=?").get(this.hash(token), Date.now(), credential);
  }
  logout(token: string) { this.db.prepare("DELETE FROM sessions WHERE hash=?").run(this.hash(token)); }
  private hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
}
