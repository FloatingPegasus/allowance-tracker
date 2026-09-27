import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}:${(await derive(password, salt)).toString('base64')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, expected] = encoded.split(':').map(value => Buffer.from(value, 'base64'));
  if (!salt || !expected || salt.length !== 16 || expected.length !== 32) return false;
  return timingSafeEqual(await derive(password, salt), expected);
}
