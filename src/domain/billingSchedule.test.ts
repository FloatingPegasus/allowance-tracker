import { describe, expect, it } from "vitest";
import { isBillingSchedule, nextBilling } from "./billingSchedule";
import { applyLiveAccount, createProviderAccount } from "./applyLogin";
import { parseState } from "./storage";
import type { AppState } from "./types";

function next(anchorDate: string, now: Date) {
  const result = nextBilling({ anchorDate }, now)!;
  return { day: [result.date.getFullYear(), result.date.getMonth() + 1, result.date.getDate()], days: result.days };
}

describe("monthly billing dates", () => {
  it("includes today and advances on the following day without editing the anchor", () => {
    expect(next("2026-08-27", new Date(2026, 8, 27, 23, 59))).toEqual({ day: [2026, 9, 27], days: 0 });
    expect(next("2026-08-27", new Date(2026, 8, 28))).toEqual({ day: [2026, 10, 27], days: 29 });
    expect(next("2026-12-31", new Date(2027, 0, 1))).toEqual({ day: [2027, 1, 31], days: 30 });
  });

  it("uses the last day of short months then restores the original day", () => {
    expect(next("2026-01-31", new Date(2026, 1, 1))).toEqual({ day: [2026, 2, 28], days: 27 });
    expect(next("2026-01-31", new Date(2026, 2, 1))).toEqual({ day: [2026, 3, 31], days: 30 });
    expect(next("2024-01-31", new Date(2024, 1, 1))).toEqual({ day: [2024, 2, 29], days: 28 });
    expect(next("2024-02-29", new Date(2025, 1, 1))).toEqual({ day: [2025, 2, 28], days: 27 });
  });

  it("keeps a future start date and counts calendar days across daylight saving", () => {
    expect(next("2027-01-15", new Date(2026, 11, 31))).toEqual({ day: [2027, 1, 15], days: 15 });
    expect(next("2026-03-09", new Date(2026, 2, 7, 23, 30))).toEqual({ day: [2026, 3, 9], days: 2 });
  });

  it("rejects malformed dates at both the form and import boundary", () => {
    const state: AppState = { version: 1, intent: "balanced", holdCodex: false, subscriptions: [createProviderAccount("chatgpt", "a", new Date())] };
    for (const value of [null, {}, { anchorDate: "2026-02-29" }, { anchorDate: "2026-04-31" }, { anchorDate: "2026-09-00" }, { anchorDate: "2026-13-01" }, { anchorDate: "2026-01-01T00:00:00Z" }, { anchorDate: 123 }, { anchorDate: "0099-01-01" }]) {
      expect(isBillingSchedule(value)).toBe(false);
      if (value !== null) expect(parseState(JSON.stringify({ ...state, subscriptions: [{ ...state.subscriptions[0], billingSchedule: value }] }))).toBeNull();
    }
    expect(nextBilling({ anchorDate: "bad" }, new Date())).toBeNull();
  });

  it("preserves schedules through refresh/export but clears them for a different account", () => {
    const now = new Date(2026, 8, 27);
    const account = { email: "one@example.test", accountId: "one", plan: "Business", workspaceName: "Team", role: "owner" as const, windows: [{ kind: "weekly" as const, usedPercent: 40 }], bankedResets: null };
    const initial: AppState = { version: 1, intent: "balanced", holdCodex: false, subscriptions: [createProviderAccount("chatgpt", "a", now)] };
    const state = applyLiveAccount(initial, "a", account, now);
    state.subscriptions[0].billingSchedule = { anchorDate: "2026-01-31" };
    const refreshed = applyLiveAccount(state, "a", account, now);
    expect(parseState(JSON.stringify(refreshed))?.subscriptions[0].billingSchedule).toEqual({ anchorDate: "2026-01-31" });
    expect(applyLiveAccount(state, "a", { ...account, accountId: "other" }, now).subscriptions[0].billingSchedule).toBeNull();
  });
});

it("tracks annual anniversaries, including leap days, rather than adding 365 days", () => {
  const schedule = { anchorDate: "2024-02-29", interval: "annual" as const };
  for (const [year, month, day] of [[2025, 2, 28], [2028, 2, 29], [2029, 2, 28]]) {
    const result = nextBilling(schedule, new Date(year, 0, 1))!;
    expect([result.date.getFullYear(), result.date.getMonth() + 1, result.date.getDate()]).toEqual([year, month, day]);
  }
  expect(nextBilling(schedule, new Date(2025, 2, 1))?.date).toEqual(new Date(2026, 1, 28));
  expect(isBillingSchedule({ anchorDate: "2026-01-01", interval: "30-days" })).toBe(false);
  expect(isBillingSchedule({ anchorDate: "2026-01-01", interval: "annual" })).toBe(true);
});
