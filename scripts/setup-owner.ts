import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { digest, PrivateStore } from '../server/privateStore.ts';

process.umask(0o077);
const store = new PrivateStore(resolve(process.env.ALLOWANCE_DATA_DIR || '.allowance'));
try {
  const recover = process.argv.includes('--reset-owner');
  if (store.get('passwordHash') && !recover) throw new Error('Owner already configured. Use --reset-owner only to recover access; this signs out all browsers.');
  if (recover) { store.deleteSetting('passwordHash'); store.db.exec('DELETE FROM sessions'); }
  const token = randomBytes(32).toString('base64url');
  store.set('setupHash', digest(token)); store.set('setupExpires', String(Date.now() + 30 * 60_000));
  const origin = process.env.ALLOWANCE_ORIGIN || 'http://localhost:5173';
  console.log(`Open this private setup link within 30 minutes:\n${origin}/setup#setup=${token}`);
} finally { store.close(); }
