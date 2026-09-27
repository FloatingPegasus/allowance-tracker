import { useEffect, useRef, useState } from 'react';
import { BillingDate } from './components/BillingDate';
import type { Provider, SignIn, TrackedAccount } from './domain/private';
import { checkedAgo } from './domain/usageStatus';
import { meterTone, remainingLabel, remainingPercent } from './domain/format';
import { countdown, resetStamp } from './domain/time';

const names: Record<Provider, string> = { codex: 'Codex', claude: 'Claude', opencode: 'OpenCode' };
interface Reply { authenticated?: boolean; account?: TrackedAccount; accounts?: TrackedAccount[]; removed?: string; signIn?: SignIn; outcome?: string; error?: string }
class RequestError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
async function api(path: string, body?: unknown): Promise<Reply> {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json() as Reply;
  if (!response.ok) throw new RequestError(data.error || 'Request failed. Try again.', response.status);
  return data;
}

export default function PrivateApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<TrackedAccount[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const active = useRef(new Set<string>());
  const [pending, setPending] = useState<Record<string, SignIn>>({});
  const pendingRef = useRef(pending);
  const accountsRef = useRef(accounts);
  useEffect(() => { pendingRef.current = pending; accountsRef.current = accounts; }, [pending, accounts]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [setupToken, setSetupToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('setup'));
  const [legacy] = useState(() => { try { return localStorage.getItem('allowance-tracker/v1'); } catch { return null; } });
  const [legacyImported, setLegacyImported] = useState(false);
  const actions = useRef<(id: string, action: string, body?: unknown) => Promise<void>>(async () => {});

  function fail(error: unknown, id?: string) {
    if (error instanceof RequestError && error.status === 401) { setAuthenticated(false); setAccounts([]); setPending({}); }
    const message = error instanceof Error ? error.message : 'Request failed. Try again.';
    if (id) setErrors(current => ({ ...current, [id]: message })); else setNotice(message);
  }
  function receive(reply: Reply) {
    if (reply.accounts) setAccounts(reply.accounts);
    if (reply.account) setAccounts(current => current.some(a => a.id === reply.account!.id) ? current.map(a => a.id === reply.account!.id ? reply.account! : a) : [...current, reply.account!]);
    if (reply.removed) setAccounts(current => current.filter(a => a.id !== reply.removed));
  }
  async function action(id: string, verb: string, body: unknown = {}) {
    if (active.current.has(id)) {
      if (!['poll', 'refresh'].includes(verb)) setErrors(current => ({ ...current, [id]: 'Wait for the current check, then try again.' }));
      return;
    }
    active.current.add(id); setBusy(current => ({ ...current, [id]: true }));
    if (verb !== 'poll') setErrors(current => ({ ...current, [id]: '' }));
    try {
      const reply = await api(`accounts/${id}/${verb}`, body); receive(reply);
      if (reply.signIn) setPending(current => ({ ...current, [id]: reply.signIn! }));
      else if (['poll', 'cancel', 'disconnect', 'remove', 'code'].includes(verb)) setPending(current => { const next = { ...current }; delete next[id]; return next; });
      if (reply.outcome) setNotice(({ reset: 'Reset used.', alreadyRedeemed: 'Reset already applied.', nothingToReset: 'No eligible usage window to reset.', noCredit: 'No reset credits available.' } as Record<string, string>)[reply.outcome] || reply.outcome);
    } catch (error) {
      fail(error, id);
      if (verb === 'reset') { try { receive(await api('accounts')); } catch { /* Keep the reset error visible. */ } }
      if ((verb === 'poll' || verb === 'code') && error instanceof RequestError && [400, 410].includes(error.status)) setPending(current => { const next = { ...current }; delete next[id]; return next; });
    } finally { active.current.delete(id); setBusy(current => ({ ...current, [id]: false })); }
  }
  useEffect(() => { actions.current = action; });
  useEffect(() => {
    if (window.location.hash) window.history.replaceState({}, '', window.location.pathname);
    let disposed = false;
    void api('session').then(result => { if (!disposed) setAuthenticated(result.authenticated === true); }).catch(error => { if (!disposed) { setAuthenticated(false); fail(error); } });
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { disposed = true; window.clearInterval(tick); };
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    let disposed = false;
    void api('accounts').then(reply => {
      if (disposed) return; receive(reply);
      for (const account of reply.accounts || []) if (account.connected && (!account.checkedAt || Date.now() - Date.parse(account.checkedAt) > 5 * 60_000)) void actions.current(account.id, 'refresh');
    }).catch(error => { if (!disposed) fail(error); });
    const refresh = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      for (const account of accountsRef.current) if (account.connected && !pendingRef.current[account.id]) void actions.current(account.id, 'refresh');
    }, 5 * 60_000);
    const poll = window.setInterval(() => { for (const id of Object.keys(pendingRef.current)) void actions.current(id, 'poll'); }, 3000);
    return () => { disposed = true; window.clearInterval(refresh); window.clearInterval(poll); };
  }, [authenticated]);
  async function add(provider: Provider) {
    if (active.current.has('add')) return;
    active.current.add('add'); setBusy(current => ({ ...current, add: true }));
    try { const reply = await api('accounts', { provider }); receive(reply); if (provider !== 'opencode' && reply.account) await action(reply.account.id, 'connect'); }
    catch (error) { fail(error); }
    finally { active.current.delete('add'); setBusy(current => ({ ...current, add: false })); }
  }
  async function importAccounts(raw: string) {
    try { const reply = await api('import', JSON.parse(raw)); receive(reply); setNotice('Accounts imported. Reconnect them to refresh usage.'); }
    catch (error) { fail(error); }
  }
  async function exportAccounts() {
    try {
      const data = await api('export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'allowance-accounts.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { fail(error); }
  }
  if (authenticated === null) return <main className="login-shell"><p className="hint">Loading…</p></main>;
  if (!authenticated) return <SignInPage setupToken={setupToken} notice={notice} onSuccess={() => { setSetupToken(null); setNotice(''); setAuthenticated(true); }} />;
  return <main className="wrap">
    <header className="top"><h1>Allowance</h1><button type="button" onClick={() => void api('logout', {}).then(() => { setAuthenticated(false); setAccounts([]); setPending({}); }).catch(fail)}>Sign out</button></header>
    {notice && <div className="notice" role="status">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
    <section className="ledger" aria-labelledby="accounts-title">
      <div className="ledger-head"><h2 id="accounts-title">Your accounts</h2><button type="button" disabled={accounts.every(a => !a.connected || busy[a.id])} onClick={() => { for (const account of accounts) if (account.connected && !pending[account.id]) void action(account.id, 'refresh'); }}>Refresh all</button></div>
      {!accounts.length && <p className="empty">Connect an account to track its allowance.</p>}
      {accounts.map(account => <PrivateCard key={account.id} account={account} now={now} busy={busy[account.id] || false} error={errors[account.id] || account.error} pending={pending[account.id]} onAction={(verb, body) => void action(account.id, verb, body)} />)}
    </section>
    <details className="add-account" open={!accounts.length || undefined}><summary>Add account</summary><div className="provider-choices">{(['codex', 'claude', 'opencode'] as Provider[]).map(provider => <button key={provider} type="button" disabled={busy.add} onClick={() => void add(provider)}>{names[provider]}</button>)}</div></details>
    <details className="app-settings"><summary>Settings</summary><div className="top-actions">
      <button type="button" onClick={() => void exportAccounts()}>Export accounts</button>
      <label className="file">Import accounts<input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) { if (file.size > 1_000_000) setNotice('File is too large.'); else void file.text().then(importAccounts); } event.target.value = ''; }} /></label>
      {legacy && !legacyImported && <button type="button" onClick={() => { void importAccounts(legacy); setLegacyImported(true); }}>Import saved browser accounts</button>}
    </div><PasswordChange onError={fail} onSaved={() => setNotice('Password updated. Other browsers have been signed out.')} /></details>
  </main>;
}

