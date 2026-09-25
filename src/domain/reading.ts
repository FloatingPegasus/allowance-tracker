import { clampPercent } from "./format";
import type { AppState, Subscription, UsageReading } from "./types";

export { validReading as isUsageReading } from "./validate";
import { validReading } from "./validate";

export function findSubscription(subscriptions: Subscription[], reading: UsageReading): Subscription | undefined {
  if (reading.subscriptionId) {
    const byId = subscriptions.find((subscription) => subscription.id === reading.subscriptionId);
    return byId && (!reading.provider || byId.provider === reading.provider) ? byId : undefined;
  }
  const login = reading.login?.trim().toLowerCase();
  if (!login) return undefined;
  const matches = subscriptions.filter((subscription) => {
    if (subscription.login.trim().toLowerCase() !== login) return false;
    if (reading.provider && subscription.provider !== reading.provider) return false;
    return true;
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function applyReading(
  state: AppState,
  reading: UsageReading,
  now: Date,
  source: "extension" | "live" = "extension",
): { state: AppState; matched: boolean; login: string | null } {
  if (!validReading(reading)) return { state, matched: false, login: null };
  const subscription = findSubscription(state.subscriptions, reading);
  if (!subscription || !reading.windows.some((w) => subscription.windows.some((own) => own.kind === w.kind && (w.usedPercent !== undefined || (w.countUsed !== undefined && own.countCapacity != null))))) return { state, matched: false, login: null };
  if (reading.observedAt && Date.parse(reading.observedAt) < Date.parse(subscription.updatedAt)) return { state, matched: false, login: null };

  const updated = applyReadingToSubscription(subscription, reading, now, source);
  return {
    matched: true,
    login: updated.login,
    state: {
      ...state,
      subscriptions: state.subscriptions.map((item) => (item.id === subscription.id ? updated : item)),
    },
  };
}

function applyReadingToSubscription(
  subscription: Subscription,
  reading: UsageReading,
  now: Date,
  source: "extension" | "live",
): Subscription {
  const windows = subscription.windows.map((window) => {
    const incoming = reading.windows.find((item) => item.kind === window.kind);
    if (!incoming) return window;
    const next = { ...window };
    if (incoming.countUsed != null && window.countCapacity != null) {
      const countUsed = Math.max(0, Math.min(window.countCapacity, Math.round(incoming.countUsed)));
      next.countUsed = countUsed;
      next.usedPercent = (countUsed / window.countCapacity) * 100;
    } else if (incoming.usedPercent != null) {
      next.usedPercent = clampPercent(incoming.usedPercent);
      if (window.countCapacity != null) {
        next.countUsed = Math.round((next.usedPercent / 100) * window.countCapacity);
      }
    }
    if (incoming.resetsAt !== undefined) next.resetsAt = incoming.resetsAt;
    if (incoming.status !== undefined) next.status = incoming.status;
    return next;
  });

  let bankedResets = subscription.bankedResets;
  if (reading.bankedResets != null && Number.isFinite(reading.bankedResets)) {
    bankedResets = Math.max(0, Math.round(reading.bankedResets));
  }

  return {
    ...subscription,
    windows,
    bankedResets,
    bankedResetExpiresAt: bankedResets > 0 ? subscription.bankedResetExpiresAt : null,
    readingSource: source,
    readingsKnown: true,
    updatedAt: reading.observedAt ?? now.toISOString(),
  };
}
