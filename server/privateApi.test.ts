import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrivateStore, digest } from './privateStore';
import { blankAccount, createPrivateApi } from './privateApi';
import type { ProviderService } from './cliProvider';
import type { Snapshot } from '../src/domain/private';

const origin = 'https://allowance.example.com';
const snapshot: Snapshot = { email: 'owner@example.com', identity: 'owner:org', plan: 'Business', windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 16, resetsAt: null }], resetCredits: { count: 1, expiresAt: null } };
let directory: string; let store: PrivateStore; let api: ReturnType<typeof createPrivateApi>; let cookie: string;
let provider: ProviderService;
const request = (route: string, body?: unknown, headers: Record<string, string> = {}) => api.handle(new Request(origin + '/api/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'allowance-api-test-')); store = new PrivateStore(directory);
  provider = { usage: vi.fn(async () => structuredClone(snapshot)), reset: vi.fn(async () => 'reset' as const), removeProfile: vi.fn(async () => {}), start: vi.fn(async () => ({ profile: randomUUID(), info: { url: 'https://auth.openai.com/codex/device', code: 'test', needsCode: false, expiresAt: Date.now() + 60_000 }, status: () => 'complete' as const, submit: () => {}, close: () => {} })) };
  api = createPrivateApi(store, provider, origin); cookie = `__Host-allowance=${store.createSession().token}`;
});
afterEach(async () => { await api.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
function connected() { const row = blankAccount('codex'); Object.assign(row, snapshot, { profile: randomUUID(), connected: true, checkedAt: '2026-01-01T00:00:00.000Z', billingSchedule: { anchorDate: '2026-01-31', interval: 'monthly' } }); store.save(row); return row; }
describe('private account API', () => {
  it('denies unauthenticated data and cross-origin writes', async () => {
    expect((await request('accounts', undefined, { cookie: '' })).status).toBe(401);
    expect((await request('accounts', { provider: 'codex' }, { origin: 'https://attacker.example' })).status).toBe(403);
    expect((await api.handle(new Request('https://attacker.example/api/session'))).status).toBe(421);
  });
  it('requires a one-time setup secret, issues a persistent secure cookie, and revokes logout', async () => {
    cookie = ''; store.set('setupHash', digest('setup-secret')); store.set('setupExpires', String(Date.now() + 60_000));
    expect((await request('setup', { password: 'long-test-password', setupToken: 'wrong' })).status).toBe(403);
    const response = await request('setup', { password: 'long-test-password', setupToken: 'setup-secret' });
    expect(response.status).toBe(200); const setCookie = response.headers.get('set-cookie')!;
    expect(setCookie).toContain('HttpOnly'); expect(setCookie).toContain('SameSite=Strict'); expect(setCookie).toContain('Secure'); expect(setCookie).toContain('Max-Age=2592000');
    cookie = setCookie.split(';')[0]; expect((await request('accounts')).status).toBe(200);
    expect((await request('setup', { password: 'long-test-password', setupToken: 'setup-secret' })).status).toBe(403);
    await request('logout', {}); expect((await request('accounts')).status).toBe(401);
    expect((await request('login', { password: 'long-test-password' })).status).toBe(200);
  });
  it('keeps sessions and accounts across restarts, without returning provider secrets', async () => {
    const row = connected(); row.secret = store.vault.seal('owner', row.id, 'private-key'); store.save(row);
    await api.close(); store.close(); store = new PrivateStore(directory); api = createPrivateApi(store, provider, origin);
    const response = await request('accounts'); expect(response.status).toBe(200); const text = await response.text();
    expect(text).toContain('owner@example.com'); expect(text).not.toContain('private-key'); expect(text).not.toContain('profile'); expect(text).not.toContain('secret');
  });
  it('retains last successful data and its timestamp when refresh fails', async () => {
    const row = connected(); vi.mocked(provider.usage).mockRejectedValue(new Error('sensitive raw provider error'));
    const response = await request(`accounts/${row.id}/refresh`, {}); const body = await response.json();
    expect(body.account.checkedAt).toBe(row.checkedAt); expect(body.account.windows).toEqual(row.windows);
    expect(body.account.error).toContain('could not refresh'); expect(JSON.stringify(body)).not.toContain('sensitive');
  });
  it('requires reset confirmation and deduplicates successful retries', async () => {
    const row = connected(); const requestId = randomUUID();
    expect((await request(`accounts/${row.id}/reset`, { requestId })).status).toBe(400);
    expect(provider.reset).not.toHaveBeenCalled();
    const body = { requestId, confirm: true };
    expect((await request(`accounts/${row.id}/reset`, body)).status).toBe(200);
    expect((await request(`accounts/${row.id}/reset`, body)).status).toBe(200);
    expect(provider.reset).toHaveBeenCalledTimes(1); expect(provider.usage).toHaveBeenCalledTimes(1);
  });
  it('retains the reset key through a timeout and restart', async () => {
    const row = connected(); const requestId = randomUUID(); const body = { requestId, confirm: true };
    vi.mocked(provider.reset).mockRejectedValueOnce(new Error('timeout'));
    expect((await request(`accounts/${row.id}/reset`, body)).status).toBe(502);
    expect(store.account(row.id)?.pendingReset).toBe(requestId);
    await api.close(); store.close(); store = new PrivateStore(directory); api = createPrivateApi(store, provider, origin);
    expect((await request(`accounts/${row.id}/reset`, { requestId: randomUUID(), confirm: true })).status).toBe(409);
    expect((await request(`accounts/${row.id}/reset`, body)).status).toBe(200);
    expect(vi.mocked(provider.reset).mock.calls.map(call => call[1])).toEqual([requestId, requestId]);
  });
  it('keeps the previous profile during an unfinished reconnect and clears dates for a different identity', async () => {
    const row = connected(); await request(`accounts/${row.id}/connect`, {});
    expect(store.account(row.id)?.profile).toBe(row.profile);
    vi.mocked(provider.usage).mockResolvedValue({ ...snapshot, email: 'different@example.com', identity: 'different' });
    await request(`accounts/${row.id}/poll`, {});
    expect(store.account(row.id)?.billingSchedule).toBeNull(); expect(store.account(row.id)?.profile).not.toBe(row.profile);
    expect(provider.removeProfile).toHaveBeenCalledWith(row.profile);
  });
  it('imports accounts without credentials, ignores supplied profile paths, and validates dates', async () => {
    const row = connected();
    const response = await request('import', { version: 2, accounts: [{ ...row, profile: '/etc/passwd', secret: 'secret' }] });
    expect(response.status).toBe(200); const imported = store.list().find(a => a.id !== row.id)!;
    expect(imported.profile).toBeNull(); expect(imported.secret).toBeNull(); expect(imported.connected).toBe(false);
    expect((await request(`accounts/${row.id}/settings`, { billingSchedule: { anchorDate: '2026-02-31', interval: 'monthly' } })).status).toBe(400);
  });
});
