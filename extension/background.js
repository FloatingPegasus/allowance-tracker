import { readAccount } from "./reader.js";
const allowed = new Set(["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"]);
const active = new Map();
const lastStarted = new Map();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let url;
  try { url = new URL(sender.url); } catch { return; }
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || !allowed.has(url.origin) || url.pathname !== "/" || message?.type !== "allowance:sync") return;
  if (!Array.isArray(message.accounts) || !message.accounts.length || message.accounts.length > 25 || !message.accounts.every((item) => item && typeof item.accountId === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(item.accountId) && typeof item.email === "string" && item.email.trim().length > 0 && item.email.length < 200 && typeof item.workspace === "boolean")) return;
  const keys = message.accounts.map((item) => `${item.accountId}:${item.email.toLowerCase()}`);
  if (new Set(keys).size !== keys.length) return;
  const run = async () => {
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    return Promise.all(message.accounts.map(async (account) => {
      const key = `${account.accountId}:${account.email.toLowerCase()}`;
      if (!active.has(key)) {
        const now = Date.now();
        for (const [id, started] of lastStarted) if (now - started >= 60_000) lastStarted.delete(id);
        if (lastStarted.has(key)) return { accountId: account.accountId, email: account.email, error: "Wait a minute before syncing this account again." };
        lastStarted.set(key, now);
        active.set(key, (async () => {
        let failure = null;
        for (const tab of tabs) {
          if (!tab.id || new URL(tab.url).pathname.startsWith("/auth/")) continue;
          try {
            const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", func: readAccount, args: [account] });
            const value = results[0]?.result;
            if (typeof value?.error === "string") failure = value.error;
            if (value?.accountId === account.accountId) return value;
          } catch { /* Try another signed-in tab; never expose page or token errors. */ }
        }
        return { accountId: account.accountId, email: account.email, error: failure ?? `Switch ChatGPT to ${account.email} in this Chrome profile, then check billing for this entry again.` };
        })().finally(() => active.delete(key)));
      }
      return active.get(key);
    }));
  };
  run().then((results) => reply({ results }), () => reply({ error: "The browser connection could not read ChatGPT. Retry with a signed-in ChatGPT tab open." }));
  return true;
});
