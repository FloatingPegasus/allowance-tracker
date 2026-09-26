import { useEffect, useRef, useState } from "react";
import { AddAccount } from "./components/AddAccount";
import { AccountCard } from "./components/AccountCard";
import { BillingConnectionError, closeBillingBrowser, openBillingBrowser, readBillingBrowser } from "./domain/billingClient";
import { applyBillingFailure, applyBillingRecord, type BillingTarget } from "./domain/billingRecords";
import { beginLogin, clearPending, fetchLiveAccount, finishLogin, loadPending, matchesCallback, refreshLogin } from "./domain/appLoginClient";
import { applyLiveAccount, applyGoReading, createProviderAccount } from "./domain/applyLogin";
import type { ConnectProvider } from "./domain/applyLogin";
import { loadKeys, saveKeys } from "./domain/keys";
import { mapSubscription } from "./domain/mutate";
import { attachKnownPlans } from "./domain/org";
import { fetchGoUsage, maskKey } from "./domain/opencode";
import { loadSessions, saveSessions } from "./domain/sessions";
import type { AppLogin, AppLoginProvider } from "./domain/sessions";
import { loadState, parseState, saveState, storageProblem } from "./domain/storage";
import type { AppState, ProviderId, Subscription } from "./domain/types";

interface BillingRequest { subscriptionId: string; target: BillingTarget; connectionId: string | null; mode?: "local" | "cloud"; loginUrl?: string; expiresAt?: number; stage: "starting" | "login" | "reading" }

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [storageError, setStorageError] = useState(storageProblem);
  const [canPersist, setCanPersist] = useState(() => !storageProblem());
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>(() => loadKeys());
  const [sessions, setSessions] = useState<Record<string, AppLogin>>(() => loadSessions());
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [keyError, setKeyError] = useState<Record<string, string>>({});
  const [authError, setAuthError] = useState<Record<string, string>>({});
  const redirectTask = useRef<Promise<{ id: string; login: AppLogin }> | null>(null);
  const activeSyncs = useRef(new Set<string>());
  const keysRef = useRef(keys);
  const sessionsRef = useRef(sessions);
  const syncSessionRef = useRef<(id: string, login: AppLogin, announce: boolean) => Promise<void>>(async () => undefined);
  const [connecting, setConnecting] = useState(false);
  const [billingRequest, setBillingRequest] = useState<BillingRequest | null>(null);
  const billingRef = useRef<BillingRequest | null>(null);
  const visibleAccounts = state.subscriptions.filter((item) => item.readingSource !== "seed");

  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    syncSessionRef.current = syncSession;
  });

  function rememberSession(id: string, login: AppLogin) {
    const next = { ...sessionsRef.current, [id]: login };
    sessionsRef.current = next;
    saveSessions(next);
    setSessions(next);
  }

  async function syncSession(id: string, login: AppLogin, announce: boolean) {
    if (activeSyncs.current.has(id)) return;
    activeSyncs.current.add(id);
    const original = sessionsRef.current[id];
    setSyncing((current) => ({ ...current, [id]: true }));
    try {
      const fresh = await refreshLogin(login);
      if (sessionsRef.current[id] !== original) return;
      // Persist token rotation even when the subsequent usage request fails.
      rememberSession(id, fresh);
      const account = await fetchLiveAccount(fresh);
      if (sessionsRef.current[id] !== fresh) return;
      rememberSession(id, {
        ...fresh,
        email: account.email ?? fresh.email,
        plan: account.plan ?? fresh.plan,
        workspaceName: account.workspaceName ?? fresh.workspaceName,
        accountId: account.accountId ?? fresh.accountId,
      });
      const checkedAt = new Date();
      setNow(checkedAt);
      setState((current) => applyLiveAccount(current, id, account, checkedAt));
      setAuthError((current) => ({ ...current, [id]: "" }));
      if (announce) {
        const who = account.email ?? fresh.email ?? "that seat";
        const providerName = login.provider === "openai" ? "ChatGPT" : "Claude";
        setNotice(account.windows.length > 0 ? `Updated ${who} from ${providerName}.` : `Signed in as ${who}. That account didn't report usage bars.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Usage could not be read.";
      setAuthError((current) => ({ ...current, [id]: message }));
    } finally {
      activeSyncs.current.delete(id);
      setSyncing((current) => ({ ...current, [id]: false }));
    }
  }

  useEffect(() => {
    if (!canPersist) return;
    // Persistence status reflects an external browser storage write.
    // oxlint-disable-next-line react/set-state-in-effect
    try { saveState(state); setStorageError(""); }
    catch { setStorageError("Changes are only in this tab. Export your accounts before closing it."); }
  }, [state, canPersist]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancel = false;
    async function pull(id: string, apiKey: string, announce: boolean) {
      setSyncing((current) => ({ ...current, [id]: true }));
      try {
        const reading = await fetchGoUsage(apiKey, "");
        if (cancel) return;
        const checkedAt = new Date();
        setNow(checkedAt);
        setState((current) => {
          const seat = current.subscriptions.find((item) => item.id === id);
          if (!seat) return current;
          return applyGoReading(current, id, reading, checkedAt);
        });
        setKeyError((current) => ({ ...current, [id]: "" }));
        if (announce) setNotice("OpenCode usage updated.");
      } catch (error) {
        if (cancel) return;
        const message = error instanceof Error ? error.message : "OpenCode usage could not be read.";
        setKeyError((current) => ({ ...current, [id]: message }));
      } finally {
        if (!cancel) setSyncing((current) => ({ ...current, [id]: false }));
      }
    }

    async function pullAll() {
      await Promise.all(Object.entries(keysRef.current).map(([id, apiKey]) => pull(id, apiKey, false)));
    }

    void pullAll();
    const timer = window.setInterval(() => void pullAll(), 60_000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    async function pullSaved() {
      await Promise.all(Object.entries(sessionsRef.current).map(([id, login]) => syncSessionRef.current(id, login, false)));
    }
    if (window.location.pathname === "/auth/done" && !redirectTask.current) {
      const params = new URLSearchParams(window.location.search);
      const pending = loadPending();
      window.history.replaceState({}, "", "/");
      clearPending();
      if (!matchesCallback(pending, params.get("state"), params.get("provider"))) {
        redirectTask.current = Promise.reject(new Error("That sign-in did not match. Start again from the account."));
      } else if (pending) {
        const code = params.get("code");
        const error = params.get("error_description") || params.get("error");
        if (error || !code) redirectTask.current = Promise.reject(new Error(error || "Sign-in was cancelled."));
        else redirectTask.current = finishLogin(pending, code).then((login) => ({ id: pending.subscriptionId, login }));
      }
    }
    async function restoreSessions() {
      try {
        if (redirectTask.current) {
          const result = await redirectTask.current;
          if (cancel) return;
          rememberSession(result.id, result.login);
          redirectTask.current = null;
        }
        if (!cancel) await pullSaved();
      } catch (error) {
        if (!cancel) {
          redirectTask.current = null;
          setNotice(error instanceof Error ? error.message : "Sign-in failed.");
        }
      }
    }
    void restoreSessions();
    const timer = window.setInterval(() => void pullSaved(), 60_000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, []);

  function patch(id: string, update: Parameters<typeof mapSubscription>[2]) {
    setState((current) => mapSubscription(current, id, update));
  }

  function billingFailure(request: BillingRequest, error: unknown) {
    const message = error instanceof Error ? error.message : "Billing could not be read.";
    setState((current) => applyBillingFailure(current, request.target, message, new Date()));
  }

  async function startBilling(subscription: Subscription) {
    if (billingRef.current || !subscription.providerAccountId || sessionsRef.current[subscription.id]?.provider !== "openai") return;
    const request: BillingRequest = { subscriptionId: subscription.id, target: { accountId: subscription.providerAccountId, email: subscription.login, workspace: !!subscription.workspaceId }, connectionId: null, stage: "starting" };
    billingRef.current = request;
    setBillingRequest({ ...request });
    patch(subscription.id, (item) => ({ ...item, billingError: undefined }));
    try {
      const connection = await openBillingBrowser(request.target);
      Object.assign(request, connection);
      if (billingRef.current !== request) { await closeBillingBrowser(connection.connectionId).catch(() => undefined); return; }
      request.stage = "login";
      setBillingRequest({ ...request });
      if (request.mode === "cloud") await finishBilling();
    } catch (error) {
      if (billingRef.current !== request) return;
      billingFailure(request, error);
      billingRef.current = null;
      setBillingRequest(null);
    }
  }

  async function finishBilling() {
    const request = billingRef.current;
    if (!request?.connectionId || request.stage !== "login") return;
    request.stage = "reading";
    setBillingRequest({ ...request });
    try {
      const details = await readBillingBrowser(request.connectionId);
      if (billingRef.current !== request) return;
      setState((current) => sessionsRef.current[request.subscriptionId] ? applyBillingRecord(current, details) : current);
      billingRef.current = null;
      setBillingRequest(null);
    } catch (error) {
      if (billingRef.current !== request) return;
      billingFailure(request, error);
      if (error instanceof BillingConnectionError && error.ended) {
        void closeBillingBrowser(request.connectionId).catch(() => undefined);
        billingRef.current = null;
        setBillingRequest(null);
      } else {
        request.stage = "login";
        setBillingRequest({ ...request });
      }
    }
  }

  function cancelBilling(subscriptionId?: string) {
    const request = billingRef.current;
    if (!request || (subscriptionId && subscriptionId !== request.subscriptionId)) return;
    billingRef.current = null;
    setBillingRequest(null);
    if (request.connectionId) void closeBillingBrowser(request.connectionId).catch(() => setNotice("The billing browser could not be closed. Its session expires after fourteen minutes."));
  }

  useEffect(() => () => {
    const id = billingRef.current?.connectionId;
    billingRef.current = null;
    if (id) void closeBillingBrowser(id).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!billingRequest?.expiresAt) return;
    const timer = window.setTimeout(() => {
      const request = billingRef.current;
      if (!request || request.connectionId !== billingRequest.connectionId) return;
      billingFailure(request, new Error("The sign-in window expired. Fetch billing to open a new one."));
      cancelBilling();
    }, Math.max(0, billingRequest.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [billingRequest]);

  function loginProvider(provider: ProviderId): AppLoginProvider | null {
    if (provider === "claude") return "claude";
    if (provider === "codex" || provider === "chatgpt") return "openai";
    return null;
  }

  function addProvider(provider: ConnectProvider) {
    if (connecting) return;
    if (!canPersist) { setNotice("Restore a valid backup before connecting; the unreadable saved data has been preserved."); return; }
    const pending = state.subscriptions.find((item) => item.provider === provider && item.templateId.startsWith("detect-") && !item.readingsKnown && !sessionsRef.current[item.id] && !keysRef.current[item.id]);
    const id = pending?.id ?? crypto.randomUUID();
    const subscription = pending ?? createProviderAccount(provider, id, new Date());
    const next = pending ? state : { ...state, subscriptions: [...state.subscriptions, subscription] };
    // The redirect must not race React's persistence effect.
    try { saveState(next); }
    catch { setNotice("Account setup could not be saved. Enable browser storage before connecting."); return; }
    setState(next);
    setNotice(null);
    if (provider === "opencode") {
      window.setTimeout(() => {
        document.getElementById(`seat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        document.querySelector<HTMLInputElement>(`#seat-${id} input[type=password]`)?.focus();
      }, 50);
      return;
    }
    setConnecting(true);
    setSyncing((current) => ({ ...current, [id]: true }));
    void beginLogin(id, provider === "chatgpt" ? "openai" : "claude").catch((error: unknown) => {
      setAuthError((current) => ({ ...current, [id]: error instanceof Error ? error.message : "Sign-in could not start." }));
      setSyncing((current) => ({ ...current, [id]: false }));
      setConnecting(false);
    });
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = typeof reader.result === "string" ? parseState(reader.result) : null;
      if (!parsed) {
        setNotice("That file isn't an Allowance export.");
        return;
      }
      if (!window.confirm("Replace the tracked accounts with this export? Existing provider connections will be disconnected.")) return;
      cancelBilling();
      keysRef.current = {};
      sessionsRef.current = {};
      setKeys({}); setSessions({}); saveKeys({}); saveSessions({});
      setCanPersist(true);
      setState(attachKnownPlans({ ...parsed, browserSyncEnabled: false }, new Date()));
      setNotice("Accounts imported. Reconnect providers to refresh usage.");
    };
    reader.onerror = () => setNotice("The export file could not be read.");
    if (file.size > 5_000_000) { setNotice("Choose an export smaller than 5 MB."); return; }
    reader.readAsText(file);
  }

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1 className="eyebrow">Allowance<span className="local-tag">Stored in this browser</span></h1>
        </div>
        <details className="data-tools"><summary>Data & backups</summary><div className="top-actions">
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "allowance.json";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export
          </button>
          <label className="file">
            Import
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importFile(file);
                event.target.value = "";
              }}
            />
          </label>
        </div></details>
      </header>
      {storageError && <p className="notice" role="alert">{storageError}</p>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <main>
      {visibleAccounts.length ? <details className="add-account"><summary>Add account</summary><AddAccount onAdd={addProvider} busy={connecting} /></details> : <AddAccount onAdd={addProvider} busy={connecting} />}
      <section className="ledger" aria-label="Subscriptions">
        <div className="ledger-head">
          <h2>Your accounts</h2>
          <p className="hint">Refreshes every minute while open</p>
        </div>
        {visibleAccounts.length === 0 && <p className="empty">Connect a provider above to see your usage here.</p>}
        {visibleAccounts.map((subscription) => (
          <AccountCard
            key={subscription.id}
            subscription={subscription}
            now={now}
            billingActions={{
              busy: !!billingRequest,
              stage: billingRequest?.subscriptionId === subscription.id ? billingRequest.stage : undefined,
              mode: billingRequest?.subscriptionId === subscription.id ? billingRequest.mode : undefined,
              loginUrl: billingRequest?.subscriptionId === subscription.id ? billingRequest.loginUrl : undefined,
              expiresAt: billingRequest?.subscriptionId === subscription.id ? billingRequest.expiresAt : undefined,
              onStart: subscription.providerAccountId && sessions[subscription.id]?.provider === "openai" ? () => void startBilling(subscription) : undefined,
              onRead: () => void finishBilling(),
              onCancel: () => cancelBilling(subscription.id),
            }}
            onRemove={() => {
              cancelBilling(subscription.id);
              setState((current) => ({
                ...current,
                subscriptions: current.subscriptions.filter((item) => item.id !== subscription.id),
              }));
              setKeys((current) => {
                const next = { ...current };
                delete next[subscription.id];
                saveKeys(next);
                return next;
              });
              setSessions((current) => {
                const next = { ...current };
                delete next[subscription.id];
                sessionsRef.current = next;
                saveSessions(next);
                return next;
              });
            }}
            apiKeyHint={keys[subscription.id] ? maskKey(keys[subscription.id]) : null}
            syncing={syncing[subscription.id] === true}
            keyError={keyError[subscription.id] || null}
            onConnectKey={(apiKey) => {
              const next = { ...keys, [subscription.id]: apiKey.trim() };
              setKeys(next);
              saveKeys(next);
              setSyncing((current) => ({ ...current, [subscription.id]: true }));
              void fetchGoUsage(apiKey, subscription.login)
                .then((reading) => {
                  const checkedAt = new Date();
                  setNow(checkedAt);
                  setState((current) =>
                    applyGoReading(current, subscription.id, reading, checkedAt),
                  );
                  setKeyError((current) => ({ ...current, [subscription.id]: "" }));
                  setNotice(`Updated ${subscription.login} from OpenCode.`);
                })
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : "OpenCode usage could not be read.";
                  setKeyError((current) => ({ ...current, [subscription.id]: message }));
                })
                .finally(() => setSyncing((current) => ({ ...current, [subscription.id]: false })));
            }}
            onRefreshKey={() => {
              const apiKey = keys[subscription.id];
              if (!apiKey) return;
              setSyncing((current) => ({ ...current, [subscription.id]: true }));
              void fetchGoUsage(apiKey, subscription.login)
                .then((reading) => {
                  const checkedAt = new Date();
                  setNow(checkedAt);
                  setState((current) =>
                    applyGoReading(current, subscription.id, reading, checkedAt),
                  );
                  setKeyError((current) => ({ ...current, [subscription.id]: "" }));
                  setNotice(`Updated ${subscription.login} from OpenCode.`);
                })
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : "OpenCode usage could not be read.";
                  setKeyError((current) => ({ ...current, [subscription.id]: message }));
                })
                .finally(() => setSyncing((current) => ({ ...current, [subscription.id]: false })));
            }}
            onDisconnectKey={() => {
              setKeys((current) => {
                const next = { ...current };
                delete next[subscription.id];
                saveKeys(next);
                return next;
              });
              setNotice(`Stopped tracking ${subscription.login}.`);
            }}
            workspace={(state.workspaces ?? []).find((item) => item.id === subscription.workspaceId) ?? null}
            loginProvider={loginProvider(subscription.provider)}
            signedIn={sessions[subscription.id] ?? null}
            authError={authError[subscription.id] || null}
            onSignIn={() => {
              const provider = loginProvider(subscription.provider);
              if (!provider) return;
              setAuthError((current) => ({ ...current, [subscription.id]: "" }));
              setSyncing((current) => ({ ...current, [subscription.id]: true }));
              void beginLogin(subscription.id, provider).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : "Sign-in could not start.";
                setAuthError((current) => ({ ...current, [subscription.id]: message }));
                setSyncing((current) => ({ ...current, [subscription.id]: false }));
              });
            }}
            onRefreshLogin={() => {
              const login = sessionsRef.current[subscription.id];
              if (login) void syncSession(subscription.id, login, true);
            }}
            onSignOut={() => {
              cancelBilling(subscription.id);
              setSessions((current) => {
                const next = { ...current };
                delete next[subscription.id];
                sessionsRef.current = next;
                saveSessions(next);
                return next;
              });
              setNotice(`Signed out of ${subscription.login}. The last reading is saved.`);
            }}
          />
        ))}

      </section>
      </main>
      <footer>
        <p>Usage credentials stay in this browser. Connected billing profiles stay with the browser service. Credentials are excluded from exports.</p>
      </footer>
    </div>
  );
}
