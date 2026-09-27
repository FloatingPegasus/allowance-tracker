import type { Snapshot, UsageWindow } from '../src/domain/private.ts';

export const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' && v.length ? v : null;
const percent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const iso = (v: unknown): string | null => {
  const date = typeof v === 'number' ? new Date(v * 1000) : typeof v === 'string' ? new Date(v) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
export function planLabel(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  if (value.startsWith('self_serve_business') || ['business', 'business_premium', 'team'].includes(value)) return 'Business';
  if (['pro', 'plus', 'free', 'max', 'enterprise'].includes(value)) return value[0].toUpperCase() + value.slice(1);
  return value;
}
function durationLabel(minutes: unknown): string {
  if (minutes === 10080) return 'Weekly';
  if (typeof minutes !== 'number' || minutes <= 0) return 'Allowance';
  return minutes % 1440 === 0 ? `${minutes / 1440}-day` : minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`;
}
export function codexSnapshot(accountRaw: unknown, raw: unknown): Snapshot {
  const account = record(record(accountRaw).account);
  if (account.type !== 'chatgpt') throw new Error('Sign in with your ChatGPT subscription.');
  const data = record(raw);
  const multi = record(data.rateLimitsByLimitId);
  const buckets = Object.keys(multi).length ? multi : { codex: data.rateLimits };
  const windows: UsageWindow[] = [];
  for (const [id, value] of Object.entries(buckets)) {
    const bucket = record(value);
    for (const position of ['primary', 'secondary']) {
      const window = record(bucket[position]);
      if (!percent(window.usedPercent)) continue;
      const label = durationLabel(window.windowDurationMins);
      windows.push({ id: `${id}:${position}`, label: id === 'codex' ? label : `${text(bucket.limitName) ?? id} · ${label}`, usedPercent: window.usedPercent, resetsAt: iso(window.resetsAt) });
    }
  }
  if (!windows.length) throw new Error('Codex did not return usage. Try again or reconnect.');
  const reset = record(data.rateLimitResetCredits);
  const count = reset.availableCount;
  const expiries = Array.isArray(reset.credits) ? reset.credits.map(record).filter(row => row.status === 'available').map(row => iso(row.expiresAt)).filter((value): value is string => value !== null).sort() : [];
  const email = text(account.email);
  return {
    email, identity: email ? `${email}:${text(account.planType) ?? ''}` : null,
    plan: planLabel(account.planType), windows,
    resetCredits: typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? { count, expiresAt: expiries[0] ?? null } : null,
  };
}
export function claudeSnapshot(accountRaw: unknown, usageRaw: unknown): Snapshot {
  const account = record(accountRaw);
  const usage = record(usageRaw);
  const limits = record(usage.rate_limits);
  const windows: UsageWindow[] = [];
  const add = (id: string, label: string, raw: unknown) => {
    const row = record(raw);
    if (percent(row.utilization)) windows.push({ id, label, usedPercent: row.utilization, resetsAt: iso(row.resets_at) });
  };
  for (const [id, label] of Object.entries({ five_hour: '5-hour', seven_day: 'Weekly', seven_day_opus: 'Opus · Weekly', seven_day_sonnet: 'Sonnet · Weekly', seven_day_oauth_apps: 'OAuth apps · Weekly' })) add(id, label, limits[id]);
  if (Array.isArray(limits.model_scoped)) limits.model_scoped.forEach((item, index) => add(`model:${index}`, `${text(record(item).display_name) ?? 'Model'} · Weekly`, item));
  if (!windows.length) throw new Error('Claude did not return plan usage. Try again or reconnect.');
  const email = text(account.email);
  const subscription = text(usage.subscription_type);
  return { email, identity: email ? `${email}:${text(account.organization) ?? ''}` : null, plan: subscription ? subscription[0].toUpperCase() + subscription.slice(1) : null, windows, resetCredits: null };
}
