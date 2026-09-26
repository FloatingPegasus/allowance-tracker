import type { AppState, ProviderId, Subscription, WindowKind } from "../domain/types";

// Version 1 exports included model estimates and demo windows. Keep those fields
// in fixtures to exercise import compatibility without shipping planning presets.
export function createSeed(now: Date): AppState {
  const account = (id: string, provider: ProviderId, plan: string, kinds: WindowKind[]): Subscription => ({
    id, provider, plan, templateId: id, login: `${id}@example.test`, seat: null,
    notes: "Legacy preset", readingSource: "seed", readingsKnown: true,
    updatedAt: now.toISOString(), bankedResets: 1, bankedResetExpiresAt: null,
    supportsBankedResets: provider === "codex",
    windows: kinds.map((kind) => ({
      kind, label: kind, usedPercent: 30, capacityWeight: 5,
      resetsAt: new Date(now.getTime() + 86400000).toISOString(), hint: "Legacy preset",
      ...(kind === "pro_messages" ? { countCapacity: 15, countUsed: 4 } : {}),
    })),
    lanes: [{ id: "legacy-model", name: "Legacy model", quality: 3, surface: "agent", shares: { weekly: 3 } }],
  });
  return {
    version: 1, intent: "balanced", holdCodex: true,
    subscriptions: [
      account("codex-standard", "codex", "Business", ["five_hour", "weekly", "pro_messages"]),
      account("codex-premium", "codex", "Business Premium", ["weekly", "pro_messages"]),
      account("claude-pro", "claude", "Pro", ["five_hour", "weekly"]),
      account("go-primary", "opencode", "Go", ["five_hour", "weekly", "monthly"]),
      account("go-spare", "opencode", "Go", ["five_hour", "weekly", "monthly"]),
    ],
  };
}
