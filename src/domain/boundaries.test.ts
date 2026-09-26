import { describe, it, expect } from 'vitest';
import { createSeed } from '../test/legacyCatalog';
import { parseState } from './storage';
import { applyReading, isUsageReading } from './reading';
import { matchesCallback } from './appLoginClient';
const now = new Date('2026-09-25T00:00:00Z');

describe('external data boundaries', () => {
  it('round trips a hydrated export and rejects malformed nested data', () => {
    const state = createSeed(now);
    expect(parseState(JSON.stringify(state))).toEqual(state);
    for (const mutation of [
      (s: typeof state) => { s.subscriptions[0]!.windows = [null as never]; },
      (s: typeof state) => { s.workspaces = {} as never; },
      (s: typeof state) => { s.subscriptions.push(s.subscriptions[0]!); },
      (s: typeof state) => { s.subscriptions[0]!.lanes[0]!.shares.weekly = -2; },
    ]) {
      const broken = structuredClone(state); mutation(broken);
      expect(parseState(JSON.stringify(broken))).toBeNull();
    }
  });
  it('requires valid, matching readings and refuses ambiguous accounts', () => {
    for (const input of [{windows:[null]}, {login:3,windows:[]}, {windows:[{kind:'weekly',usedPercent:NaN}]}, {windows:[{kind:'weekly',usedPercent:10,resetsAt:'bad'}]}]) expect(isUsageReading(input)).toBe(false);
    const state = createSeed(now);
    const id = state.subscriptions[0]!.id;
    const result = applyReading(state, {subscriptionId:id, windows:[{kind:'weekly',usedPercent:32}]}, now);
    expect(result.matched).toBe(true);
    expect(applyReading(state, {subscriptionId:id, windows:[{kind:'weekly',countUsed:3}]}, now).matched).toBe(false);
    expect(result.state.subscriptions[0]!.windows.find(w=>w.kind==='weekly')?.usedPercent).toBe(32);
    expect(applyReading(state, {subscriptionId:'missing',login:state.subscriptions[0]!.login,windows:[{kind:'weekly',usedPercent:1}]}, now).matched).toBe(false);
    state.subscriptions[1]!.login=state.subscriptions[0]!.login;
    expect(applyReading(state, {login:state.subscriptions[0]!.login,windows:[{kind:'weekly',usedPercent:1}]}, now).matched).toBe(false);
  });
  it('rejects missing state and wrong provider in callbacks', () => {
    const pending = {subscriptionId:'x',provider:'openai' as const,state:'expected',verifier:'v',redirectUri:'http://127.0.0.1:1455/auth/callback'};
    expect(matchesCallback(pending,null,'openai')).toBe(false);
    expect(matchesCallback(pending,'expected','claude')).toBe(false);
    expect(matchesCallback(pending,'expected','openai')).toBe(true);
  });
});
