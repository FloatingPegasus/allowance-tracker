import type { BillingSchedule } from './billingSchedule';

export type Provider = 'codex' | 'claude' | 'opencode';
export interface UsageWindow {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}
export interface Snapshot {
  email: string | null;
  identity: string | null;
  plan: string | null;
  windows: UsageWindow[];
  resetCredits: { count: number; expiresAt: string | null } | null;
}
export interface TrackedAccount {
  id: string;
  provider: Provider;
  email: string | null;
  plan: string | null;
  connected: boolean;
  windows: UsageWindow[];
  resetCredits: Snapshot['resetCredits'];
  checkedAt: string | null;
  error: string | null;
  billingSchedule: BillingSchedule | null;
  businessSeat: 'Standard' | 'Premium' | null;
  pendingReset: string | null;
}
export interface SignIn {
  url: string;
  code?: string;
  needsCode: boolean;
  expiresAt: number;
}
export type ResetOutcome = 'reset' | 'alreadyRedeemed' | 'nothingToReset' | 'noCredit';
