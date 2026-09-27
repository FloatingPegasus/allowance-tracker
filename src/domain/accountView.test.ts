import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { AccountCard } from "../components/AccountCard";
import { applyLiveAccount, createProviderAccount } from "./applyLogin";
import type { ComponentProps } from "react";

const now = new Date(2026, 8, 25);
const noop = () => {};
const subscription = createProviderAccount("chatgpt", "test", now);
const baseProps: ComponentProps<typeof AccountCard> = { subscription, now, onRemove: noop, onBillingChange: noop, onSeatChange: noop, apiKeyHint: null, syncing: false, keyError: null, onConnectKey: noop, onRefreshKey: noop, onDisconnectKey: noop, workspace: null, loginProvider: null, signedIn: null, authError: null, onSignIn: noop, onRefreshLogin: noop, onSignOut: noop };
const render = (props: Partial<typeof baseProps> = {}) => renderToStaticMarkup(createElement(AccountCard, { ...baseProps, ...props }));

describe("account view", () => {
  it("never shows capacity for an unconnected account with unknown usage", () => {
    const html = render();
    expect(html).toContain("No saved usage");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("100% left");
  });

  it("keeps a failed read visible without manual overrides or local resets", () => {
    const html = render({ apiKeyHint: "test", authError: "Connection failed", subscription: { ...subscription, readingSource: "live", readingsKnown: true, usageCheckedAt: now.toISOString(), windows: [{ ...subscription.windows[0], usedPercent: 95 }] } });
    expect(html).toContain("5% left");
    expect(html).toContain("Refresh failed");
    expect(html).toContain("Last saved usage");
    for (const text of ["Adjust readings", "Record a used reset", "Estimated sessions", "Fetch billing", "Invoices", "Suggested"]) expect(html).not.toContain(text);
  });

  it("shows remaining percentages and matching accessible meters", () => {
    for (const used of [0, 39, 98, 100]) {
      const html = render({ subscription: { ...subscription, readingsKnown: true, windows: [{ ...subscription.windows[0], usedPercent: used }] } });
      expect(html).toContain(`${100 - used}% left`);
      expect(html).toContain(`aria-valuenow="${100 - used}"`);
      expect(html).toContain(`width:${100 - used}%`);
    }
  });

  it("shows only a user-entered schedule and never treats an old invoice as a recurring date", () => {
    const old = { ...subscription, billing: { amount: 200, interval: "monthly" as const, renewsAt: "2026-09-28", checkedAt: now.toISOString() } };
    const html = render({ subscription: old });
    expect(html).toContain("Set billing date");
    expect(html).not.toContain("Expected billing");
    const scheduled = render({ subscription: { ...old, billingSchedule: { anchorDate: "2026-09-28" } } });
    expect(scheduled).toContain("Expected billing");
    expect(scheduled).toContain("In 3 days");
    expect(scheduled).toContain("Manual");
    expect(scheduled).not.toContain("paid");
  });

  it("shows reported workspace roles but omits personal roles and seat guesses", () => {
    const state = applyLiveAccount({ version: 1, subscriptions: [subscription], intent: "balanced", holdCodex: false }, "test", { email: "admin@example.com", accountId: "ws", plan: "Business", workspaceName: "Test team", role: "admin", windows: [], bankedResets: null }, now);
    const html = render({ subscription: state.subscriptions[0], workspace: state.workspaces![0] });
    expect(html).toContain("Workspace role: admin");
    expect(html).not.toContain("Open members");
    const personal = render({ subscription: { ...subscription, readingSource: "live", accountRole: "owner" } });
    expect(personal).not.toContain("Workspace role");
    expect(render({ subscription: { ...subscription, plan: "Business Premium", seat: "Premium" } })).not.toContain("Premium seat · Manual");
  });
});
