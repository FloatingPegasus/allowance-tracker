import type { BrowserDetails } from "./billingRecords.ts";

export type ProviderId = "codex" | "chatgpt" | "claude" | "opencode";

export type WindowKind = "five_hour" | "weekly" | "monthly" | "pro_messages";

export type Intent = "spare" | "balanced" | "frontier";

export type ReadingSource = "seed" | "manual" | "extension" | "live";

export type Surface = "agent" | "chat";

export type OrgRole = "member" | "admin" | "owner";

export type OrgSeat = "Standard" | "Premium" | "Team";

export interface OrgMember {
  id: string;
  label: string;
  role: OrgRole | null;
  seat: string | null;
  weeklyPercent: number | null;
}

export interface OrgSeatLine {
  seat: OrgSeat;
  purchased: number;
  assigned: number;
  /** USD per seat for the billing interval. */
  unitAmount: number;
}

export interface BillingCycle {
  interval: "monthly" | "annual" | null;
  renewsAt: string | null;
  /** Recorded total charge in currency (USD for legacy exports). */
  amount: number | null;
  currency?: string;
  source?: "manual" | "seed";
  checkedAt: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  provider: ProviderId;
  /** Legacy workspace role; current login roles live on Subscription.accountRole. */
  role: OrgRole | null;
  directorySource?: "manual";
  directoryUpdatedAt?: string;
  memberCount?: number | null;
  purchasedSeats?: number | null;
  members: OrgMember[];
  seats: OrgSeatLine[];
  billing: BillingCycle | null;
}

export interface QuotaWindow {
  kind: WindowKind;
  label: string;
  /** 0–100, matching the provider's usage bar. */
  usedPercent: number;
  /**
   * Size of this seat's bucket relative to the lane's reference plan.
   * Premium Codex weekly is 5. A session's bite is share / capacityWeight.
   */
  capacityWeight: number;
  resetsAt: string | null;
  hint: string;
  /** Provider status such as "ok" or "rate-limited", when a live reading sent one. */
  status?: string;
  countUsed?: number;
  countCapacity?: number;
}

export interface ModelLane {
  id: string;
  name: string;
  /** 1 bulk … 5 best. Frontier is 4 and up. */
  quality: number;
  surface: Surface;
  /**
   * Points of a capacityWeight=1 bar that one focused session moves.
   * Estimates, so seats can be compared. Not a bill.
   */
  shares: Partial<Record<WindowKind, number>>;
}

export interface Subscription {
  id: string;
  templateId: string;
  provider: ProviderId;
  plan: string;
  seat: string | null;
  /** Email or account label. Passwords are never stored. */
  login: string;
  notes: string;
  windows: QuotaWindow[];
  lanes: ModelLane[];
  bankedResets: number;
  bankedResetExpiresAt: string | null;
  supportsBankedResets: boolean;
  updatedAt: string;
  usageCheckedAt?: string;
  readingSource: ReadingSource;
  /** False until a bar is entered. Unknown seats stay out of the recommendation. */
  readingsKnown: boolean;
  /** Set for ChatGPT Business and Claude Team. Personal plans use billing instead. */
  workspaceId?: string | null;
  providerAccountId?: string | null;
  accountRole?: OrgRole | null;
  browserDetails?: BrowserDetails;
  browserSyncError?: { at: string; message: string };
  billingError?: { at: string; message: string };
  /** Renewal for a personal plan. Workspace invoices live on the workspace. */
  billing?: BillingCycle | null;
}

export interface AppState {
  version: 1;
  browserSyncEnabled?: boolean;
  intent: Intent;
  /** Light and coding tasks skip Codex / ChatGPT so Sol's pool stays available. */
  holdCodex: boolean;
  subscriptions: Subscription[];
  workspaces?: Workspace[];
}

export interface WindowReading {
  kind: WindowKind;
  usedPercent?: number;
  countUsed?: number;
  resetsAt?: string | null;
  status?: string;
}

/** Normalized provider usage. */
export interface UsageReading {
  subscriptionId?: string;
  login?: string;
  provider?: ProviderId;
  observedAt?: string;
  windows: WindowReading[];
  bankedResets?: number;
}
