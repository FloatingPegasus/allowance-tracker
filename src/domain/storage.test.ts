import { afterEach, expect, it, vi } from "vitest";
import { emptyState, loadState, storageProblem } from "./storage";

afterEach(() => vi.unstubAllGlobals());

it("starts without demos and does not replace unreadable storage", () => {
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem });
  expect(loadState()).toEqual(emptyState());
  vi.stubGlobal("localStorage", { getItem: () => "unreadable saved data", setItem });
  expect(loadState()).toEqual(emptyState());
  expect(storageProblem()).toContain("original data is unchanged");
  expect(setItem).not.toHaveBeenCalled();
});
