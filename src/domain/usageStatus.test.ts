import { describe, expect, it } from "vitest";
import { createProviderAccount } from "./applyLogin";
import { checkedAgo, usageStatus } from "./usageStatus";

const now = new Date("2026-09-26T12:00:00Z");
const fresh = {
  ...createProviderAccount("chatgpt", "test", now),
  readingsKnown: true, readingSource: "live" as const, usageCheckedAt: now.toISOString(),
};

describe("reading freshness", () => {
  it("does not call disconnected, failed, missing or manual readings synced", () => {
    expect(usageStatus(fresh, true, null, now)).toBe("Synced");
    expect(usageStatus(fresh, false, null, now)).toBe("Not connected");
    expect(usageStatus(fresh, true, "Network unavailable", now)).toBe("Refresh failed");
    expect(usageStatus({ ...fresh, readingsKnown: false }, true, null, now)).toBe("Usage unavailable");
    expect(usageStatus({ ...fresh, windows: [] }, true, null, now)).toBe("Usage unavailable");
    expect(usageStatus({ ...fresh, readingSource: "manual" }, true, null, now)).toBe("Saved reading");
  });

  it("expires old readings and never assumes a reset refilled the account", () => {
    for (const usageCheckedAt of [undefined, "invalid", "2026-09-26T11:57:59Z", "2026-09-26T12:01:00Z"]) {
      expect(usageStatus({ ...fresh, usageCheckedAt }, true, null, now)).toBe("Out of date");
    }
    const due = { ...fresh, windows: fresh.windows.map((window) => ({ ...window, usedPercent: 100, resetsAt: now.toISOString() })) };
    expect(usageStatus(due, true, null, now)).toBe("Reset due");
    expect(due.windows[0].usedPercent).toBe(100);
    expect(checkedAgo("2026-09-26T11:56:00Z", now)).toBe("Checked 4m ago");
  });
});
