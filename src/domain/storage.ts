import { attachKnownPlans } from "./org";
import type { AppState, Intent } from "./types";

import { isSubscription, isWorkspace, uniqueIds } from "./validate";

const KEY = "allowance-tracker/v1";

const INTENTS = new Set<Intent>(["spare", "balanced", "frontier"]);

export function emptyState(): AppState {
  return { version: 1, intent: "balanced", holdCodex: false, subscriptions: [] };
}

export function parseState(raw: string): AppState | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const state = value as AppState;
    if (state.browserSyncEnabled !== undefined && typeof state.browserSyncEnabled !== "boolean") return null;
    if (state.version !== 1 || !Array.isArray(state.subscriptions)) return null;
    if (!INTENTS.has(state.intent) || typeof state.holdCodex !== "boolean") return null;
    if (!state.subscriptions.every(isSubscription) || !uniqueIds(state.subscriptions)) return null;
    if (state.workspaces !== undefined && (!Array.isArray(state.workspaces) || !state.workspaces.every(isWorkspace) || !uniqueIds(state.workspaces))) return null;
    return state;
  } catch {
    return null;
  }
}

export function loadState(now = new Date()): AppState {
  if (typeof localStorage === "undefined") return emptyState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const state = parseState(raw);
    return state ? attachKnownPlans(state, now) : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function storageProblem(): string {
  try {
    const raw = localStorage.getItem(KEY);
    return raw && !parseState(raw) ? "Saved accounts could not be read. Import a backup; the original data is unchanged." : "";
  } catch { return "Browser storage is unavailable. Export your changes before closing this tab."; }
}
