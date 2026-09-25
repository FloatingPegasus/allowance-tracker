import { invoiceMoney, type SyncSection } from "../domain/billingRecords";
import type { Subscription, Workspace } from "../domain/types";

export interface BillingActions {
  stage?: "starting" | "login" | "reading";
  busy?: boolean;
  onStart?: () => void;
  onRead?: () => void;
  onCancel?: () => void;
}
interface Props extends BillingActions { subscription: Subscription; workspace: Workspace | null }
export function BillingPanel({ subscription, workspace, stage, busy, onStart, onRead, onCancel }: Props) {
  const saved = subscription.browserDetails;
  const details = saved?.accountId === subscription.providerAccountId && saved?.email.toLowerCase() === subscription.login.toLowerCase() ? saved : undefined;
  const openai = subscription.provider === "chatgpt" || subscription.provider === "codex";
  const providerUrl = openai ? workspace ? "https://chatgpt.com/admin/billing" : "https://chatgpt.com/settings/billing" : subscription.provider === "claude" ? "https://claude.ai/" : "https://opencode.ai/";
  const billing = details?.billing.data;
  const directory = details?.directory.data;
  const seats = details?.seats.data;
  const invoices = details?.invoices.data;
  const hasData = details && [details.billing, details.seats, details.directory, details.invoices].some((section) => section.data !== null);
  return <section className="org" aria-label={workspace ? `${workspace.name} management` : "Billing"}>
    <div className="org-head"><h3>{workspace ? "Workspace & billing" : "Billing"}</h3>{hasData && <span className="hint">Saved record</span>}</div>
    {workspace && <><p className="workspace-name">{workspace.name}</p><p className="hint">Your role: <strong>{subscription.accountRole ?? "Not reported"}</strong></p></>}
    {details && <dl className="account-facts">
      <div><dt>Subscription</dt><dd>{billing ? billing.active ? "Active" : "Inactive" : "Unknown"}{billing?.interval ? ` · ${billing.interval}` : ""}</dd></div>
      <div><dt>{billing?.willRenew === false ? "Access ends" : "Next renewal"}</dt><dd>{(billing?.willRenew === false ? billing.expiresAt : billing?.renewsAt) ? recordDate((billing?.willRenew === false ? billing.expiresAt : billing?.renewsAt)!) : "Unknown"}</dd></div>
      {workspace && <><div><dt>Workspace members</dt><dd>{directory?.total ?? "Unknown"}</dd></div><div><dt>Purchased seats</dt><dd>{seats ? seats.reduce((sum, line) => sum + line.purchased, 0) : "Unknown"}</dd></div></>}
    </dl>}
    {onStart && !stage && <p className="hint">Fetch once for <strong>{subscription.login}</strong>. A temporary Chrome window opens for sign-in and closes after the fetch.</p>}
    {stage && <p className="hint" role="status">{stage === "starting" ? "Opening Chrome…" : stage === "reading" ? "Reading this account’s billing…" : <>Sign in as <strong>{subscription.login}</strong> in the opened Chrome window. Return here when ready.</>}</p>}
    <div className="management-actions">{onStart && !stage && <button type="button" disabled={busy} onClick={onStart}>Fetch billing</button>}{stage === "login" && <button type="button" onClick={onRead}>I’m signed in · fetch billing</button>}{stage && <button type="button" onClick={onCancel}>Cancel</button>}<a href={providerUrl} target="_blank" rel="noreferrer">{openai ? "Open billing page ↗" : "Open provider ↗"}</a>{workspace && openai && <a href="https://chatgpt.com/admin/members" target="_blank" rel="noreferrer">Open members ↗</a>}</div>
    {openai && !onStart && <p className="hint">Connect this account’s usage login before fetching billing.</p>}
    {subscription.billingError && <p className="error" role="status">{subscription.billingError.message}<span className="last-attempt hint">Last attempt: {new Date(subscription.billingError.at).toLocaleString()}{hasData ? ". Showing saved billing." : ""}</span></p>}
    {details && <p className="hint">Billing last checked <time dateTime={details.observedAt}>{new Date(details.observedAt).toLocaleString()}</time></p>}
    <SectionStatus label="Subscription" section={details?.billing} />
    {invoices && <div className="table-scroll"><table className="org-table"><caption>Recent invoices · actual charges</caption><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td>{recordDate(invoice.createdAt)}</td><td>{invoice.description}</td><td>{invoiceMoney(invoice)}</td><td>{invoice.status}</td></tr>)}</tbody></table>{invoices.length === 0 && <p className="hint">No recent invoices returned.</p>}</div>}
    <SectionStatus label="Invoices" section={details?.invoices} />
    {workspace && <>
      {seats && <div className="table-scroll"><table className="org-table"><caption>Seats</caption><thead><tr><th>Type</th><th>Purchased</th><th>Assigned</th><th>Available</th></tr></thead><tbody>{seats.map((line) => <tr key={line.type}><td>{line.label}</td><td>{line.purchased}</td><td>{line.assigned ?? "Unknown"}</td><td>{line.available ?? "Unknown"}</td></tr>)}</tbody></table></div>}
      <SectionStatus label="Seats" section={details?.seats} />
      {directory && <div className="table-scroll"><table className="org-table"><caption>Members · {directory.total}</caption><thead><tr><th>Member</th><th>Role</th><th>Seat</th></tr></thead><tbody>{directory.members.map((member) => <tr key={member.id}><td>{member.name && <span className="member-name">{member.name}</span>}{member.email}</td><td>{member.role ?? "Unknown"}</td><td>{member.seat ?? "Unknown"}</td></tr>)}</tbody></table></div>}
      <SectionStatus label="Members" section={details?.directory} />
    </>}
  </section>;
}
function SectionStatus({ label, section }: { label: string; section: SyncSection<unknown> | undefined }) {
  if (!section) return null;
  return <>{section.error && <p className="error">{label}: {section.error}{section.data !== null ? " Showing the last successful sync." : ""}</p>}{section.updatedAt && <p className="hint">{label} synced {new Date(section.updatedAt).toLocaleString()}</p>}</>;
}
function recordDate(value: string): string { return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); }
