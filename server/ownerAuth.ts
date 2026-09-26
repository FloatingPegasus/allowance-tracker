import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashOwnerPassword(password: string): Promise<string> {
  if (password.length < 16 || password.length > 1024) throw new Error("Use an owner password of 16–1024 characters.");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyOwnerPassword(password: unknown, stored: string): Promise<boolean> {
  if (typeof password !== "string" || password.length > 1024 || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(stored)) return false;
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, "hex"));
}
