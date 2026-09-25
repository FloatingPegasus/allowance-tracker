import { describe, expect, it } from "vitest";
import { createSeed, createSubscription } from "./catalog";
import { decide, fullSentence } from "./present";
import { applyReading } from "./reading";
import { applyBankedReset, mapSubscription } from "./mutate";
import type { AppState, WindowKind } from "./types";

const now = new Date(2026, 8, 25, 3, 8, 0);

function seed(): AppState {
  return createSeed(now);
}

function at(state: AppState, id: string, kind: WindowKind, usedPercent: number): AppState {
  return mapSubscription(state, id, (subscription) => ({
    ...subscription,
    windows: subscription.windows.map((window) => (window.kind === kind ? { ...window, usedPercent } : window)),
  }));
}

describe("allowance", () => {
  it("opens on the sentence the dashboard is for", () => {
    expect(now.getDay()).toBe(5);
    const decision = decide(seed(), now);
    expect(fullSentence(decision)).toBe(
      "Sol weekly resets today (Friday) · Claude 5h 69% left · 2 banked resets · Use Claude Sonnet",
    );
    expect(decision.pick?.subscription.id).toBe("claude-pro");
    expect(decision.why).toContain("Codex stays untouched");
    expect(decision.watch.join(" ")).toContain("standard seat");
    expect(decision.watch.join(" ")).toContain("26% left");
    expect(decision.bank).toContain("Hold them");
  });

  it("names Friday when the Sol reset is not today", () => {
    const saturday = new Date(2026, 8, 26, 12, 0, 0);
    const decision = decide(createSeed(saturday), saturday);
    expect(decision.status).toContain("Sol weekly resets Friday");
    expect(decision.status).not.toContain("today");
  });

  it("switches the model with the kind of work and whether Codex is held", () => {
    const state = seed();
    expect(decide({ ...state, intent: "spare" }, now).pick?.lane.id).toBe("flash");
    expect(decide({ ...state, intent: "spare" }, now).pick?.subscription.id).toBe("go-spare");
    expect(decide({ ...state, intent: "spare", holdCodex: false }, now).pick).toMatchObject({
      lane: { id: "luna" },
      subscription: { id: "codex-premium" },
    });
    expect(decide({ ...state, holdCodex: false }, now).pick).toMatchObject({
      lane: { id: "terra" },
      subscription: { id: "codex-premium" },
    });
    expect(decide({ ...state, intent: "frontier" }, now).pick).toMatchObject({
      lane: { id: "astra" },
      subscription: { id: "codex-premium" },
    });
  });

  it("leaves a hot Claude seat and uses the spare Go sub", () => {
    const decision = decide(at(seed(), "claude-pro", "five_hour", 80), now);
    expect(decision.status).toContain("Claude 5h 20% left");
    expect(decision.pick).toMatchObject({
      lane: { id: "glm" },
      subscription: { id: "go-spare" },
    });
  });

  it("falls through to Opus when premium Codex is full", () => {
    const decision = decide({ ...at(seed(), "codex-premium", "weekly", 100), intent: "frontier" }, now);
    expect(decision.pick).toMatchObject({
      lane: { id: "opus" },
      subscription: { id: "claude-pro" },
    });
  });

  it("applies a banked reset without touching Pro messages", () => {
    const next = mapSubscription(seed(), "codex-standard", (subscription) => applyBankedReset(subscription, now));
    const standard = next.subscriptions.find((subscription) => subscription.id === "codex-standard");
    expect(standard?.bankedResets).toBe(0);
    expect(standard?.windows.find((window) => window.kind === "weekly")?.usedPercent).toBe(0);
    expect(standard?.windows.find((window) => window.kind === "five_hour")?.usedPercent).toBe(0);
    expect(standard?.windows.find((window) => window.kind === "pro_messages")?.countUsed).toBe(4);
    const weekly = new Date(standard?.windows.find((window) => window.kind === "weekly")?.resetsAt ?? 0);
    expect(weekly.getTime() - now.getTime()).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(decide(next, now).status).toContain("1 banked reset");
  });

  it("leaves a new seat out until its bars are set", () => {
    const state = seed();
    const blank = createSubscription({
      templateId: "opencode-go",
      id: "go-new",
      login: "go · travel",
      now,
    });
    const decision = decide({ ...state, subscriptions: [...state.subscriptions, blank] }, now);
    expect(blank.readingsKnown).toBe(false);
    expect(decision.pick?.subscription.id).toBe("claude-pro");
  });

  it("matches an extension reading by login and moves the recommendation", () => {
    const result = applyReading(
      seed(),
      {
        login: "Claude Pro",
        provider: "claude",
        windows: [{ kind: "five_hour", usedPercent: 80 }],
      },
      now,
    );
    expect(result.matched).toBe(true);
    expect(result.state.subscriptions.find((subscription) => subscription.id === "claude-pro")?.readingSource).toBe(
      "extension",
    );
    expect(decide(result.state, now).pick?.lane.id).toBe("glm");

    const current = seed();
    const missed = applyReading(current, { login: "nobody", windows: [{ kind: "weekly", usedPercent: 10 }] }, now);
    expect(missed.matched).toBe(false);
    expect(missed.state).toBe(current);
  });
});
