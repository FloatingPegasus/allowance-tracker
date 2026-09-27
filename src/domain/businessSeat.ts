import type { Subscription } from "./types";

export function isChatGptBusiness(subscription: Subscription): boolean {
  return ["chatgpt", "codex"].includes(subscription.provider) && ["business", "business premium", "team"].includes(subscription.plan.trim().toLowerCase());
}
