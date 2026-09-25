import { BrowserConnection, type BrowserConnectionHandle } from "./components/BrowserConnection";
import { applyBrowserDetails, applyBrowserFailure, isBrowserDetails } from "./domain/browserSync";
import { useEffect, useMemo, useRef, useState } from "react";
import { AddAccount } from "./components/AddAccount";
import { AccountCard } from "./components/AccountCard";
import { Hero } from "./components/Hero";
import { beginLogin, clearPending, fetchLiveAccount, finishLogin, loadPending, matchesCallback, refreshLogin } from "./domain/appLoginClient";
import { applyLiveAccount, applyGoReading, createProviderAccount } from "./domain/applyLogin";
import type { ConnectProvider } from "./domain/applyLogin";
import { createSeed } from "./domain/catalog";
import { clearKeys, loadKeys, saveKeys } from "./domain/keys";
import { applyBankedReset, mapSubscription, withBanked, withLogin, withWindow } from "./domain/mutate";
import { attachKnownPlans } from "./domain/org";
import { fetchGoUsage, maskKey } from "./domain/opencode";
import { decide } from "./domain/present";
import { applyReading, isUsageReading } from "./domain/reading";
import { clearSessions, loadSessions, saveSessions } from "./domain/sessions";
import type { AppLogin, AppLoginProvider } from "./domain/sessions";
import { clearState, loadState, parseState, saveState, storageProblem } from "./domain/storage";
import type { AppState, Intent, ProviderId, WindowKind } from "./domain/types";

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [storageError, setStorageError] = useState(storageProblem);
  const [canPersist, setCanPersist] = useState(() => !storageProblem());
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
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
  const [showExamples, setShowExamples] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const browserConnection = useRef<BrowserConnectionHandle>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const visibleAccounts = state.subscriptions.filter((item) => showExamples || item.readingSource !== "seed");
  const decision = useMemo(() => decide({ ...state, subscriptions: state.subscriptions.filter((item) => showExamples || item.readingSource !== "seed") }, now), [state, now, showExamples]);

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
      setState((current) => applyLiveAccount(current, id, account, new Date()));
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
        setState((current) => {
          const seat = current.subscriptions.find((item) => item.id === id);
          if (!seat) return current;
          return applyGoReading(current, id, reading, new Date());
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

  useEffect(() => {
    function onReading(event: Event) {
      if (!(event instanceof CustomEvent) || !isUsageReading(event.detail)) {
        setNotice("That usage reading could not be read.");
        return;
      }
      const result = applyReading(state, event.detail, new Date());
      if (!result.matched) {
        setNotice("No seat matched that reading. Use the login on the subscription.");
        return;
      }
      setState(result.state);
      setNotice(`Updated ${result.login} from a usage reading.`);
    }
    window.addEventListener("allowance:reading", onReading);
    return () => window.removeEventListener("allowance:reading", onReading);
  }, [state]);

  function patch(id: string, update: Parameters<typeof mapSubscription>[2]) {
    setState((current) => mapSubscription(current, id, update));
  }

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
          {confirmReset ? (
            <>
              <button
                type="button"
                className="solid"
                onClick={() => {
                  try { clearState(); clearKeys(); clearSessions(); } catch { /* Session state still resets when storage is blocked. */ }
                  setCanPersist(true);
                  keysRef.current = {};
                  sessionsRef.current = {};
                  setKeys({});
                  setSessions({});
                  const fresh = createSeed(new Date());
                  setState(fresh);
                  setNow(new Date());
                  setConfirmReset(false);
                  setNotice("Demo seats restored.");
                }}
              >
                Restore demo
              </button>
              <button type="button" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmReset(true)}>
              Reset demo
            </button>
          )}
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
      {visibleAccounts.some((item) => item.readingsKnown && item.lanes.length) && <details className="planner"><summary>Session planner · estimates</summary>
      <Hero
        decision={decision}
        intent={state.intent}
        holdCodex={state.holdCodex}
        onIntent={(intent: Intent) => setState((current) => ({ ...current, intent }))}
        onHold={(holdCodex) => setState((current) => ({ ...current, holdCodex }))}
      />
      </details>}
      <BrowserConnection
        ref={browserConnection}
        onBusy={setBillingBusy}
        enabled={state.browserSyncEnabled === true}
        accounts={state.subscriptions.filter((item) => (item.provider === "chatgpt" || item.provider === "codex") && item.providerAccountId && sessions[item.id]).map((item) => ({ accountId: item.providerAccountId!, email: item.login, workspace: !!item.workspaceId }))}
        onEnabled={(enabled) => setState((current) => ({ ...current, browserSyncEnabled: enabled }))}
        onFailure={(target, message) => setState((current) => current.subscriptions.some((item) => item.providerAccountId === target.accountId && item.login.toLowerCase() === target.email.toLowerCase() && sessionsRef.current[item.id]) ? applyBrowserFailure(current, target, message, new Date()) : current)}
        onResult={(value) => {
          if (!isBrowserDetails(value)) { setNotice("The browser returned unreadable account details. Saved readings were preserved."); return; }
          setState((current) => {
            const connected = current.subscriptions.some((item) => item.providerAccountId === value.accountId && item.login.toLowerCase() === value.email.toLowerCase() && sessionsRef.current[item.id]);
            return connected ? applyBrowserDetails(current, value) : current;
          });
        }}
      />
      <section className="ledger" aria-label="Subscriptions">
        <div className="ledger-head">
          <h2>Your accounts</h2>
        </div>
        {visibleAccounts.length === 0 && <p className="empty">Connect a provider above to see your usage here.</p>}
        {visibleAccounts.map((subscription) => (
          <AccountCard
            key={subscription.id}
            subscription={subscription}
            now={now}
            billingBusy={billingBusy}
            onCheckBilling={subscription.providerAccountId && sessions[subscription.id]?.provider === "openai" ? () => browserConnection.current?.syncAccount({ accountId: subscription.providerAccountId!, email: subscription.login, workspace: !!subscription.workspaceId }) : undefined}
            recommended={decision.pick?.subscription.id === subscription.id}
            onLogin={(login) => patch(subscription.id, (item) => withLogin(item, login, new Date()))}
            onWindow={(kind: WindowKind, windowPatch) =>
              patch(subscription.id, (item) => withWindow(item, kind, windowPatch, new Date()))
            }
            onBanked={(count, expiresAt) => patch(subscription.id, (item) => withBanked(item, count, expiresAt, new Date()))}
            onApplyReset={() => patch(subscription.id, (item) => applyBankedReset(item, new Date()))}
            onRemove={() => {
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
                  setState((current) =>
                    applyGoReading(current, subscription.id, reading, new Date()),
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
                  setState((current) =>
                    applyGoReading(current, subscription.id, reading, new Date()),
                  );
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
              setSessions((current) => {
                const next = { ...current };
                delete next[subscription.id];
                sessionsRef.current = next;
                saveSessions(next);
                return next;
              });
              setNotice(`Signed out of ${subscription.login}. The bars stay until the next sign-in.`);
            }}
          />
        ))}

      </section>
      </main>
      <footer>
        {state.subscriptions.some((item) => item.readingSource === "seed") && <button onClick={() => setShowExamples(!showExamples)}>{showExamples ? "Hide example accounts" : "Show example accounts"}</button>}
        <p>Provider credentials stay in this browser and are excluded from exports.</p>
      </footer>
    </div>
  );
}
