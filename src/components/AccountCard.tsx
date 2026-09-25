import { useState } from "react";
import { BillingPanel, type BillingActions } from "./BillingPanel";
import { ProviderLogin } from "./ProviderLogin";
import { outlook } from "../domain/engine";
import { formatSessions, meterTone, qualityLabel, remainingLabel, remainingPercent, seatLine } from "../domain/format";
import { countdown, fromDatetimeLocal, resetStamp, toDatetimeLocal } from "../domain/time";
import type { QuotaWindow, ReadingSource, Subscription, WindowKind, Workspace } from "../domain/types";
import type { AppLogin, AppLoginProvider } from "../domain/sessions";
interface Props {
  subscription: Subscription;
  now: Date;
  recommended: boolean;
  onLogin: (login: string) => void;
  onWindow: (kind: WindowKind, patch: { usedPercent?: number; countUsed?: number; resetsAt?: string | null }) => void;
  onBanked: (count: number, expiresAt: string | null) => void;
  onApplyReset: () => void;
  onRemove: () => void;
  apiKeyHint: string | null;
  syncing: boolean;
  keyError: string | null;
  onConnectKey: (apiKey: string) => void;
  onRefreshKey: () => void;
  onDisconnectKey: () => void;
  workspace: Workspace | null;
  loginProvider: AppLoginProvider | null;
  signedIn: AppLogin | null;
  authError: string | null;
  billingActions?: BillingActions;
  onSignIn: () => void;
  onRefreshLogin: () => void;
  onSignOut: () => void;
}

const SOURCE: Record<ReadingSource, string> = {
  seed: "Demo",
  manual: "Manual",
  extension: "Saved reading",
  live: "Live",
};

