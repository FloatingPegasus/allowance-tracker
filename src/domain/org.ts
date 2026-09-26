import type { AppState, OrgRole, Subscription, Workspace } from "./types";

export function attachKnownPlans(state: AppState, now: Date): AppState {
  let next = state;
  for (const subscription of state.subscriptions) {
    if (subscription.readingSource === "seed" || !subscription.plan) continue;
    next = attachDetectedPlan(next, subscription.id, {
      plan: subscription.plan,
      workspaceName: null, role: subscription.accountRole ?? null,
      accountId: subscription.providerAccountId ?? null,
    }, now);
  }
  return next;
}

export function attachDetectedPlan(
  state: AppState,
  subscriptionId: string,
  input: { plan: string; workspaceName: string | null; role: OrgRole | null; accountId?: string | null },
  _now: Date,
): AppState {
  const original = state.subscriptions.find((item) => item.id === subscriptionId);
  if (!original) return state;
  const seat: Subscription = {
    ...original,
    seat: null,
    accountRole: input.role,
    providerAccountId: input.accountId ?? null,
  };
  let workspaces = [...(state.workspaces ?? [])];
  const plan = input.plan.trim().toLowerCase();
  const workspacePlan = original.provider === "claude"
    ? plan === "team" || plan === "enterprise"
    : (original.provider === "chatgpt" || original.provider === "codex") && ["business", "business premium", "team", "enterprise"].includes(plan);
  if (workspacePlan) {
    // Names and plan labels are not workspace identities.
    const id = input.accountId
      ? `workspace:${seat.provider}:${input.accountId}`
      : original.workspaceId ?? `workspace:local:${seat.id}`;
    const existing = workspaces.find((item) => item.id === id);
    const workspace: Workspace = existing
      ? { ...existing, ...(input.workspaceName ? { name: input.workspaceName } : {}) }
      : { id, name: input.workspaceName || "Workspace", provider: seat.provider, role: null, members: [], seats: [], billing: null };
    if (existing) workspaces = workspaces.map((item) => item.id === id ? workspace : item);
    else workspaces.push(workspace);
    seat.workspaceId = id;
  } else {
    seat.workspaceId = null;
  }
  return { ...state, subscriptions: state.subscriptions.map((item) => item.id === seat.id ? seat : item), workspaces };
}
