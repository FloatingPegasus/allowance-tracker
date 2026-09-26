import { invoiceMoney, type SyncSection } from "../domain/billingRecords";
import type { Subscription, Workspace } from "../domain/types";

export interface BillingActions {
  stage?: "starting" | "login" | "reading";
  busy?: boolean;
  mode?: "local" | "cloud";
  loginUrl?: string;
  expiresAt?: number;
  onStart?: () => void;
  onRead?: () => void;
  onCancel?: () => void;
}
interface Props extends BillingActions { subscription: Subscription; workspace: Workspace | null; collapseDetails?: boolean }
export function BillingPanel({ subscription, workspace, stage, busy, mode, loginUrl, expiresAt, onStart, onRead, onCancel, collapseDetails = false }: Props) {
  const saved = subscription.browserDetails;
  const details = saved?.accountId === subscription.providerAccountId && saved?.email.toLowerCase() === subscription.login.toLowerCase() ? saved : undefined;
  const openai = subscription.provider === "chatgpt" || subscription.provider === "codex";
  const providerUrl = openai ? workspace ? "https://chatgpt.com/admin/billing" : "https://chatgpt.com/settings/billing" : subscription.provider === "claude" ? "https://claude.ai/" : "https://opencode.ai/";
  const billing = details?.billing.data;
  const directory = details?.directory.data;
  const seats = details?.seats.data;
  const invoices = details?.invoices.data;
  const latestInvoice = invoices?.reduce<typeof invoices[number] | null>((latest, invoice) => !latest || Date.parse(invoice.createdAt) > Date.parse(latest.createdAt) ? invoice : latest, null);
  const hasData = details && [details.billing, details.seats, details.directory, details.invoices].some((section) => section.data !== null);
  return <section className="org" aria-label={workspace ? `${workspace.name} management` : "Billing"}>
    <div className="org-head"><h4>{workspace ? "Workspace & billing" : "Billing"}</h4>{hasData && <span className="hint">Saved record</span>}</div>
    {workspace && <><p className="workspace-name">{workspace.name}</p><p className="hint">Your role: <strong>{subscription.accountRole ?? "Not reported"}</strong></p></>}
    {details && <dl className="account-facts">
      <div><dt>Subscription</dt><dd>{billing ? billing.active ? "Active" : "Inactive" : "Unknown"}{billing?.interval ? ` · ${billing.interval}` : ""}</dd></div>
      <div><dt>{billing?.willRenew === false ? "Access ends" : "Next renewal"}</dt><dd>{(billing?.willRenew === false ? billing.expiresAt : billing?.renewsAt) ? recordDate((billing?.willRenew === false ? billing.expiresAt : billing?.renewsAt)!) : "Unknown"}</dd></div>
      {latestInvoice && <div><dt>Latest invoice</dt><dd>{invoiceMoney(latestInvoice)}<span className="invoice-date hint">{recordDate(latestInvoice.createdAt)} · {latestInvoice.status}</span></dd></div>}
      {workspace && <><div><dt>Workspace members</dt><dd>{directory?.total ?? "Unknown"}</dd></div><div><dt>Purchased seats</dt><dd>{seats ? seats.reduce((sum, line) => sum + line.purchased, 0) : "Unknown"}</dd></div></>}
    </dl>}
    {!hasData && <p className="hint">No billing record saved.</p>}
    {onStart && !stage && !hasData && <p className="hint">Fetch this account’s billing. You may need to sign in.</p>}
    {stage && <p className="hint" role="status">{stage === "starting" ? "Connecting to billing…" : stage === "reading" ? "Reading this account’s billing…" : <>Sign in as <strong>{subscription.login}</strong> in {mode === "cloud" ? "the cloud browser" : "the opened Chrome window"}, then retry.</>}</p>}
    {stage === "login" && loginUrl && <p><a href={loginUrl} target="_blank" rel="noreferrer">Open cloud browser to sign in ↗</a></p>}
    {stage === "login" && expiresAt && <p className="hint">Sign-in window closes at {new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>}
    <div className="management-actions">{onStart && !stage && <button type="button" disabled={busy} onClick={onStart}>Fetch billing</button>}{stage === "login" && <button type="button" onClick={onRead}>I’m signed in · fetch billing</button>}{stage && <button type="button" onClick={onCancel}>Cancel</button>}<a href={providerUrl} target="_blank" rel="noreferrer">{openai ? "Open billing page ↗" : "Open provider ↗"}</a>{workspace && openai && <a href="https://chatgpt.com/admin/members" target="_blank" rel="noreferrer">Open members ↗</a>}</div>
    {openai && !onStart && <p className="hint">Connect this account’s usage login before fetching billing.</p>}
    {subscription.billingError && <p className="error" role="status">{subscription.billingError.message}<span className="last-attempt hint">Last attempt: {new Date(subscription.billingError.at).toLocaleString()}{hasData ? ". Showing saved billing." : ""}</span></p>}
    {details && <p className="hint">Billing last checked <time dateTime={details.observedAt}>{new Date(details.observedAt).toLocaleString()}</time></p>}
    <SectionStatus label="Subscription" section={details?.billing} observedAt={details?.observedAt} />
    <SectionStatus label="Invoices" section={details?.invoices} observedAt={details?.observedAt} />
    {workspace && <><SectionStatus label="Seats" section={details?.seats} observedAt={details?.observedAt} /><SectionStatus label="Members" section={details?.directory} observedAt={details?.observedAt} /></>}
    {details && <details className="billing-history" open={!collapseDetails}><summary>{workspace ? "Invoices, seats & members" : "Invoices"}</summary>
    {invoices && <div className="table-scroll"><table className="org-table"><caption>Recent invoices · actual charges</caption><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td>{recordDate(invoice.createdAt)}</td><td>{invoice.description}</td><td>{invoiceMoney(invoice)}</td><td>{invoice.status}</td></tr>)}</tbody></table>{invoices.length === 0 && <p className="hint">No recent invoices returned.</p>}</div>}
    {workspace && <>
      {seats && <div className="table-scroll"><table className="org-table"><caption>Seats</caption><thead><tr><th>Type</th><th>Purchased</th><th>Assigned</th><th>Available</th></tr></thead><tbody>{seats.map((line) => <tr key={line.type}><td>{line.label}</td><td>{line.purchased}</td><td>{line.assigned ?? "Unknown"}</td><td>{line.available ?? "Unknown"}</td></tr>)}</tbody></table></div>}
      {directory && <div className="table-scroll"><table className="org-table"><caption>Members · {directory.total}</caption><thead><tr><th>Member</th><th>Role</th><th>Seat</th></tr></thead><tbody>{directory.members.map((member) => <tr key={member.id}><td>{member.name && <span className="member-name">{member.name}</span>}{member.email}</td><td>{member.role ?? "Unknown"}</td><td>{member.seat ?? "Unknown"}</td></tr>)}</tbody></table></div>}
    </>}
    </details>}
  </section>;
}
function SectionStatus({ label, section, observedAt }: { label: string; section: SyncSection<unknown> | undefined; observedAt?: string }) {
  if (!section) return null;
  return <>{section.error && <p className="error">{label}: {section.error}{section.data !== null ? " Showing the last successful sync." : ""}</p>}{section.updatedAt && section.updatedAt !== observedAt && <p className="hint">{label} synced {new Date(section.updatedAt).toLocaleString()}</p>}</>;
}
function recordDate(value: string): string { return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); }