export function AccountCard({
  subscription,
  now,
  recommended,
  onLogin,
  onWindow,
  onBanked,
  onApplyReset,
  onRemove,
  apiKeyHint,
  syncing,
  keyError,
  onConnectKey,
  onRefreshKey,
  onDisconnectKey,
  workspace,
  loginProvider,
  signedIn,
  authError,
  onSignIn,
  onRefreshLogin,
  onSignOut,
  billingActions,
}: Props) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const lanes = outlook(subscription);
  const agentLanes = lanes.filter((item) => item.lane.surface === "agent");
  const chatLanes = lanes.filter((item) => item.lane.surface === "chat");

  return (
    <article
      id={`seat-${subscription.id}`}
      className={recommended ? "card is-pick" : "card"}
      data-provider={subscription.provider}
    >
      <div className="card-id">
        {recommended && <p className="kicker">Suggested</p>}
        <div className="account-heading"><h2>
          <i className={`mark mark-${subscription.provider}`} aria-hidden="true" />
          {seatLine(subscription.provider, "", null)}
        </h2><button type="button" aria-expanded={showBilling} aria-controls={`billing-${subscription.id}`} onClick={() => setShowBilling(!showBilling)}>Billing</button></div>
        {subscription.plan && <p className="account-plan">{subscription.plan}{subscription.seat ? ` · ${subscription.seat}` : ""}</p>}
        {loginProvider && (
          <ProviderLogin
            provider={loginProvider}
            connected={signedIn != null}
            email={signedIn?.email ?? null}
            busy={syncing}
            error={authError}
            onSignIn={onSignIn}
            onRefresh={onRefreshLogin}
            onSignOut={onSignOut}
          />
        )}
        {subscription.provider === "opencode" && (
          <GoKey
            hint={apiKeyHint}
            syncing={syncing}
            error={keyError}
            onConnect={onConnectKey}
            onRefresh={onRefreshKey}
            onDisconnect={onDisconnectKey}
          />
        )}
        <p className="meta">
          <span className={`source source-${subscription.readingSource}`}>{subscription.readingsKnown ? (subscription.readingSource === "live" && authError ? "Last synced" : SOURCE[subscription.readingSource]) : signedIn || apiKeyHint ? "Usage unavailable" : "Not connected"}</span>
          {subscription.supportsBankedResets && (
            <span>
              {subscription.bankedResets} banked
              {subscription.bankedResetExpiresAt && subscription.bankedResets > 0
                ? ` · until ${new Date(subscription.bankedResetExpiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : ""}
            </span>
          )}
        </p>
      </div>
      <div className="card-body">
        <p className="usage-heading">{subscription.provider === "chatgpt" || subscription.provider === "codex" ? "Codex allowance remaining" : "Allowance remaining"}</p>
        <div className="meters">
          {!subscription.readingsKnown ? <p className="empty">{signedIn || apiKeyHint ? "The provider has not reported usage. Try refreshing or add a manual reading below." : "Connect to read your usage automatically."}</p> : subscription.windows.map((window) => (
            <Meter key={window.kind} window={window} now={now} />
          ))}
        </div>
        {subscription.usageCheckedAt && <p className="hint">Usage checked <time dateTime={subscription.usageCheckedAt}>{new Date(subscription.usageCheckedAt).toLocaleString()}</time></p>}
        {showBilling && <div id={`billing-${subscription.id}`}><BillingPanel
          subscription={subscription}
          workspace={workspace}
          {...billingActions}
        /></div>}
        {subscription.readingsKnown && lanes.length > 0 && <details className="lane-details"><summary>Estimated sessions by model</summary><ul className="lanes">
          {agentLanes.map(({ lane, view }) => (
            <li key={lane.id}>
              <span>{lane.name}</span>
              <span className="q">{qualityLabel(lane.quality)}</span>
              {view ? (
                <span className="num">
                  {formatSessions(view.sessions)}
                  {view.protected ? " · held" : ""}
                </span>
              ) : (
                <span className="num blocked">no room</span>
              )}
            </li>
          ))}
          {chatLanes.map(({ lane, view }) => (
            <li key={lane.id} className="chat-lane">
              <span>{lane.name}</span>
              <span className="q">Chat</span>
              <span className="num">{view ? formatSessions(view.sessions) : "no room"}</span>
            </li>
          ))}
        </ul></details>}
        <details className="account-settings"><summary>Account settings & manual readings</summary>
        <label className="login">
          Login
          <input
            value={subscription.login}
            aria-label={`Login for ${subscription.plan} ${subscription.seat ?? ""}`.trim()}
            placeholder="you@company.com or a label"
            autoComplete="off"
            maxLength={120}
            onChange={(event) => onLogin(event.target.value)}
          />
        </label>
        <details className="plan-notes"><summary>Plan assumptions</summary><p className="hint">Local presets; confirm your account’s actual limits with the provider.</p><p className="notes">{subscription.notes}</p></details>
        <div className="card-actions">
          {subscription.supportsBankedResets &&
            (confirmReset ? (
              <>
                <button type="button" className="solid" onClick={() => { onApplyReset(); setConfirmReset(false); }}>
                  Apply reset
                </button>
                <button type="button" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" disabled={subscription.bankedResets <= 0} onClick={() => setConfirmReset(true)}>
                Record a used reset
              </button>
            ))}
          {confirmRemove ? (
            <>
              <button type="button" className="danger" onClick={onRemove}>
                Confirm remove
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
        </div>
        <details className="adjust">
          <summary>Adjust readings</summary>
          {subscription.windows.map((window) => (
            <WindowEditor key={window.kind} window={window} onWindow={onWindow} />
          ))}
          {subscription.supportsBankedResets && (
            <div className="edit-row">
              <label>
                Banked resets
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={subscription.bankedResets}
                  onChange={(event) => onBanked(Number(event.target.value), subscription.bankedResetExpiresAt)}
                />
              </label>
              <label>
                Expires
                <input
                  type="datetime-local"
                  value={subscription.bankedResetExpiresAt ? toDatetimeLocal(subscription.bankedResetExpiresAt) : ""}
                  onChange={(event) => onBanked(subscription.bankedResets, fromDatetimeLocal(event.target.value))}
                />
              </label>
            </div>
          )}
        </details>
        </details>
      </div>
    </article>
  );
}

function Meter({ window, now }: { window: QuotaWindow; now: Date }) {
  const remaining =
    window.countCapacity != null
      ? Math.max(0, window.countCapacity - (window.countUsed ?? 0))
      : remainingPercent(window.usedPercent);
  const value =
    window.countCapacity != null ? `${remaining} left` : remainingLabel(window.usedPercent);
  const fill =
    window.countCapacity != null
      ? (remaining / window.countCapacity) * 100
      : remaining;
  const due = window.resetsAt ? countdown(window.resetsAt, now) === "due" : false;
  return (
    <div className="meter" data-kind={window.kind} data-used={Math.round(window.usedPercent)}>
      <span className="meter-label">{window.label}</span>
      <span className="num meter-value">{value}</span>
      <div
        className={`bar ${meterTone(window.usedPercent)}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={window.countCapacity ?? 100}
        aria-valuenow={remaining}
        aria-label={`${window.label} remaining`}
        aria-valuetext={value}
      >
        <span style={{ width: `${Math.min(100, Math.max(0, fill))}%` }} />
      </div>
      <span className="num meter-when">{window.resetsAt ? `Resets ${resetStamp(window.resetsAt, now)}` : "Reset not reported"}</span>
      {window.status && window.status !== "ok" && <span className="due">{statusLabel(window.status)}</span>}
      {due && <span className="due">Reset time passed. Refresh usage.</span>}
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "rate-limited") return "Rate limited";
  return status;
}

function GoKey({
  hint,
  syncing,
  error,
  onConnect,
  onRefresh,
  onDisconnect,
}: {
  hint: string | null;
  syncing: boolean;
  error: string | null;
  onConnect: (apiKey: string) => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="key-row"
      onSubmit={(event) => {
        event.preventDefault();
        const apiKey = draft.trim();
        if (!apiKey) return;
        onConnect(apiKey);
        setDraft("");
      }}
    >
      {hint ? (
        <>
          <p className="hint">Key: {hint}</p>
          <div className="card-actions">
            <button type="button" className="solid" disabled={syncing} onClick={onRefresh}>
              {syncing ? "Reading…" : "Refresh usage"}
            </button>
            <button type="button" onClick={onDisconnect}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <label>
            OpenCode key
            <input
              type="password"
              value={draft}
              autoComplete="off"
              spellCheck={false}
              placeholder="oc_sk_…"
              aria-label="OpenCode API key"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button type="submit" className="solid" disabled={syncing || draft.trim().length === 0}>
            {syncing ? "Reading…" : "Track"}
          </button>
          <p className="hint">Reads the 5-hour, weekly, and monthly bars. The key stays in this browser.</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function WindowEditor({
  window,
  onWindow,
}: {
  window: QuotaWindow;
  onWindow: Props["onWindow"];
}) {
  const counted = window.countCapacity != null;
  return (
    <div className="edit-block">
      <div className="edit-row">
        <label>
          {window.label}
          <input
            type="range"
            min={0}
            max={counted ? window.countCapacity : 100}
            step={1}
            value={counted ? (window.countUsed ?? 0) : Math.round(window.usedPercent)}
            aria-label={`${window.label} used`}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (counted) onWindow(window.kind, { countUsed: next });
              else onWindow(window.kind, { usedPercent: next });
            }}
          />
        </label>
        <label>
          {counted ? "Count used" : "Percent used"}
          <input
            type="number"
            min={0}
            max={counted ? window.countCapacity : 100}
            value={counted ? (window.countUsed ?? 0) : Math.round(window.usedPercent)}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (counted) onWindow(window.kind, { countUsed: next });
              else onWindow(window.kind, { usedPercent: next });
            }}
          />
        </label>
        <label>
          Resets
          <input
            type="datetime-local"
            value={window.resetsAt ? toDatetimeLocal(window.resetsAt) : ""}
            onChange={(event) => onWindow(window.kind, { resetsAt: fromDatetimeLocal(event.target.value) })}
          />
        </label>
      </div>
      <p className="hint">{window.hint}</p>
    </div>
  );
}
