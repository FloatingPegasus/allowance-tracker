import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { isBrowserDetails, type BrowserTarget } from "../domain/browserSync";

export interface BrowserConnectionHandle { syncAccount: (target: BrowserTarget) => void }
interface Props { ref: Ref<BrowserConnectionHandle>; enabled: boolean; accounts: BrowserTarget[]; onEnabled: (enabled: boolean) => void; onResult: (value: unknown) => void; onFailure: (target: BrowserTarget, message: string) => void; onBusy: (busy: boolean) => void }
export function BrowserConnection({ ref, enabled, accounts, onEnabled, onResult, onFailure, onBusy }: Props) {
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("");
  const current = useRef({ accounts, onResult, onEnabled, onFailure, onBusy });
  const pending = useRef<{ id: string; accounts: BrowserTarget[] } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { current.current = { accounts, onResult, onEnabled, onFailure, onBusy }; });
  useImperativeHandle(ref, () => ({ syncAccount: (target) => sync([target]) }));

  function setWorking(value: boolean) { setBusy(value); current.current.onBusy(value); }
  function fail(targets: BrowserTarget[], message: string) {
    for (const target of targets) current.current.onFailure(target, message);
    setStatus(message);
  }
  function sync(targets = current.current.accounts) {
    const selected = targets.filter((target) => current.current.accounts.some((account) => account.accountId === target.accountId && account.email === target.email));
    if (!selected.length) { setWorking(false); return; }
    if (pending.current) return;
    const id = crypto.randomUUID();
    pending.current = { id, accounts: selected };
    setWorking(true);
    setStatus("Connecting to Chrome…");
    window.postMessage({ type: "allowance:browser-request", requestId: id, accounts: selected }, window.location.origin);
    timeout.current = setTimeout(() => {
      pending.current = null; setWorking(false);
      setConnected(false);
      current.current.onEnabled(false);
      fail(selected, "Extension not detected. Install it, reload Allowance, and retry.");
    }, 3000);
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      const request = pending.current;
      if (event.source !== window || event.origin !== window.location.origin || !request || event.data?.requestId !== request.id) return;
      if (event.data.type === "allowance:browser-ready") {
        setConnected(true);
        clearTimeout(timeout.current);
        setStatus("Reading account details from ChatGPT…");
        timeout.current = setTimeout(() => { pending.current = null; setWorking(false); fail(request.accounts, "Billing check timed out. Keep ChatGPT open and retry."); }, 60000);
        return;
      }
      if (event.data.type !== "allowance:browser-result") return;
      clearTimeout(timeout.current);
      pending.current = null; setWorking(false);
      if (!Array.isArray(event.data.results)) { fail(request.accounts, "Sync failed. Reload ChatGPT and Allowance, then retry."); return; }
      let failed = 0;
      for (const account of request.accounts) {
        const matches = event.data.results.filter((value: unknown) => value && typeof value === "object" && "accountId" in value && "email" in value && account.accountId === value.accountId && account.email.toLowerCase() === String(value.email).toLowerCase());
        const value = matches.length === 1 ? matches[0] : null;
        if (isBrowserDetails(value)) current.current.onResult(value);
        else {
          failed++;
          current.current.onFailure(account, typeof value?.error === "string" ? value.error.slice(0, 500) : "Account details could not be read. Saved billing was kept.");
        }
      }
      setStatus(failed ? "Check the account entries below for sync errors." : "Sync complete. Check each account for missing sections.");
    }
    window.addEventListener("message", receive);
    return () => { window.removeEventListener("message", receive); clearTimeout(timeout.current); };
  }, []);

  const accountKey = accounts.map((account) => `${account.accountId}:${account.email}`).join("|");
  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => sync(), 0);
    const timer = setInterval(() => sync(), 5 * 60_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [enabled, accountKey]);

  return <section className="browser-connection" aria-label="Billing sync">
    <div className="org-head"><h2>Billing sync</h2><span className="hint">{busy ? "Checking…" : !enabled ? "Automatic sync off" : connected ? "Every 5 minutes while open" : "Connection required"}</span></div>
    <p className="hint">The optional Chrome extension reads billing, invoices, members, and seats from your signed-in ChatGPT tab.</p>
    <p className="hint">Unofficial integration. OpenAI’s <a href="https://openai.com/policies/row-terms-of-use/" target="_blank" rel="noreferrer">terms restrict automated extraction</a>; account safety is not guaranteed.</p>
    <div className="management-actions"><button type="button" disabled={busy || !accounts.length} onClick={() => enabled ? sync() : onEnabled(true)}>{busy ? "Syncing…" : enabled ? "Sync now" : "Enable billing sync"}</button>{enabled && <button type="button" onClick={() => { pending.current = null; clearTimeout(timeout.current); onEnabled(false); setWorking(false); setStatus("Billing sync paused."); }}>Pause sync</button>}</div>
    {!accounts.length && <p className="hint">Connect a ChatGPT account first.</p>}
    {status && <p className="hint" role="status">{status}</p>}
    <details className="plan-notes"><summary>Extension setup & access</summary><ol><li>Open Chrome’s Extensions page and enable Developer mode.</li><li>Choose Load unpacked and select this project’s <code>extension</code> folder.</li><li>Reload Allowance, keep ChatGPT signed in, and enable billing sync.</li></ol><p>Credentials stay inside ChatGPT. The extension only reads account details. Switch ChatGPT logins to sync another account; saved records remain here.</p></details>
  </section>;
}
