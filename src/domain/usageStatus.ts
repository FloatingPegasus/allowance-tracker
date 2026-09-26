import type { Subscription } from "./types";

export function usageStatus(subscription: Subscription, connected: boolean, error: string | null, now: Date): string {
  if (!connected) return "Not connected";
  if (error) return "Refresh failed";
  if (!subscription.readingsKnown || !subscription.windows.length) return "Usage unavailable";
  if (subscription.readingSource !== "live") return "Saved reading";
  const age = now.getTime() - Date.parse(subscription.usageCheckedAt ?? "");
  if (!Number.isFinite(age) || age < 0 || age > 120_000) return "Out of date";
  if (subscription.windows.some((window) => window.resetsAt && Date.parse(window.resetsAt) <= now.getTime())) return "Reset due";
  return "Synced";
}

export function checkedAgo(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return "Check time unavailable";
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes}m ago`;
  if (minutes < 1440) return `Checked ${Math.floor(minutes / 60)}h ago`;
  return `Checked ${Math.floor(minutes / 1440)}d ago`;
}
