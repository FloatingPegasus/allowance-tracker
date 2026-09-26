import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BillingTarget } from "../src/domain/billingRecords.ts";

export class BillingProfiles {
  constructor(privateDirectory: string) { this.directory = privateDirectory; }
  private directory: string;

  private path(target: BillingTarget) {
    const identity = JSON.stringify([target.email.trim().toLowerCase(), target.accountId, target.workspace]);
    return join(this.directory, `${createHash("sha256").update(identity).digest("hex")}.json`);
  }

  async get(target: BillingTarget): Promise<string | null> {
    let source: string;
    try { source = await readFile(this.path(target), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Saved billing profiles could not be read."); }
    let value: unknown;
    try { value = JSON.parse(source); } catch { throw new Error("The saved billing profile is unreadable. It has not been replaced."); }
    if (!value || typeof value !== "object" || !("contextId" in value) || typeof value.contextId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value.contextId)) throw new Error("The saved billing profile is invalid. It has not been replaced.");
    return value.contextId;
  }

  async set(target: BillingTarget, contextId: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(contextId)) throw new Error("Invalid cloud profile.");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(target);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify({ contextId }), { mode: 0o600 });
    await rename(temporary, path);
  }
}