function SignInPage({ setupToken, notice, onSuccess }: { setupToken: string | null; notice: string; onSuccess: () => void }) {
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <main className="login-shell"><h1>Allowance</h1><form onSubmit={event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    void api(setupToken ? 'setup' : 'login', { password, ...(setupToken ? { setupToken } : {}) }).then(() => { setPassword(''); onSuccess(); }).catch(error => setError(error instanceof Error ? error.message : 'Sign-in failed.')).finally(() => setBusy(false));
  }}><label htmlFor="owner-password">{setupToken ? 'Create your password' : 'Password'}</label><input id="owner-password" type="password" autoComplete={setupToken ? 'new-password' : 'current-password'} minLength={12} maxLength={256} required value={password} onChange={event => setPassword(event.target.value)} autoFocus /><button type="submit" className="solid" disabled={busy}>{busy ? 'Signing in…' : setupToken ? 'Save password' : 'Sign in'}</button>{(error || notice) && <p className="error" role="alert">{error || notice}</p>}</form></main>;
}
function PrivateCard({ account: a, now, busy, error, pending, onAction }: { account: TrackedAccount; now: Date; busy: boolean; error: string | null; pending?: SignIn; onAction: (verb: string, body?: unknown) => void }) {
  const [secret, setSecret] = useState(''); const [code, setCode] = useState(''); const [remove, setRemove] = useState(false); const [reset, setReset] = useState(false);
  const resetId = useRef<string | null>(null);
  const stale = !a.connected || !!error || !a.checkedAt || now.getTime() - Date.parse(a.checkedAt) > 10 * 60_000;
  return <article className="card" aria-label={`${names[a.provider]} ${a.email || 'account'}`}>
    <div className="card-id"><h3><i className={`mark mark-${a.provider}`} aria-hidden="true" />{names[a.provider]}<span className="account-plan">{a.plan}</span></h3>
      {a.email && <p className="account-login">{a.email}</p>}
      {a.businessSeat && <p className="hint">{a.businessSeat} seat · Manual</p>}
      <p className={`sync-status ${a.connected && !stale ? 'synced' : ''}`}>{pending ? 'Waiting for sign-in' : a.connected ? busy ? 'Checking…' : stale ? 'Last saved usage' : 'Connected' : 'Disconnected'}</p>
      <div className="card-actions">
        {a.connected && <button type="button" disabled={busy || !!pending} onClick={() => onAction('refresh')}>Refresh usage</button>}
        {a.provider !== 'opencode' && !pending && <button type="button" disabled={busy} onClick={() => onAction('connect')}>{a.connected ? 'Reconnect' : 'Connect'}</button>}
      </div>
      {a.provider === 'opencode' && !a.connected && <form className="key-row" onSubmit={event => { event.preventDefault(); onAction('key', { key: secret }); setSecret(''); }}><label>OpenCode key<input type="password" autoComplete="off" required value={secret} onChange={event => setSecret(event.target.value)} /></label><button type="submit" disabled={busy || !secret.trim()}>Connect</button></form>}
      {pending && <div className="sign-in-prompt"><a href={pending.url} target="_blank" rel="noopener noreferrer">Sign in to {names[a.provider]} ↗</a>{pending.code && <p className="device-code">{pending.code}</p>}
        {pending.needsCode && <form className="key-row" onSubmit={event => { event.preventDefault(); onAction('code', { code }); setCode(''); }}><label>Code from Claude<input autoComplete="off" value={code} onChange={event => setCode(event.target.value)} required /></label><button type="submit" disabled={busy || !code.trim()}>Complete sign-in</button></form>}
        <button type="button" className="text-button" disabled={busy} onClick={() => onAction('cancel')}>Cancel sign-in</button>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
    <div className="card-body"><p className="usage-heading">Remaining allowance</p><div className="meters">
      {a.windows.length ? a.windows.map((w, index) => <div className="meter" key={`${w.id}:${index}`}><span className="meter-label">{w.label}</span><span className="num meter-value">{remainingLabel(w.usedPercent)}</span><div className={`bar ${meterTone(w.usedPercent)}`} role="meter" aria-label={`${w.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remainingPercent(w.usedPercent)}><span style={{ width: `${remainingPercent(w.usedPercent)}%` }} /></div><span className="num meter-when">{w.resetsAt ? `Resets ${resetStamp(w.resetsAt, now)}` : 'Reset not reported'}</span>{w.resetsAt && countdown(w.resetsAt, now) === 'due' && <span className="due">Reset due · Refresh usage</span>}</div>) : <p className="empty">No saved usage</p>}
    </div>{a.checkedAt && <p className="hint"><time dateTime={a.checkedAt} title={new Date(a.checkedAt).toLocaleString()}>{checkedAgo(a.checkedAt, now)}</time></p>}
      {a.provider === 'codex' && a.connected && (a.resetCredits !== null || a.pendingReset) && <div className="reset-row"><span>{a.resetCredits ? `${a.resetCredits.count} reset${a.resetCredits.count === 1 ? '' : 's'} available` : 'Reset pending'}</span>{a.resetCredits?.expiresAt && a.resetCredits.count > 0 && <span className="hint">Next expires {new Date(a.resetCredits.expiresAt).toLocaleDateString()}</span>}
        {reset ? <div className="card-actions"><span>Use one reset for this account?</span><button type="button" disabled={busy} onClick={() => { resetId.current ||= a.pendingReset || crypto.randomUUID(); onAction('reset', { confirm: true, requestId: resetId.current }); setReset(false); }}>Confirm reset</button><button type="button" onClick={() => setReset(false)}>Cancel</button></div> : <button type="button" disabled={busy || !!pending || !a.pendingReset && !a.resetCredits?.count} onClick={() => { resetId.current = a.pendingReset || crypto.randomUUID(); setReset(true); }}>{a.pendingReset ? 'Retry reset' : 'Use reset'}</button>}
      </div>}
    </div>
    <fieldset disabled={busy} className="billing-control"><BillingDate schedule={a.billingSchedule} now={now} onChange={billingSchedule => onAction('settings', { billingSchedule })} /></fieldset>
    <details className="account-details"><summary>Account details</summary>
      {a.plan === 'Business' && <label className="seat-choice">Business seat (manual)<select disabled={busy} value={a.businessSeat || ''} onChange={event => onAction('settings', { businessSeat: event.target.value || null })}><option value="">Not set</option><option>Standard</option><option>Premium</option></select></label>}
      <div className="card-actions">{a.connected && <button type="button" disabled={busy} onClick={() => onAction('disconnect')}>Disconnect</button>}{remove ? <><span>Remove this account and its saved readings?</span><button type="button" className="danger" disabled={busy} onClick={() => onAction('remove')}>Confirm remove</button><button type="button" onClick={() => setRemove(false)}>Keep account</button></> : <button type="button" onClick={() => setRemove(true)}>Remove account</button>}</div>
    </details>
  </article>;
}
function PasswordChange({ onError, onSaved }: { onError: (error: unknown) => void; onSaved: () => void }) {
  const [current, setCurrent] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  return <details className="password-settings"><summary>Change password</summary><form className="key-row" onSubmit={event => {
    event.preventDefault(); setBusy(true); void api('password', { current, password }).then(() => { setCurrent(''); setPassword(''); onSaved(); }).catch(onError).finally(() => setBusy(false));
  }}><label>Current password<input type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} required /></label><label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} required /></label><button type="submit" disabled={busy}>Save password</button></form></details>;
}
