import { useEffect, useRef, useState } from "react";
import { BillingPanel } from "./BillingPanel";
import { BillingConnectionError, closeBillingBrowser, openBillingBrowser, readBillingBrowser, type BillingConnection } from "../domain/billingClient";
import { createProviderAccount } from "../domain/applyLogin";
import { hostedAccounts, type HostedAccount } from "../domain/hosted";
import type { Workspace } from "../domain/types";

async function api(path: string, body?: unknown) {
  const response = await fetch(path, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), cache: "no-store" });
  const value: unknown = await response.json().catch(() => null);
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!response.ok || !record) throw new BillingConnectionError(typeof record?.error === "string" ? record.error : "The request failed.", response.status === 401, response.status);
  return record;
}
interface Pending extends BillingConnection { account: HostedAccount; stage: "login" | "reading" }

export default function HostedApp() {
  const [accounts, setAccounts] = useState<HostedAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const queue = useRef<HostedAccount[]>([]);
  const operation = useRef(0);
  const running = useRef(false);
  const opening = useRef<Promise<BillingConnection> | null>(null);
  const [errors, setErrors] = useState<Record<string, { at: string; message: string }>>({});

  async function reload() { const result = await api("/api/accounts"); setAccounts(hostedAccounts(result.accounts)); }
  useEffect(() => { let current = true; void api("/api/accounts").then((value) => { if (current) setAccounts(hostedAccounts(value.accounts)); }).catch((error: unknown) => { if (current && error instanceof Error && !(error instanceof BillingConnectionError && error.status === 401)) setNotice(error.message); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, []);
  useEffect(() => () => { operation.current++; const current = pendingRef.current; pendingRef.current = null; if (current) void closeBillingBrowser(current.connectionId).catch(() => undefined); }, []);

  function sessionExpired(error: unknown) {
    if (!(error instanceof BillingConnectionError) || error.status !== 401) return false;
    operation.current++; queue.current = []; running.current = false; pendingRef.current = null;
    setPending(null); setStarting(null); setBusy(false); setAccounts(null); setNotice("Your session expired. Sign in again.");
    return true;
  }

  function failed(account: HostedAccount, error: unknown) {
    setErrors((current) => ({ ...current, [account.id]: { at: new Date().toISOString(), message: error instanceof Error ? error.message : "Billing could not be fetched." } }));
  }
  async function runNext(version: number) {
    if (operation.current !== version) return;
    const account = queue.current.shift();
    if (!account) { running.current = false; setBusy(false); return; }
    setStarting(account.id);
    setErrors((current) => { const next = { ...current }; delete next[account.id]; return next; });
    try {
      const task = openBillingBrowser({ accountId: account.accountId, email: account.email, workspace: account.workspace });
      opening.current = task;
      const connection = await task.finally(() => { if (opening.current === task) opening.current = null; });
      if (operation.current !== version) { await closeBillingBrowser(connection.connectionId).catch(() => undefined); return; }
      const next: Pending = { ...connection, account, stage: "login" };
      pendingRef.current = next; setPending(next); setStarting(null);
      await finish(next, version);
    } catch (error) { if (operation.current !== version || sessionExpired(error)) return; failed(account, error); setStarting(null); await runNext(version); }
  }
  async function finish(current = pendingRef.current, version = operation.current) {
    if (!current || current.stage !== "login") return;
    current.stage = "reading"; setPending({ ...current });
    try {
      const details = await readBillingBrowser(current.connectionId);
      if (pendingRef.current !== current || operation.current !== version) return;
      if (details.accountId !== current.account.accountId || details.email.toLowerCase() !== current.account.email.toLowerCase()) throw new Error("Billing belongs to another account and was discarded.");
      pendingRef.current = null; setPending(null);
      setErrors((errors) => { const next = { ...errors }; delete next[current.account.id]; return next; });
      try { await reload(); }
      catch (error) { if (!sessionExpired(error)) { setNotice("Billing was saved, but the updated list could not load. Reload the page."); queue.current = []; running.current = false; setBusy(false); } return; }
      await runNext(version);
    } catch (error) {
      if (pendingRef.current !== current || operation.current !== version || sessionExpired(error)) return;
      failed(current.account, error);
      if (error instanceof BillingConnectionError && error.ended) { pendingRef.current = null; setPending(null); await closeBillingBrowser(current.connectionId).catch(() => undefined); await runNext(version); }
      else { current.stage = "login"; setPending({ ...current }); }
    }
  }
  async function cancel() {
    operation.current++;
    queue.current = [];
    const current = pendingRef.current; pendingRef.current = null; setPending(null); setStarting(null);
    const launching = opening.current;
    try { if (current) await closeBillingBrowser(current.connectionId); else if (launching) { const late = await launching; await closeBillingBrowser(late.connectionId); } }
    catch { setNotice("The browser could not be closed. It will expire automatically."); }
    running.current = false; setBusy(false);
  }
  function start(selected: HostedAccount[]) {
    if (running.current || busy) return;
    running.current = true; queue.current = [...selected]; setBusy(true); setNotice(""); void runNext(++operation.current);
  }

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      const current = pendingRef.current;
      if (!current || current.connectionId !== pending.connectionId) return;
      failed(current.account, new Error("The sign-in window expired. Fetch billing to open a new one."));
      void cancel();
    }, Math.max(0, pending.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (loading) return <main className="wrap"><p role="status">Loading Allowance…</p></main>;
  if (!accounts) return <main className="wrap owner-login"><h1>Allowance</h1><p>Sign in to view your accounts and billing.</p><form onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setNotice("");
    void api("/api/owner/login", { password }).then(async () => { setPassword(""); await reload(); }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Sign-in failed.")).finally(() => setBusy(false));
  }}><label htmlFor="owner-password">Password</label><input id="owner-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form>{notice && <p className="error" role="alert">{notice}</p>}</main>;

  return <div className="wrap"><header className="top"><h1>Allowance</h1><div className="top-actions"><button disabled={busy} onClick={() => void api("/api/owner/logout", {}).then(() => { setAccounts(null); setNotice(""); }).catch(() => setNotice("Sign-out failed. Retry."))}>Sign out</button></div></header>
    <main><section className="ledger" aria-labelledby="billing-heading"><div className="ledger-head"><h2 id="billing-heading">Billing</h2><button disabled={busy || accounts.length === 0} onClick={() => start(accounts)}>Fetch all billing</button></div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {accounts.length === 0 && <p className="empty">Import your account export from the local app to connect billing. Provider passwords and usage tokens are not imported.</p>}
      {accounts.map((account) => {
        const subscription = { ...createProviderAccount("chatgpt", account.id, new Date()), login: account.email, plan: account.plan, providerAccountId: account.accountId, accountRole: account.role, browserDetails: account.details, billingError: errors[account.id] ?? account.billingError };
        const workspace: Workspace | null = account.workspace ? { id: account.accountId, name: account.workspaceName || "Workspace", provider: "chatgpt", role: account.role, members: [], seats: [], billing: null } : null;
        const active = pending?.account.id === account.id ? pending : null;
        return <article className="card" key={account.id} aria-label={`ChatGPT ${account.plan}`}><div className="card-id"><h3>ChatGPT <span className="account-plan">{account.plan}</span></h3><p className="account-login">{account.email}</p></div><div className="card-body"><BillingPanel subscription={subscription} workspace={workspace} collapseDetails busy={busy} stage={starting === account.id ? "starting" : active?.stage} mode={active?.mode} loginUrl={active?.loginUrl} expiresAt={active?.expiresAt} onStart={() => start([account])} onRead={() => void finish()} onCancel={() => void cancel()} /></div></article>;
      })}
    </section><details className="data-tools"><summary>Import accounts</summary><p className="hint">Adds missing ChatGPT accounts from an Allowance export. Existing records are kept.</p><label className="file">Choose export<input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      if (file.size > 2_000_000) { setNotice("Choose an export smaller than 2 MB."); return; }
      setBusy(true);
      void file.text().then((text) => api("/api/accounts/import", JSON.parse(text))).then((value) => { setAccounts(hostedAccounts(value.accounts)); setNotice("Accounts imported."); }).catch((error: unknown) => { if (!sessionExpired(error)) setNotice("The export could not be imported. Existing accounts were kept."); }).finally(() => setBusy(false));
    }} /></label></details></main><footer><p>Billing is checked on demand. Saved records remain available between checks.</p></footer></div>;
}
