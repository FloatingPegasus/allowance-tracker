import { useId, useState } from "react";
import { isBillingSchedule, nextBilling } from "../domain/billingSchedule";
import type { BillingSchedule } from "../domain/billingSchedule";

export function BillingDate({ schedule, now, onChange }: {
  schedule: BillingSchedule | null;
  now: Date;
  onChange: (schedule: BillingSchedule | null) => void;
}) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [error, setError] = useState("");
  const next = schedule ? nextBilling(schedule, now) : null;
  return <div className="billing-date">
    {editing ? <form onSubmit={(event) => {
      event.preventDefault();
      const value = { anchorDate: draft, interval };
      if (!isBillingSchedule(value)) { setError("Enter a valid billing date."); return; }
      onChange(value);
      setEditing(false);
    }}>
      <label htmlFor={inputId}>Billing date</label>
      <div className="billing-fields">
        <input id={inputId} type="date" required min="1000-01-01" max="9998-12-31" value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} />
        <select aria-label="Billing frequency" value={interval} onChange={(event) => setInterval(event.target.value === "annual" ? "annual" : "monthly")}>
          <option value="monthly">Monthly</option>
          <option value="annual">Yearly</option>
        </select>
        <button type="submit">Save date</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        {schedule && <button type="button" className="danger" onClick={() => { onChange(null); setEditing(false); }}>Remove date</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form> : <div className="billing-summary">
      {next && <p>Expected billing <strong>{next.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</strong><span className="hint">{next.days === 0 ? "Today" : next.days === 1 ? "Tomorrow" : `In ${next.days} days`} · {schedule?.interval === "annual" ? "Yearly" : "Monthly"} · Manual</span></p>}
      <button type="button" className="text-button" onClick={() => { setDraft(schedule?.anchorDate ?? ""); setInterval(schedule?.interval ?? "monthly"); setError(""); setEditing(true); }}>{schedule ? "Edit billing date" : "Set billing date"}</button>
    </div>}
  </div>;
}
