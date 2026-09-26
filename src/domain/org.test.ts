import { describe, expect, it } from "vitest";
import { createSeed } from "../test/legacyCatalog";
import { attachDetectedPlan, attachKnownPlans } from "./org";
import { applyLiveAccount, createProviderAccount } from "./applyLogin";
import { parseState } from "./storage";
import type { AppState, BillingCycle } from "./types";

const now = new Date("2026-09-25T00:00:00Z");
const initial = (): AppState => ({ version: 1, intent: "balanced", holdCodex: true, subscriptions: [createProviderAccount("chatgpt", "biz", now)] });
const input = { plan: "Business", workspaceName: "Example workspace", role: "admin" as const, accountId: "workspace-1" };
const billing: BillingCycle = { amount: 240, currency: "USD", interval: "annual", renewsAt: "2027-09-25T12:00:00Z", source: "manual", checkedAt: now.toISOString() };

describe("account and workspace tracking", () => {
  it("does not manufacture invoices, members, seats or permissions from plan presets", () => {
    expect(attachKnownPlans(createSeed(now), now)).toEqual(createSeed(now));
    const state = attachDetectedPlan(initial(), "biz", input, now);
    expect(state.subscriptions[0].accountRole).toBe("admin");
    expect(state.subscriptions[0].seat).toBeNull();
    expect(state.workspaces?.[0]).toMatchObject({ billing: null, members: [], seats: [], role: null });
    const personal = attachDetectedPlan(initial(), "biz", { ...input, plan: "Pro", workspaceName: null, role: null }, now);
    expect(personal.subscriptions[0].billing).toBeUndefined();
  });

  it("keeps identically named workspaces separate and roles specific to each login", () => {
    let state = initial();
    state.subscriptions.push(createProviderAccount("chatgpt", "second", now));
    state = attachDetectedPlan(state, "biz", input, now);
    state = attachDetectedPlan(state, "second", { ...input, role: "member", accountId: "workspace-2" }, now);
    expect(state.workspaces).toHaveLength(2);
    expect(state.subscriptions[0].workspaceId).not.toBe(state.subscriptions[1].workspaceId);
    state = attachDetectedPlan(state, "second", { ...input, role: "member" }, now);
    expect(state.subscriptions[0].workspaceId).toBe(state.subscriptions[1].workspaceId);
    expect(state.subscriptions.map((s) => s.accountRole)).toEqual(["admin", "member"]);
  });

  it("keeps manual records through usage refresh and export without marking them provider verified", () => {
    const state = attachDetectedPlan(initial(), "biz", input, now);
    const workspace = state.workspaces![0];
    workspace.billing = billing;
    workspace.directorySource = "manual";
    workspace.memberCount = 4;
    workspace.purchasedSeats = 5;
    workspace.members = [{ id: "person", label: "Person", role: null, seat: "ChatGPT", weeklyPercent: null }];
    const refreshed = applyLiveAccount(state, "biz", { email: "admin@example.com", accountId: "workspace-1", plan: "Business", workspaceName: "Renamed", role: "admin", windows: [{ kind: "weekly", usedPercent: 39 }], bankedResets: null }, now);
    expect(refreshed.workspaces![0].billing).toEqual(billing);
    expect(refreshed.workspaces![0].members).toEqual(workspace.members);
    expect(parseState(JSON.stringify(refreshed))).toEqual(refreshed);
  });

  it("validates unknown vs zero, annual billing, and malformed tracking records", () => {
    const state = attachDetectedPlan(initial(), "biz", input, now);
    state.workspaces![0].billing = { ...billing, amount: 0, renewsAt: null, interval: null };
    expect(parseState(JSON.stringify(state))).not.toBeNull();
    for (const patch of [{ amount: -1 }, { currency: "bad currency" }, { renewsAt: "bad" }, { source: "live" }]) {
      const invalid = structuredClone(state);
      Object.assign(invalid.workspaces![0].billing!, patch);
      expect(parseState(JSON.stringify(invalid))).toBeNull();
    }
    state.workspaces![0].memberCount = 1.5;
    expect(parseState(JSON.stringify(state))).toBeNull();
  });

  it("preserves legacy records on load without trusting inferred roles", () => {
    const state = initial();
    state.subscriptions[0].plan = "Business";
    state.subscriptions[0].billing = { amount: 25, interval: "monthly", renewsAt: "2026-10-17T00:00:00Z", checkedAt: now.toISOString() };
    const restored = attachKnownPlans(state, now);
    expect(restored.subscriptions[0].billing).toEqual(state.subscriptions[0].billing);
    expect(restored.subscriptions[0].accountRole).toBeNull();
    expect(parseState(JSON.stringify(restored))).toEqual(restored);
  });
});

it("keeps personal profile names out of workspace administration", () => {
  const state = applyLiveAccount(initial(), "biz", { email: "me@example.com", accountId: "personal", plan: "Pro", role: null, workspaceName: "My profile", windows: [], bankedResets: null }, now);
  expect(state.subscriptions[0].workspaceId).toBeNull();
  expect(state.workspaces).toEqual([]);
});
