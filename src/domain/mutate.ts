import type { AppState, Subscription, WindowKind } from "./types";
import { clampPercent } from "./format";
import { hoursFrom } from "./time";

export function mapSubscription(
  state: AppState,
  id: string,
  update: (subscription: Subscription) => Subscription,
): AppState {
  return {
    ...state,
    subscriptions: state.subscriptions.map((subscription) => (subscription.id === id ? update(subscription) : subscription)),
  };
}

export function withLogin(subscription: Subscription, login: string, now: Date): Subscription {
  return {
    ...subscription,
    login,
    updatedAt: now.toISOString(),
  };
}

export function withWindow(
  subscription: Subscription,
  kind: WindowKind,
  patch: { usedPercent?: number; countUsed?: number; resetsAt?: string | null },
  now: Date,
): Subscription {
  return {
    ...subscription,
    readingSource: "manual",
    readingsKnown: true,
    updatedAt: now.toISOString(),
    windows: subscription.windows.map((window) => {
      if (window.kind !== kind) return window;
      const next = { ...window };
      if (patch.countUsed != null && window.countCapacity != null) {
        const countUsed = Math.max(0, Math.min(window.countCapacity, Math.round(patch.countUsed)));
        next.countUsed = countUsed;
        next.usedPercent = (countUsed / window.countCapacity) * 100;
      } else if (patch.usedPercent != null) {
        next.usedPercent = clampPercent(patch.usedPercent);
        if (window.countCapacity != null) {
          next.countUsed = Math.round((next.usedPercent / 100) * window.countCapacity);
        }
      }
      if (patch.resetsAt !== undefined) next.resetsAt = patch.resetsAt;
      return next;
    }),
  };
}

export function withBanked(subscription: Subscription, count: number, expiresAt: string | null, now: Date): Subscription {
  const bankedResets = Math.max(0, Math.round(count));
  return {
    ...subscription,
    bankedResets,
    bankedResetExpiresAt: bankedResets > 0 ? expiresAt : null,
    updatedAt: now.toISOString(),
    readingSource: subscription.readingSource === "seed" ? "manual" : subscription.readingSource,
  };
}

/** A full banked reset clears the 5-hour and weekly Codex bars and starts a new weekly period. */
export function applyBankedReset(subscription: Subscription, now: Date): Subscription {
  if (!subscription.supportsBankedResets || subscription.bankedResets <= 0) return subscription;
  if (subscription.bankedResetExpiresAt && Date.parse(subscription.bankedResetExpiresAt) <= now.getTime()) return subscription;
  const weeklyReset = hoursFrom(now, 24 * 7);
  const fiveHourReset = hoursFrom(now, 5);
  const bankedResets = subscription.bankedResets - 1;
  return {
    ...subscription,
    bankedResets,
    bankedResetExpiresAt: bankedResets > 0 ? subscription.bankedResetExpiresAt : null,
    updatedAt: now.toISOString(),
    readingSource: "manual",
    readingsKnown: true,
    windows: subscription.windows.map((window) => {
      if (window.kind !== "weekly" && window.kind !== "five_hour") return window;
      return {
        ...window,
        usedPercent: 0,
        ...(window.countCapacity != null ? { countUsed: 0 } : {}),
        resetsAt: window.kind === "weekly" ? weeklyReset : fiveHourReset,
      };
    }),
  };
}
