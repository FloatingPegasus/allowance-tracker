import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class Vault {
  private key: Buffer;
  constructor(encoded: string) {
    this.key = Buffer.from(encoded, "base64");
    if (this.key.length !== 32 || this.key.toString("base64") !== encoded) throw new Error("ALLOWANCE_ENCRYPTION_KEY must be 32 random bytes encoded as base64.");
  }
  seal(userId: string, accountId: string, value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify([userId, accountId])));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  }
  open<T>(userId: string, accountId: string, value: string): T {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length < 29) throw new Error("Unreadable credential.");
    const cipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(JSON.stringify([userId, accountId])));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8")) as T;
  }
}
