import { randomUUID, timingSafeEqual } from 'node:crypto';
import { isBillingSchedule } from '../src/domain/billingSchedule.ts';
import { parseState } from '../src/domain/storage.ts';
import type { Provider, Snapshot, TrackedAccount } from '../src/domain/private.ts';
import { digest, PrivateStore, publicAccount, type AccountRecord } from './privateStore.ts';
import { hashPassword, verifyPassword } from './password.ts';
import type { LoginAttempt, ProviderService } from './cliProvider.ts';
import { record } from './cliUsage.ts';

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const providerId = (v: unknown): v is Provider => ['codex', 'claude', 'opencode'].includes(v as string);
export function blankAccount(provider: Provider): AccountRecord {
  return { id: randomUUID(), provider, email: null, identity: null, plan: null, connected: false, profile: null, secret: null, windows: [], resetCredits: null, checkedAt: null, error: null, billingSchedule: null, businessSeat: null, pendingReset: null };
}
export function applySnapshot(row: AccountRecord, snapshot: Snapshot): void {
  const changed = row.identity && snapshot.identity ? row.identity !== snapshot.identity : row.email && snapshot.email && row.email !== snapshot.email;
  if (changed) { row.billingSchedule = null; row.businessSeat = null; }
  row.email = snapshot.email; row.identity = snapshot.identity; row.plan = snapshot.plan;
  row.windows = snapshot.windows; row.resetCredits = snapshot.resetCredits;
  if (row.plan !== 'Business') row.businessSeat = null;
  row.connected = true; row.checkedAt = new Date().toISOString(); row.error = null;
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(); if (!reader) return {};
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 1_000_000) { await reader.cancel(); throw new ApiError(413, 'Request too large.'); }
    chunks.push(value);
  }
  try { const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (body !== null && typeof body === 'object' && !Array.isArray(body)) return record(body); } catch { /* Validation error below. */ }
  throw new ApiError(400, 'Invalid request.');
}
function imported(body: Record<string, unknown>, count: number): AccountRecord[] {
  let source: unknown[];
  if (body.version === 2 && Array.isArray(body.accounts)) source = body.accounts;
  else {
    const old = parseState(JSON.stringify(body));
    if (!old) throw new ApiError(400, 'Choose an Allowance export.');
    source = old.subscriptions.filter(a => a.readingSource !== 'seed').map(a => ({ provider: a.provider === 'chatgpt' ? 'codex' : a.provider, email: a.login, plan: a.plan, windows: a.readingsKnown ? a.windows.map(w => ({ id: w.kind, label: w.label, usedPercent: w.usedPercent, resetsAt: w.resetsAt })) : [], checkedAt: a.usageCheckedAt ?? null, billingSchedule: a.billingSchedule ?? null, businessSeat: a.manualBusinessSeat ?? null }));
  }
  if (!source.length || source.length + count > 50) throw new ApiError(400, 'An import must fit within 50 accounts.');
  return source.map(item => {
    const raw = record(item);
    if (!providerId(raw.provider)) throw new ApiError(400, 'Invalid account provider.');
    const row = blankAccount(raw.provider);
    if (raw.email !== null && (typeof raw.email !== 'string' || raw.email.length > 200)) throw new ApiError(400, 'Invalid account name.');
    row.email = raw.email as string | null; row.plan = typeof raw.plan === 'string' ? raw.plan.slice(0, 100) : null;
    if (!Array.isArray(raw.windows) || raw.windows.length > 30) throw new ApiError(400, 'Invalid usage windows.');
    row.windows = raw.windows.map(value => {
      const w = record(value);
      if (typeof w.id !== 'string' || typeof w.label !== 'string' || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) throw new ApiError(400, 'Invalid usage reading.');
      return { id: w.id.slice(0, 100), label: w.label.slice(0, 100), usedPercent: w.usedPercent, resetsAt: typeof w.resetsAt === 'string' && Number.isFinite(Date.parse(w.resetsAt)) ? new Date(w.resetsAt).toISOString() : null };
    });
    row.checkedAt = typeof raw.checkedAt === 'string' && Number.isFinite(Date.parse(raw.checkedAt)) ? new Date(raw.checkedAt).toISOString() : null;
    if (raw.billingSchedule != null) { if (!isBillingSchedule(raw.billingSchedule)) throw new ApiError(400, 'Invalid billing date.'); row.billingSchedule = { anchorDate: raw.billingSchedule.anchorDate, interval: raw.billingSchedule.interval }; }
    row.businessSeat = row.plan === 'Business' && ['Standard', 'Premium'].includes(raw.businessSeat as string) ? raw.businessSeat as 'Standard' | 'Premium' : null;
    return row;
  });
}

