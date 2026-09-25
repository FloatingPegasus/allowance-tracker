import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8").replace('import { readAccount } from "./reader.js";', "");
const account = { accountId: "workspace-test", email: "owner@example.test", workspace: true };
const sender = { id: "extension-test", tab: { id: 1 }, frameId: 0, url: "http://localhost:5173/" };

function worker() {
  const query = vi.fn(async () => [{ id: 2, url: "https://chatgpt.com/" }]);
  const executeScript = vi.fn(async () => [{ result: { ...account, billing: { data: null } } }]);
  let receive!: (message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean | undefined;
  const chrome = { runtime: { id: sender.id, onMessage: { addListener: (listener: typeof receive) => { receive = listener; } } }, tabs: { query }, scripting: { executeScript } };
  runInNewContext(source, { chrome, readAccount: () => undefined, URL, Date, Map, Set });
  return { receive, query, executeScript };
}

describe("extension message boundary", () => {
  it("rejects other origins, paths, extensions, frames and malformed targets before accessing ChatGPT", () => {
    const { receive, query } = worker();
    const message = { type: "allowance:sync", accounts: [account] };
    for (const patch of [{ url: "https://example.test/" }, { url: "http://localhost:9999/" }, { url: "http://localhost:5173/other" }, { id: "other-extension" }, { frameId: 1 }, { tab: null }]) {
      expect(receive(message, { ...sender, ...patch }, vi.fn())).toBeUndefined();
    }
    for (const accounts of [[], [account, account], [{ ...account, accountId: "../other" }], [{ ...account, email: "" }], [{ ...account, workspace: "true" }]]) {
      expect(receive({ ...message, accounts }, sender, vi.fn())).toBeUndefined();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("runs only in the ChatGPT isolated world and throttles repeated reads", async () => {
    const { receive, executeScript } = worker();
    const sync = () => new Promise<unknown>((resolve) => {
      expect(receive({ type: "allowance:sync", accounts: [account] }, sender, resolve)).toBe(true);
    });
    await sync();
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 2 }, world: "ISOLATED", args: [account] }));
    const again = await sync();
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(again).toEqual({ results: [{ accountId: account.accountId, email: account.email, error: "Wait a minute before syncing this account again." }] });
  });
});
