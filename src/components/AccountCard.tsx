import { useState } from "react";
import { BillingDate } from "./BillingDate";
import type { BillingSchedule } from "../domain/billingSchedule";
import { isChatGptBusiness } from "../domain/businessSeat";
import { ProviderLogin } from "./ProviderLogin";
import { meterTone, remainingLabel, remainingPercent, seatLine } from "../domain/format";
import { countdown, resetStamp } from "../domain/time";
import { checkedAgo, usageStatus } from "../domain/usageStatus";
import type { BusinessSeat, QuotaWindow, Subscription, Workspace } from "../domain/types";
import type { AppLogin, AppLoginProvider } from "../domain/sessions";

interface Props {
  subscription: Subscription;
  now: Date;
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
  onBillingChange: (schedule: BillingSchedule | null) => void;
  onSeatChange: (seat: BusinessSeat | null) => void;
  onSignIn: () => void;
  onRefreshLogin: () => void;
  onSignOut: () => void;
}

export function AccountCard({
  subscription, now, onRemove, apiKeyHint, syncing, keyError,
  onConnectKey, onRefreshKey, onDisconnectKey, workspace,
  loginProvider, signedIn, authError, onSignIn, onRefreshLogin,
  onSignOut, onBillingChange, onSeatChange,
}: Props) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const connected = signedIn != null || apiKeyHint != null;
  const status = usageStatus(subscription, connected, authError || keyError, now);
  const hasReading = subscription.readingsKnown && subscription.windows.length > 0;
  const checkedAt = subscription.readingSource === "live" ? subscription.usageCheckedAt : undefined;
  const openai = subscription.provider === "chatgpt" || subscription.provider === "codex";
  const business = isChatGptBusiness(subscription);

  return (
    <article id={`seat-${subscription.id}`} className="card" data-provider={subscription.provider} aria-labelledby={`account-${subscription.id}`}>
      <div className="card-id">
        <h3 id={`account-${subscription.id}`}>
          <i className={`mark mark-${subscription.provider}`} aria-hidden="true" />
          {seatLine(subscription.provider, "", null)}
          {subscription.plan && <span className="account-plan">{subscription.plan === "Business Premium" ? "Business" : subscription.plan}</span>}
        </h3>
        <p className="account-login">{signedIn?.email ?? subscription.login}</p>
        {workspace && <p className="hint workspace-name">{workspace.name}</p>}
        {business && subscription.manualBusinessSeat && <p className="hint">{subscription.manualBusinessSeat} seat · Manual</p>}
        <p className={`sync-status ${status === "Synced" ? "synced" : ""}`}>{status}</p>
        {loginProvider && <ProviderLogin
          provider={loginProvider}
          connected={signedIn != null}
          busy={syncing}
          error={authError}
          onSignIn={onSignIn}
          onRefresh={onRefreshLogin}
        />}
        {subscription.provider === "opencode" && <GoKey
          hint={apiKeyHint} syncing={syncing} error={keyError}
          onConnect={onConnectKey} onRefresh={onRefreshKey}
        />}
      </div>
      <div className="card-body">
        <p className="usage-heading">{openai ? "Codex usage" : "Usage"}</p>
        <div className="meters">
          {hasReading ? subscription.windows.map((window) => <Meter key={window.kind} window={window} now={now} />)
            : <p className="empty">{connected ? "No usage reported" : "No saved usage"}</p>}
        </div>
        {checkedAt && <p className="hint"><time dateTime={checkedAt} title={new Date(checkedAt).toLocaleString()}>{checkedAgo(checkedAt, now)}</time>{status !== "Synced" && hasReading ? " · Last saved usage" : ""}</p>}
        {hasReading && !checkedAt && <p className="hint">Unverified reading</p>}
      </div>
      <BillingDate schedule={subscription.billingSchedule ?? null} now={now} onChange={onBillingChange} />
      <details className="account-details">
        <summary>Account details</summary>
        {workspace && subscription.accountRole && subscription.readingSource === "live" && <p className="hint">Workspace role: {subscription.accountRole}</p>}
        {business && <div className="seat-choice">
          <label htmlFor={`business-seat-${subscription.id}`}>Business seat (manual)</label>
          <select id={`business-seat-${subscription.id}`} value={subscription.manualBusinessSeat ?? ""} onChange={(event) => onSeatChange(event.target.value === "Standard" || event.target.value === "Premium" ? event.target.value : null)}>
            <option value="">Not set</option>
            <option value="Standard">Standard</option>
            <option value="Premium">Premium</option>
          </select>
        </div>}
        <div className="card-actions">
          {connected && <button type="button" disabled={syncing} onClick={signedIn ? onSignOut : onDisconnectKey}>Disconnect</button>}
          {confirmRemove ? <>
            <span className="hint">Remove this account and its saved readings?</span>
            <button type="button" className="danger" onClick={onRemove}>Confirm remove</button>
            <button type="button" onClick={() => setConfirmRemove(false)}>Keep account</button>
          </> : <button type="button" onClick={() => setConfirmRemove(true)}>Remove account</button>}
        </div>
      </details>
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
      {due && <span className="due">Reset due · Refresh usage</span>}
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
}: {
  hint: string | null;
  syncing: boolean;
  error: string | null;
  onConnect: (apiKey: string) => void;
  onRefresh: () => void;
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
            <button type="button" disabled={syncing} onClick={onRefresh}>
              {syncing ? "Reading…" : "Refresh usage"}
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
        </>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
