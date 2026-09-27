import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { TrackedAccount } from '../src/domain/private.ts';
import { Vault } from './vault.ts';

export interface AccountRecord extends TrackedAccount {
  profile: string | null;
  identity: string | null;
  secret: string | null;
  pendingReset: string | null;
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const publicAccount = ({ profile: _profile, identity: _identity, secret: _secret, ...account }: AccountRecord): TrackedAccount => account;

export class PrivateStore {
  readonly db: DatabaseSync;
  readonly vault: Vault;
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const keyPath = join(directory, 'encryption.key');
    try { writeFileSync(keyPath, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    this.vault = new Vault(readFileSync(keyPath, 'utf8').trim());
    const path = join(directory, 'allowance.sqlite');
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS resets (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, outcome TEXT);
      CREATE TABLE IF NOT EXISTS throttles (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);`);
  }
  get(key: string): string | null { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value ?? null; }
  set(key: string, value: string) { this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  deleteSetting(key: string) { this.db.prepare('DELETE FROM settings WHERE key=?').run(key); }
  list(): AccountRecord[] { return (this.db.prepare('SELECT payload FROM accounts ORDER BY rowid').all() as { payload: string }[]).map(row => JSON.parse(row.payload)); }
  account(id: string): AccountRecord | null { const row = this.db.prepare('SELECT payload FROM accounts WHERE id=?').get(id) as { payload: string } | undefined; return row ? JSON.parse(row.payload) : null; }
  save(account: AccountRecord) { this.db.prepare('INSERT INTO accounts VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(account.id, JSON.stringify(account)); }
  remove(id: string) { this.db.prepare('DELETE FROM accounts WHERE id=?').run(id); }
  allow(key: string, limit: number, milliseconds: number, now = Date.now()): boolean {
    this.db.prepare('DELETE FROM throttles WHERE until<=?').run(now);
    const row = this.db.prepare('SELECT count FROM throttles WHERE key=?').get(key) as { count: number } | undefined;
    if (row && row.count >= limit) return false;
    this.db.prepare('INSERT INTO throttles VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + milliseconds);
    return true;
  }
  createSession(): { token: string; expires: number } {
    const token = randomBytes(32).toString('base64url');
    const expires = Date.now() + 30 * 86400_000;
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?, ?)').run(digest(token), expires);
    return { token, expires };
  }
  validSession(token: string): boolean { return !!token && !!this.db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(digest(token), Date.now()); }
  logout(token: string) { this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token)); }
  reset(id: string): { account_id: string; outcome: string | null } | undefined { return this.db.prepare('SELECT account_id, outcome FROM resets WHERE id=?').get(id) as { account_id: string; outcome: string | null } | undefined; }
  startReset(id: string, accountId: string) { this.db.prepare('INSERT OR IGNORE INTO resets VALUES (?, ?, NULL)').run(id, accountId); }
  finishReset(id: string, outcome: string) { this.db.prepare('UPDATE resets SET outcome=? WHERE id=?').run(outcome, id); }
  close() { this.db.close(); }
}
