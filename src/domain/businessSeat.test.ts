import { expect, it } from "vitest";
import { isChatGptBusiness } from "./businessSeat";
import { applyLiveAccount, createProviderAccount } from "./applyLogin";
import { parseState } from "./storage";
import type { AppState } from "./types";

it("limits manual Standard/Premium tracking to ChatGPT Business", () => {
  const account = createProviderAccount("chatgpt", "a", new Date());
  expect(isChatGptBusiness({ ...account, plan: "Business" })).toBe(true);
  expect(isChatGptBusiness({ ...account, plan: "Business Premium" })).toBe(true);
  expect(isChatGptBusiness({ ...account, plan: "Team" })).toBe(true);
  expect(isChatGptBusiness({ ...account, plan: "Pro" })).toBe(false);
  expect(isChatGptBusiness({ ...account, provider: "claude", plan: "Team" })).toBe(false);
});

it("preserves a manual seat without altering usage, validates it, and clears it on identity change", () => {
  const now = new Date();
  const live = { email: "one@example.test", accountId: "one", plan: "Business", workspaceName: "Team", role: "owner" as const, windows: [{ kind: "weekly" as const, usedPercent: 39 }], bankedResets: null };
  const initial: AppState = { version: 1, intent: "balanced", holdCodex: false, subscriptions: [createProviderAccount("chatgpt", "a", now)] };
  const state = applyLiveAccount(initial, "a", live, now);
  state.subscriptions[0].manualBusinessSeat = "Premium";
  const refreshed = applyLiveAccount(state, "a", live, now);
  expect(refreshed.subscriptions[0].manualBusinessSeat).toBe("Premium");
  expect(refreshed.subscriptions[0].windows[0].usedPercent).toBe(39);
  expect(parseState(JSON.stringify(refreshed))?.subscriptions[0].manualBusinessSeat).toBe("Premium");
  expect(applyLiveAccount(state, "a", { ...live, email: "two@example.test" }, now).subscriptions[0].manualBusinessSeat).toBeNull();
  expect(parseState(JSON.stringify({ ...state, subscriptions: [{ ...state.subscriptions[0], manualBusinessSeat: "Pro" }] }))).toBeNull();
});