export function createPrivateApi(store: PrivateStore, provider: ProviderService, originString: string) {
  const origin = new URL(originString);
  if (origin.origin !== originString || origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) throw new Error('ALLOWANCE_ORIGIN must be an exact HTTPS origin (HTTP is allowed only on localhost).');
  const secure = origin.protocol === 'https:';
  const cookieName = secure ? '__Host-allowance' : 'allowance';
  const cookie = (token: string, age: number) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const tokenOf = (request: Request) => (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const send = (status: number, value: unknown, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
  const busy = new Set<string>();
  const attempts = new Map<string, LoginAttempt>();
  const cancel = async (id: string) => {
    const attempt = attempts.get(id);
    if (attempt) { attempts.delete(id); attempt.close(); await provider.removeProfile(attempt.profile); }
  };
  const timer = setInterval(() => {
    for (const [id, attempt] of attempts) if (attempt.info.expiresAt < Date.now() && !busy.has(id)) void cancel(id).catch(() => {});
  }, 30_000); timer.unref();
  async function refresh(row: AccountRecord) {
    try {
      const key = row.secret ? store.vault.open<string>('owner', row.id, row.secret) : undefined;
      applySnapshot(row, await provider.usage(row.provider, row.profile, key));
    } catch { row.error = 'Usage could not refresh. Retry or reconnect.'; }
    store.save(row);
  }
  return {
    async close() { clearInterval(timer); await Promise.allSettled([...attempts.keys()].map(cancel)); },
    async handle(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        if (url.origin !== origin.origin) throw new ApiError(421, 'Unexpected host.');
        const route = url.pathname;
        if (request.method === 'GET' && route === '/api/health') return send(200, { ok: true });
        if (!['GET', 'POST'].includes(request.method)) throw new ApiError(405, 'Method not allowed.');
        if (request.method === 'POST' && (request.headers.get('origin') !== origin.origin || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')) throw new ApiError(403, 'Requests must come from this app.');
        const token = tokenOf(request); const authenticated = store.validSession(token);
        if (request.method === 'GET' && route === '/api/session') return send(200, { authenticated });
        if (request.method === 'POST' && ['/api/login', '/api/setup'].includes(route)) {
          if (!store.allow('login', 15, 15 * 60_000)) throw new ApiError(429, 'Too many attempts. Try again in 15 minutes.');
          const body = await bodyOf(request);
          if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 256) throw new ApiError(400, 'Use a password between 12 and 256 characters.');
          if (busy.has('owner')) throw new ApiError(409, 'Sign-in is in progress.');
          busy.add('owner');
          try {
            if (route === '/api/setup') {
              const setup = store.get('setupHash'); const supplied = digest(typeof body.setupToken === 'string' ? body.setupToken : '');
              if (store.get('passwordHash') || !setup || Number(store.get('setupExpires')) <= Date.now() || !timingSafeEqual(Buffer.from(setup), Buffer.from(supplied))) throw new ApiError(403, 'Setup link expired or already used.');
              store.set('passwordHash', await hashPassword(body.password)); store.deleteSetting('setupHash'); store.deleteSetting('setupExpires');
            } else if (!await verifyPassword(body.password, store.get('passwordHash') ?? '')) throw new ApiError(401, 'Incorrect password.');
            const session = store.createSession(); return send(200, { authenticated: true }, { 'Set-Cookie': cookie(session.token, 30 * 86400) });
          } finally { busy.delete('owner'); }
        }
        if (!authenticated) throw new ApiError(401, 'Sign in to Allowance.');
        if (!store.allow('requests', 600, 60_000)) throw new ApiError(429, 'Too many requests. Retry shortly.');
        if (request.method === 'GET') {
          if (route === '/api/accounts') return send(200, { accounts: store.list().map(publicAccount) });
          if (route === '/api/export') return send(200, { version: 2, accounts: store.list().map(publicAccount).map(a => ({ ...a, connected: false, error: null, pendingReset: null, resetCredits: null })) });
          throw new ApiError(404, 'Not found.');
        }
        const body = await bodyOf(request);
        if (route === '/api/logout') { store.logout(token); return send(200, { authenticated: false }, { 'Set-Cookie': cookie('', 0) }); }
        if (route === '/api/password') {
          if (typeof body.current !== 'string' || body.current.length > 256 || !store.allow('password', 5, 15 * 60_000) || !await verifyPassword(body.current, store.get('passwordHash') ?? '')) throw new ApiError(403, 'Current password did not match.');
          if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 256) throw new ApiError(400, 'Use a password between 12 and 256 characters.');
          store.set('passwordHash', await hashPassword(body.password)); store.db.exec('DELETE FROM sessions');
          const session = store.createSession(); return send(200, { saved: true }, { 'Set-Cookie': cookie(session.token, 30 * 86400) });
        }
        if (route === '/api/accounts') {
          if (!providerId(body.provider) || store.list().length >= 50) throw new ApiError(400, 'Choose a provider; up to 50 accounts are supported.');
          const row = blankAccount(body.provider); store.save(row); return send(201, { account: publicAccount(row) });
        }
        if (route === '/api/import') { const rows = imported(body, store.list().length); store.db.exec('BEGIN'); try { rows.forEach(row => store.save(row)); store.db.exec('COMMIT'); } catch (error) { store.db.exec('ROLLBACK'); throw error; } return send(200, { accounts: store.list().map(publicAccount) }); }
        const match = /^\/api\/accounts\/([^/]+)\/(refresh|connect|poll|code|cancel|key|settings|disconnect|remove|reset)$/.exec(route);
        if (!match || !uuid(match[1])) throw new ApiError(404, 'Account not found.');
        const [, id, action] = match;
        if (busy.has(id)) throw new ApiError(409, 'Account is busy. Retry shortly.');
        busy.add(id);
        try {
          const row = store.account(id); if (!row) throw new ApiError(404, 'Account not found.');
          if (action === 'settings') {
            if (Object.keys(body).some(key => !['billingSchedule', 'businessSeat'].includes(key))) throw new ApiError(400, 'Unknown setting.');
            if ('billingSchedule' in body) {
              if (body.billingSchedule !== null && !isBillingSchedule(body.billingSchedule)) throw new ApiError(400, 'Enter a valid billing date.');
              row.billingSchedule = body.billingSchedule === null ? null : { anchorDate: body.billingSchedule.anchorDate, interval: body.billingSchedule.interval };
            }
            if ('businessSeat' in body) {
              if (row.plan !== 'Business' || ![null, 'Standard', 'Premium'].includes(body.businessSeat as string | null)) throw new ApiError(400, 'Choose a Business seat.');
              row.businessSeat = body.businessSeat as TrackedAccount['businessSeat'];
            }
          } else if (action === 'refresh') {
            if (!row.connected) throw new ApiError(400, 'Connect this account first.');
            if (store.allow(`refresh:${id}`, 1, 30_000)) await refresh(row);
          } else if (action === 'connect') {
            if (!store.allow('connect', 15, 3600_000)) throw new ApiError(429, 'Too many sign-in attempts. Try again later.');
            if (attempts.size >= 3 && !attempts.has(id)) throw new ApiError(409, 'Finish or cancel another sign-in first.');
            await cancel(id); const attempt = await provider.start(row.provider); attempts.set(id, attempt);
            return send(200, { signIn: attempt.info });
          } else if (action === 'cancel') { await cancel(id); }
          else if (action === 'code' || action === 'poll') {
            const attempt = attempts.get(id);
            if (!attempt || attempt.info.expiresAt <= Date.now()) { await cancel(id); throw new ApiError(410, 'Sign-in expired. Start again.'); }
            if (action === 'code') { if (!attempt.info.needsCode || typeof body.code !== 'string') throw new ApiError(400, 'Enter the sign-in code.'); attempt.submit(body.code.trim()); }
            if (attempt.status() === 'failed') { await cancel(id); throw new ApiError(400, 'Sign-in failed. Start again.'); }
            if (attempt.status() !== 'complete') return send(200, { signIn: attempt.info });
            attempt.close(); const snapshot = await provider.usage(row.provider, attempt.profile); const old = row.profile;
            row.profile = attempt.profile; row.secret = null; row.pendingReset = null;
            applySnapshot(row, snapshot); store.save(row); attempts.delete(id);
            if (old) await provider.removeProfile(old);
          } else if (action === 'key') {
            if (row.provider !== 'opencode' || typeof body.key !== 'string' || !body.key.trim() || body.key.length > 4096 || /[\r\n]/.test(body.key)) throw new ApiError(400, 'Enter a valid OpenCode key.');
            const key = body.key.trim(); const snapshot = await provider.usage('opencode', null, key);
            row.secret = store.vault.seal('owner', id, key); applySnapshot(row, snapshot);
          } else if (action === 'reset') {
            if (row.provider !== 'codex' || !row.profile || !row.connected || body.confirm !== true || !uuid(body.requestId)) throw new ApiError(400, 'Confirm a reset for a connected Codex account.');
            const previous = store.reset(body.requestId);
            if (previous && previous.account_id !== id) throw new ApiError(409, 'Reset belongs to a different account.');
            if (previous?.outcome) {
              if (row.pendingReset === body.requestId) { row.pendingReset = null; store.save(row); await refresh(row); }
              return send(200, { outcome: previous.outcome, account: publicAccount(row) });
            }
            if (row.pendingReset && row.pendingReset !== body.requestId) throw new ApiError(409, 'A reset is awaiting confirmation. Retry the pending reset.');
            if (!row.pendingReset && !row.resetCredits?.count) throw new ApiError(400, 'No reset credits reported. Refresh usage first.');
            store.startReset(body.requestId, id); row.pendingReset = body.requestId; store.save(row);
            let outcome;
            try { outcome = await provider.reset(row.profile, body.requestId); }
            catch { throw new ApiError(502, 'Reset result is unknown. Retry this reset to check it without spending twice.'); }
            store.finishReset(body.requestId, outcome); row.pendingReset = null; store.save(row); await refresh(row);
            return send(200, { outcome, account: publicAccount(row) });
          } else if (action === 'disconnect' || action === 'remove') {
            await cancel(id); if (row.profile) await provider.removeProfile(row.profile);
            row.connected = false; row.profile = null; row.secret = null; row.pendingReset = null; row.resetCredits = null; row.error = null;
            if (action === 'remove') { store.remove(id); return send(200, { removed: id }); }
          }
          store.save(row); return send(200, { account: publicAccount(row) });
        } finally { busy.delete(id); }
      } catch (error) { return send(error instanceof ApiError ? error.status : 502, { error: error instanceof ApiError ? error.message : 'Provider connection failed. Retry or reconnect.' }); }
    },
  };
}
