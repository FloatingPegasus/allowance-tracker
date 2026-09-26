import { mapSubscription } from "./mutate";
import type { LiveAccount } from "./openaiLogin";
import { attachDetectedPlan } from "./org";
import { validReading } from "./validate";
import type { AppState, Subscription, UsageReading, WindowKind } from "./types";

export type ConnectProvider = "chatgpt" | "claude" | "opencode";
const LABELS: Record<WindowKind, string> = { five_hour: "5-hour", weekly: "Weekly", monthly: "Monthly", pro_messages: "Pro messages" };

export function createProviderAccount(provider: ConnectProvider, id: string, now: Date): Subscription {
  const kinds: WindowKind[] = provider === "opencode" ? ["five_hour", "weekly", "monthly"] : ["five_hour", "weekly"];
  return {
    id, templateId: `detect-${provider}`, provider, plan: "", seat: null,
    login: provider === "chatgpt" ? "ChatGPT account" : provider === "claude" ? "Claude account" : "OpenCode account",
    notes: "Account details come from the provider.",
    windows: kinds.map((kind) => ({ kind, label: LABELS[kind], usedPercent: 0, capacityWeight: 1, resetsAt: null, hint: "Use the reading and reset time shown by your provider." })),
    lanes: [], bankedResets: 0, bankedResetExpiresAt: null, supportsBankedResets: false,
    updatedAt: now.toISOString(), readingSource: "manual", readingsKnown: false,
  };
}

export function applyLiveAccount(state: AppState, subscriptionId: string, account: LiveAccount, now: Date): AppState {
  const seat = state.subscriptions.find((item) => item.id === subscriptionId);
  if (!seat) return state;
  const reading = { windows: account.windows, ...(account.bankedResets != null ? { bankedResets: account.bankedResets } : {}) };
  if (account.windows.length && (!validReading(reading) || account.windows.some((window) => window.usedPercent == null))) return state;
  const sameIdentity = (!account.email || account.email === seat.login) && (!account.accountId || account.accountId === seat.providerAccountId);
  const plan = account.plan ?? (seat.readingSource === "live" && sameIdentity ? seat.plan : "");
  const next = mapSubscription(state, subscriptionId, (item) => ({
    ...item, plan, readingSource: "live", readingsKnown: account.windows.length > 0, updatedAt: now.toISOString(), usageCheckedAt: now.toISOString(),
    login: account.email || item.login,
    ...(!sameIdentity ? { billing: null, workspaceId: null, browserDetails: undefined, browserSyncError: undefined, billingError: undefined } : {}),
    ...(account.windows.length ? {
      windows: account.windows.map((window) => ({
        kind: window.kind, label: LABELS[window.kind], usedPercent: window.usedPercent ?? 0,
        capacityWeight: 1,
        resetsAt: window.resetsAt ?? null, hint: "Reported by your provider.",
        ...(window.status ? { status: window.status } : {}),
      })),
    } : {}),
    ...(account.bankedResets != null ? { bankedResets: account.bankedResets, supportsBankedResets: true } : {}),
  }));
  return attachDetectedPlan(next, subscriptionId, { plan, workspaceName: account.workspaceName, role: account.role, accountId: account.accountId }, now);
}

export function applyGoReading(state: AppState, id: string, reading: UsageReading, now: Date): AppState {
  return applyLiveAccount(state, id, { email: null, accountId: null, plan: null, role: null, workspaceName: null, windows: reading.windows, bankedResets: null }, now);
}
