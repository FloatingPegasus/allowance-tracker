import { isBillingSchedule } from "./billingSchedule.ts";
import type { Subscription, Workspace, UsageReading } from "./types.ts";

export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const date = (v: unknown) => str(v) && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || date(v);
const providers = ["codex", "chatgpt", "claude", "opencode"];
const kinds = ["five_hour", "weekly", "monthly", "pro_messages"];
const roles = ["member", "admin", "owner"];
const seats = ["Standard", "Premium", "Team"];
const member = (values: string[], v: unknown) => str(v) && values.includes(v);
export const uniqueIds = (values: { id: string }[]) => values.every((v) => v.id.trim() && !["__proto__", "constructor", "prototype"].includes(v.id)) && new Set(values.map((v) => v.id)).size === values.length;
export const isBilling = (v: unknown) => record(v) && (v.interval === null || member(["monthly", "annual"], v.interval)) && (v.amount === null || num(v.amount)) && nullableDate(v.renewsAt) && nullableDate(v.checkedAt) && (v.source === undefined || member(["manual", "seed"], v.source)) && (v.currency === undefined || (str(v.currency) && /^[A-Z]{3}$/.test(v.currency)));
const optionalCount = (v: unknown) => v == null || (num(v) && Number.isInteger(v));

export function isSubscription(v: unknown): v is Subscription {
  if (!record(v) || !str(v.id) || !str(v.templateId) || !member(providers, v.provider) || !str(v.plan) || !(v.seat === null || str(v.seat)) || !str(v.login) || !str(v.notes)) return false;
  if (!num(v.bankedResets) || !nullableDate(v.bankedResetExpiresAt) || typeof v.supportsBankedResets !== "boolean" || typeof v.readingsKnown !== "boolean" || !date(v.updatedAt) || !member(["seed", "manual", "extension", "live"], v.readingSource)) return false;
  if (v.billingSchedule != null && !isBillingSchedule(v.billingSchedule)) return false;
  if (v.manualBusinessSeat != null && !member(["Standard", "Premium"], v.manualBusinessSeat)) return false;
  if (v.usageCheckedAt !== undefined && !date(v.usageCheckedAt)) return false;
  if (v.billingError !== undefined && (!record(v.billingError) || !date(v.billingError.at) || !str(v.billingError.message) || !v.billingError.message || v.billingError.message.length > 500)) return false;
  if (v.browserSyncError !== undefined && (!record(v.browserSyncError) || !date(v.browserSyncError.at) || !str(v.browserSyncError.message) || !v.browserSyncError.message || v.browserSyncError.message.length > 500)) return false;
  if (v.billing != null && !isBilling(v.billing)) return false;
  if (v.accountRole != null && !member(roles, v.accountRole)) return false;
  if (v.providerAccountId != null && !str(v.providerAccountId)) return false;
  if (v.workspaceId != null && !str(v.workspaceId)) return false;
  if (!Array.isArray(v.windows) || !v.windows.every((w) => record(w) && member(kinds, w.kind) && str(w.label) && num(w.usedPercent) && w.usedPercent <= 100 && num(w.capacityWeight) && w.capacityWeight > 0 && nullableDate(w.resetsAt) && str(w.hint) && (w.status === undefined || str(w.status)) && (w.countUsed === undefined || num(w.countUsed)) && (w.countCapacity === undefined || (num(w.countCapacity) && w.countCapacity > 0)))) return false;
  if (new Set(v.windows.map((w) => w.kind)).size !== v.windows.length) return false;
  if (!Array.isArray(v.lanes) || !v.lanes.every((l) => record(l) && str(l.id) && str(l.name) && num(l.quality) && l.quality >= 1 && l.quality <= 5 && member(["agent", "chat"], l.surface) && record(l.shares) && Object.entries(l.shares).every(([k, n]) => kinds.includes(k) && num(n) && n > 0))) return false;
  return uniqueIds(v.lanes);
}

export function isWorkspace(v: unknown): v is Workspace {
  return record(v) && str(v.id) && str(v.name) && member(providers, v.provider) && (v.role === null || member(roles, v.role)) && (v.billing === null || isBilling(v.billing)) && (v.directorySource === undefined || v.directorySource === "manual") && (v.directoryUpdatedAt === undefined || date(v.directoryUpdatedAt)) && optionalCount(v.memberCount) && optionalCount(v.purchasedSeats) &&
    Array.isArray(v.members) && v.members.every((m) => record(m) && str(m.id) && str(m.label) && (m.role === null || member(roles, m.role)) && (m.seat === null || str(m.seat)) && (m.weeklyPercent === null || (num(m.weeklyPercent) && m.weeklyPercent <= 100))) && uniqueIds(v.members) && (v.directorySource !== "manual" || ((v.memberCount == null || (typeof v.memberCount === "number" && v.memberCount >= v.members.length)) && v.members.every((m) => m.label.trim()))) &&
    Array.isArray(v.seats) && v.seats.every((s) => record(s) && member(seats, s.seat) && num(s.purchased) && num(s.assigned) && num(s.unitAmount));
}

export function validReading(v: unknown): v is UsageReading {
  if (!record(v) || !Array.isArray(v.windows) || !v.windows.length) return false;
  if (v.subscriptionId !== undefined && !str(v.subscriptionId)) return false;
  if (v.login !== undefined && !str(v.login)) return false;
  if (v.provider !== undefined && !member(providers, v.provider)) return false;
  if (v.observedAt !== undefined && !date(v.observedAt)) return false;
  if (v.bankedResets !== undefined && !num(v.bankedResets)) return false;
  return new Set(v.windows.map((w) => record(w) ? w.kind : null)).size === v.windows.length && v.windows.every((w) => record(w) && member(kinds, w.kind) &&
    (w.usedPercent !== undefined || w.countUsed !== undefined) &&
    (w.usedPercent === undefined || (num(w.usedPercent) && w.usedPercent <= 100)) &&
    (w.countUsed === undefined || num(w.countUsed)) && (w.resetsAt === undefined || nullableDate(w.resetsAt)) && (w.status === undefined || str(w.status)));
}
