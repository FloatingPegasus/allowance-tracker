import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { AccountCard } from "../components/AccountCard";
import { BillingPanel } from "../components/BillingPanel";
import { applyLiveAccount, createProviderAccount } from "./applyLogin";
import type { ComponentProps } from "react";

const now = new Date("2026-09-25T00:00:00Z");
const noop = () => {};
const subscription = createProviderAccount("chatgpt", "test", now);
const baseProps: ComponentProps<typeof AccountCard> = { subscription, now, onRemove: noop, apiKeyHint: null, syncing: false, keyError: null, onConnectKey: noop, onRefreshKey: noop, onDisconnectKey: noop, workspace: null, loginProvider: null, signedIn: null, authError: null, onSignIn: noop, onRefreshLogin: noop, onSignOut: noop };

describe("account view", () => {
  it("never shows capacity for an unconnected account with unknown usage", () => {
    const html = renderToStaticMarkup(createElement(AccountCard, baseProps));
    expect(html).toContain("Connect to see your allowance");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("100% left");
  });

  it("keeps a failed read visible without enabling manual overrides or local resets", () => {
    const html = renderToStaticMarkup(createElement(AccountCard, {
      ...baseProps, apiKeyHint: "test", authError: "Connection failed",
      subscription: { ...subscription, readingSource: "live", readingsKnown: true, usageCheckedAt: now.toISOString(), supportsBankedResets: true, bankedResets: 1, windows: [{ ...subscription.windows[0], usedPercent: 95 }] },
    }));
    expect(html).toContain("5% left");
    expect(html).toContain("Refresh failed");
    expect(html).toContain("Showing last saved usage");
    expect(html).not.toContain("Adjust readings");
    expect(html).not.toContain("Record a used reset");
    expect(html).not.toContain("Estimated sessions");
    expect(html).not.toContain("Suggested");
  });
  it("shows remaining percentages and matching accessible meters at both ends of the quota", () => {
    for (const used of [0, 39, 98, 100]) {
      const props: ComponentProps<typeof AccountCard> = { subscription: { ...subscription, readingsKnown: true, windows: [{ kind: "weekly", label: "Weekly", usedPercent: used, capacityWeight: 1, resetsAt: null, hint: "" }] }, now, onRemove: noop, apiKeyHint: null, syncing: false, keyError: null, onConnectKey: noop, onRefreshKey: noop, onDisconnectKey: noop, workspace: null, loginProvider: null, signedIn: null, authError: null, onSignIn: noop, onRefreshLogin: noop, onSignOut: noop };
      const html = renderToStaticMarkup(createElement(AccountCard, props));
      expect(html).toContain(`${100 - used}% left`);
      expect(html).toContain(`aria-valuenow="${100 - used}"`);
      expect(html).toContain(`width:${100 - used}%`);
    }
  });
  it("shows billing even when missing, and never presents legacy estimates as invoices", () => {
    const html = renderToStaticMarkup(createElement(BillingPanel, { subscription: { ...subscription, billing: { amount: 200, interval: "monthly", renewsAt: "2026-10-17", checkedAt: now.toISOString() } }, workspace: null }));
    expect(html).toContain("Open billing page");
    expect(html).not.toContain("Connection required");
    expect(html).not.toContain("extension");
    expect(html).toContain("https://chatgpt.com/settings/billing");
    expect(html).not.toContain("200");
    expect(html).not.toContain("Oct 17");
    expect(html).not.toContain("Refresh billing");
  });
  it("shows the reported role without privilege-changing controls or fabricated members", () => {
    const state = applyLiveAccount({ version: 1, subscriptions: [subscription], intent: "balanced", holdCodex: false }, "test", { email: "admin@example.com", accountId: "ws", plan: "Business", workspaceName: "Test team", role: "admin", windows: [], bankedResets: null }, now);
    const html = renderToStaticMarkup(createElement(BillingPanel, { subscription: state.subscriptions[0], workspace: state.workspaces![0] }));
    expect(html).toContain("admin");
    expect(html).toContain("Open members");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("admin@example.com");
  });
  it("keeps usage timestamps separate from edits and shows one-time billing actions on the entry", () => {
    const state = applyLiveAccount({ version: 1, subscriptions: [subscription], intent: "balanced", holdCodex: false }, "test", { email: "owner@example.test", accountId: "ws", plan: "Business", workspaceName: "Test team", role: "owner", windows: [], bankedResets: null }, now);
    const renamed = { ...state.subscriptions[0], updatedAt: "2026-09-26T00:00:00Z" };
    expect(renamed.usageCheckedAt).toBe(now.toISOString());
    const html = renderToStaticMarkup(createElement(BillingPanel, { subscription: { ...renamed, billingError: { at: now.toISOString(), message: "Sign in as the selected account." }, browserSyncError: { at: now.toISOString(), message: "Old extension error" } }, workspace: null, onStart: noop }));
    expect(html).toContain("Fetch billing");
    expect(html).toContain("You may need to sign in");
    expect(html).toContain("Last attempt:");
    expect(html).toContain("Sign in as the selected account.");
    expect(html).not.toContain("Billing last checked");
    expect(html).not.toContain("Old extension error");
  });
});
