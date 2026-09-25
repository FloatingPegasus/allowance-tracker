import { describe, expect, it } from "vitest";
import { maskKey, parseGoUsage } from "./opencode";

const sample = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-09-25T03:07:04.169Z" },
    weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-09-28T00:00:00.000Z" },
    monthly: { status: "ok", percent: 95, resetsAt: "2026-10-12T17:47:53.000Z" },
  },
};

describe("OpenCode Go usage", () => {
  it("maps the three console bars and keeps a rate limit", () => {
    const reading = parseGoUsage(sample, "oc_sk_7282");
    expect(reading?.provider).toBe("opencode");
    expect(reading?.windows).toEqual([
      { kind: "five_hour", usedPercent: 0, resetsAt: "2026-09-25T03:07:04.169Z", status: "ok" },
      { kind: "weekly", usedPercent: 100, resetsAt: "2026-09-28T00:00:00.000Z", status: "rate-limited" },
      { kind: "monthly", usedPercent: 95, resetsAt: "2026-10-12T17:47:53.000Z", status: "ok" },
    ]);
  });

  it("masks the secret tail of a key", () => {
    expect(maskKey("oc_sk_7282b22d001a_secret")).toBe("oc_sk_7282…");
  });
});
