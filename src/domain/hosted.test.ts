import { expect, it } from "vitest";
import { hostedAccounts } from "./hosted";

const account = { id: "a".repeat(64), accountId: "one", email: "owner@example.test", workspace: false, workspaceName: null, plan: "Pro", role: null };

it("validates hosted account identities and rejects duplicate or malformed responses", () => {
  expect(hostedAccounts([account])).toEqual([account]);
  for (const value of [null, {}, [account, account], [{ ...account, workspace: "false" }], [{ ...account, details: {} }], [{ ...account, billingError: { at: "invalid", message: "failed" } }]]) expect(() => hostedAccounts(value)).toThrow();
});
