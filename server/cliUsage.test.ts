import { describe, expect, it } from 'vitest';
import { claudeSnapshot, codexSnapshot } from './cliUsage';
const account = { account: { type: 'chatgpt', email: 'example@example.com', planType: 'self_serve_business_prolite' } };
describe('official CLI usage readings', () => {
  it('uses durations and named buckets instead of treating primary as 5-hour', () => {
    const result = codexSnapshot(account, { rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } }, rateLimitsByLimitId: { codex: { primary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1800000000 }, secondary: null }, other: { limitName: 'Review', primary: { usedPercent: 2, windowDurationMins: 60 } } }, rateLimitResetCredits: { availableCount: 3, credits: [{ status: 'available', expiresAt: 1800000000 }] } });
    expect(result.windows.map(w => [w.label, w.usedPercent])).toEqual([['Weekly', 16], ['Review · 1-hour', 2]]);
    expect(result.resetCredits?.count).toBe(3);
    expect(result.plan).toBe('Business');
    expect(result).not.toHaveProperty('seat');
  });
  it('keeps unknown credits distinct from zero and rejects invalid quota values', () => {
    expect(codexSnapshot(account, { rateLimits: { primary: { usedPercent: 0 } } }).resetCredits).toBeNull();
    expect(() => codexSnapshot(account, { rateLimits: { primary: { usedPercent: Number.NaN } } })).toThrow();
    expect(() => codexSnapshot(account, { rateLimits: { primary: { usedPercent: null } } })).toThrow();
  });
  it('retains Claude model-specific quotas without manufacturing missing windows', () => {
    const result = claudeSnapshot({ email: 'user@example.com', organization: 'org' }, { subscription_type: 'pro', rate_limits: { five_hour: { utilization: 35, resets_at: '2026-10-01T00:00:00Z' }, seven_day: null, model_scoped: [{ display_name: 'Model', utilization: 80, resets_at: null }] } });
    expect(result.windows.map(w => [w.label, w.usedPercent])).toEqual([['5-hour', 35], ['Model · Weekly', 80]]);
    expect(() => claudeSnapshot({}, { rate_limits: null })).toThrow();
  });
});
