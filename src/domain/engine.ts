import type { Intent, ModelLane, ProviderId, Subscription, WindowKind } from "./types";

/** Seats at or above this are held back while any open seat can take the work. */
export const PROTECT_AT = 70;

/** A frontier session under this many points is not "burning" the bar. */
export const AFFORDABLE_BITE = 10;

const HELD_PROVIDERS = new Set<ProviderId>(["codex", "chatgpt"]);

export const INTENTS: Record<Intent, { label: string; hint: string; min: number; max: number }> = {
  spare: { label: "Light work", hint: "Smallest bite outside Codex", min: 1, max: 2 },
  balanced: { label: "Coding", hint: "Strong models, Sol's pool held", min: 3, max: 3 },
  frontier: { label: "Best model", hint: "Highest quality a seat can afford", min: 4, max: 5 },
};

export interface TightWindow {
  kind: WindowKind;
  label: string;
  effectiveShare: number;
  remaining: number;
  usedPercent: number;
}

export interface LaneView {
  subscription: Subscription;
  lane: ModelLane;
  /** Points the busiest gated bar moves for one focused session. */
  bite: number;
  sessions: number;
  fullness: number;
  protected: boolean;
  tightest: TightWindow;
}

/**
 * Allowances are windows, not wallets.
 * Bite is how many points one session moves a bar on that seat.
 * Bigger seats (Premium, Max) move fewer points for the same model.
 * Hold Codex keeps that shared pool for frontier work.
 */
export function assessLane(subscription: Subscription, lane: ModelLane): LaneView | null {
  let bite = 0;
  let sessions = Number.POSITIVE_INFINITY;
  let fullness = 0;
  let protectedSeat = false;
  let tightest: TightWindow | null = null;
  let gated = false;
  let tightestSessions = Number.POSITIVE_INFINITY;

  for (const window of subscription.windows) {
    const share = lane.shares[window.kind];
    if (share == null) continue;
    gated = true;
    const weight = window.capacityWeight > 0 ? window.capacityWeight : 1;
    const effectiveShare = share / weight;
    const remaining = Math.max(0, 100 - window.usedPercent);
    if (effectiveShare <= 0 || remaining + 1e-9 < effectiveShare) return null;
    if (window.usedPercent >= PROTECT_AT) protectedSeat = true;
    bite = Math.max(bite, effectiveShare);
    if (remaining / effectiveShare < tightestSessions) {
      tightestSessions = remaining / effectiveShare;
      tightest = {
        kind: window.kind,
        label: window.label,
        effectiveShare,
        remaining,
        usedPercent: window.usedPercent,
      };
    }
    sessions = Math.min(sessions, remaining / effectiveShare);
    fullness = Math.max(fullness, window.usedPercent);
  }

  if (!gated || !tightest || !Number.isFinite(sessions)) return null;
  return {
    subscription,
    lane,
    bite,
    sessions,
    fullness,
    protected: protectedSeat,
    tightest,
  };
}

export function outlook(subscription: Subscription): Array<{ lane: ModelLane; view: LaneView | null }> {
  return subscription.lanes.map((lane) => ({ lane, view: assessLane(subscription, lane) }));
}

function laneKey(view: LaneView): string {
  return `${view.subscription.id}:${view.lane.id}`;
}

function byBite(a: LaneView, b: LaneView): number {
  return (
    a.bite - b.bite ||
    a.fullness - b.fullness ||
    b.lane.quality - a.lane.quality ||
    b.sessions - a.sessions ||
    a.subscription.id.localeCompare(b.subscription.id) ||
    a.lane.id.localeCompare(b.lane.id)
  );
}

function byQuality(a: LaneView, b: LaneView): number {
  return b.lane.quality - a.lane.quality || byBite(a, b);
}

function unique(views: LaneView[]): LaneView[] {
  const seen = new Set<string>();
  const result: LaneView[] = [];
  for (const view of views) {
    const key = laneKey(view);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(view);
  }
  return result;
}

export interface Ranked {
  pick: LaneView | null;
  alternatives: LaneView[];
  relaxedHold: boolean;
}

export function rank(subscriptions: Subscription[], intent: Intent, holdCodex: boolean): Ranked {
  const band = INTENTS[intent];
  let pool: LaneView[] = [];
  for (const subscription of subscriptions) {
    if (subscription.readingsKnown === false) continue;
    for (const lane of subscription.lanes) {
      if (lane.surface !== "agent") continue;
      if (lane.quality < band.min || lane.quality > band.max) continue;
      const view = assessLane(subscription, lane);
      if (view) pool.push(view);
    }
  }

  let relaxedHold = false;
  if (holdCodex && intent !== "frontier") {
    const outside = pool.filter((view) => !HELD_PROVIDERS.has(view.subscription.provider));
    if (outside.length > 0) pool = outside;
    else relaxedHold = pool.length > 0;
  }

  const open = pool.filter((view) => !view.protected);
  if (open.length > 0) pool = open;

  const sorted = intent === "frontier" ? sortFrontier(pool) : pool.slice().sort(byBite);
  const pick = sorted[0] ?? null;
  const rest = pool.filter((view) => !pick || laneKey(view) !== laneKey(pick)).sort(byBite);
  const alternatives = unique([...(pick ? sorted.slice(1) : []), ...rest]).slice(0, 2);
  return { pick, alternatives, relaxedHold };
}

function sortFrontier(pool: LaneView[]): LaneView[] {
  const affordable = pool.filter((view) => view.bite <= AFFORDABLE_BITE);
  const source = affordable.length > 0 ? affordable : pool;
  return source.slice().sort(byQuality);
}
