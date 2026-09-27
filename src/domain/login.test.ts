import { describe, expect, it } from "vitest";
import { applyLiveAccount, applyGoReading, createProviderAccount } from "./applyLogin";
import { parseClaudeSnapshot } from "./claudeLogin";
import { claudeAuthorizeUrl } from "./claudeLogin";
import { openaiAuthorizeUrl, parseOpenAiSnapshot, readChatGptAccountId } from "./openaiLogin";
import { createSeed } from "../test/legacyCatalog";

const now = new Date(2026, 8, 25, 3, 57, 0);

describe("app logins", () => {
  it("builds a ChatGPT authorize URL with the Codex client and PKCE", () => {
    const url = new URL(
      openaiAuthorizeUrl({
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        state: "state-1",
        challenge: "challenge-1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("builds a Claude authorize URL back to this app's callback", () => {
    const url = new URL(
      claudeAuthorizeUrl({
        redirectUri: "http://localhost:4545/callback",
        state: "state-2",
        challenge: "challenge-2",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://claude.ai/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4545/callback");
    expect(url.searchParams.get("client_id")).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
  });

  it("reads the ChatGPT account id from an id token payload", () => {
    const payload = btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } }));
    expect(readChatGptAccountId(`x.${payload}.y`)).toBe("acct-1");
  });

  it("maps a business usage snapshot onto the seat that signed in", () => {
    const account = parseOpenAiSnapshot(
      {
        email: "owner@example.com",
        account_id: "acct-1",
        plan_type: "self_serve_business_prolite",
        rate_limit: {
          primary_window: { used_percent: 9, limit_window_seconds: 604800, reset_at: 1790871014 },
          secondary_window: null,
        },
        rate_limit_reset_credits: { available_count: 1 },
      },
      {
        accounts: [
          { id: "acct-1", account_user_role: "account-owner", structure: "workspace", plan_type: "self_serve_business_prolite", name: "Example Workspace" },
        ],
      },
    );
    expect(account.plan).toBe("Business");
    expect(account.role).toBe("owner");
    expect(account.windows.map((window) => window.kind)).toEqual(["weekly"]);
    const seeded = createSeed(now);
    const next = applyLiveAccount(seeded, "codex-standard", account, now);
    const seat = next.subscriptions.find((item) => item.id === "codex-standard");
    expect(seat?.login).toBe("owner@example.com");
    expect(seat?.readingSource).toBe("live");
    expect(seat?.windows.find((window) => window.kind === "weekly")?.usedPercent).toBe(9);
    expect(seat?.bankedResets).toBe(1);
    expect(seat?.accountRole).toBe("owner");
  });

  it("maps Claude session and weekly bars", () => {
    const account = parseClaudeSnapshot(
      {
        five_hour: { utilization: 0, resets_at: null },
        seven_day: { utilization: 18, resets_at: "2026-09-30T05:00:00.000Z" },
      },
      { account: { email: "ada@example.com", uuid: "acct-c", has_claude_pro: true, has_claude_max: false }, organization: { name: "Ada" } },
    );
    expect(account.email).toBe("ada@example.com");
    expect(account.plan).toBe("Pro");
    const seeded = createSeed(now);
    const seat = applyLiveAccount(seeded, "claude-pro", account, now).subscriptions.find((item) => item.id === "claude-pro");
    expect(seat?.login).toBe("ada@example.com");
    expect(seat?.windows.find((window) => window.kind === "five_hour")?.usedPercent).toBe(0);
    expect(seat?.windows.find((window) => window.kind === "weekly")?.usedPercent).toBe(18);
  });
});


describe("provider-first setup", () => {
  function initial(provider: "chatgpt" | "claude" | "opencode") {
    return { version: 1 as const, intent: "balanced" as const, holdCodex: true, subscriptions: [createProviderAccount(provider, "new", now)] };
  }

  it("starts without a guessed plan, billing, reset date or known usage", () => {
    for (const provider of ["chatgpt", "claude", "opencode"] as const) {
      const account = initial(provider).subscriptions[0];
      expect(account.plan).toBe("");
      expect(account.readingsKnown).toBe(false);
      expect(account.billing).toBeUndefined();
      expect(account.lanes).toEqual([]);
      expect(account.windows.every((window) => window.resetsAt === null)).toBe(true);
    }
  });

  it("detects plan and identity and replaces guessed windows with only reported windows", () => {
    const account = parseOpenAiSnapshot({ email: "me@example.com", plan_type: "business_premium", rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 604800, reset_at: 1790871014 } } }, null);
    const next = applyLiveAccount(initial("chatgpt"), "new", account, now);
    const result = next.subscriptions[0];
    expect(result?.plan).toBe("Business");
    expect(result?.login).toBe("me@example.com");
    expect(result?.windows.map((window) => window.kind)).toEqual(["weekly"]);
    expect(result?.windows[0]?.usedPercent).toBe(42);
    expect(result?.lanes.some((lane) => lane.surface === "chat")).toBe(false);
    expect(result?.readingsKnown).toBe(true);
    expect(result?.billing).toBeNull();
    expect(next.workspaces?.[0]?.name).toBe("Workspace");
    expect(next.workspaces?.[0]?.billing).toBeNull();
    expect(next.workspaces?.[0]?.members).toEqual([]);
  });

  it("does not invent a personal Pro invoice from its plan", () => {
    const account = parseOpenAiSnapshot(
      {
        email: "pro@example.com",
        plan_type: "pro",
        rate_limit: { primary_window: { used_percent: 98, limit_window_seconds: 604800, reset_at: 1790871014 } },
      },
      null,
    );
    const next = applyLiveAccount(initial("chatgpt"), "new", account, now);
    expect(next.subscriptions[0]?.plan).toBe("Pro");
    expect(next.subscriptions[0]?.billing).toBeNull();
    expect(next.subscriptions[0]?.workspaceId).toBeNull();
  });

  it("shows unfamiliar plans without inventing model estimates and updates changed plans", () => {
    const snapshot = (plan: string) => parseClaudeSnapshot({ seven_day: { utilization: 20, resets_at: null } }, { account: { email: "me@example.com", has_claude_pro: plan === "Pro" } });
    const pro = applyLiveAccount(initial("claude"), "new", snapshot("Pro"), now);
    expect(pro.subscriptions[0].plan).toBe("Pro");
    expect(pro.subscriptions[0].lanes).toEqual([]);
    const changed = applyLiveAccount(pro, "new", { ...snapshot(""), plan: "Unknown tier" }, now).subscriptions[0];
    expect(changed.plan).toBe("Unknown tier");
    expect(changed.lanes).toEqual([]);
    expect(changed.windows[0].usedPercent).toBe(20);
    const missing = applyLiveAccount(pro, "new", { ...snapshot(""), windows: [] }, now).subscriptions[0];
    expect(missing.readingsKnown).toBe(false);
    expect(missing.readingSource).toBe("live");
  });

  it("does not attach a different workspace's plan to the signed-in account", () => {
    const account = parseOpenAiSnapshot({ account_id: "mine", plan_type: "plus" }, { accounts: [{ id: "other", plan_type: "business_premium", name: "Someone else" }] });
    expect(account.accountId).toBe("mine");
    expect(account.plan).toBe("Plus");
    expect(account.workspaceName).toBeNull();
  });

  it("detects OpenCode windows and ignores malformed live readings", () => {
    const state = initial("opencode");
    const reading = { windows: [{ kind: "weekly" as const, usedPercent: 24, resetsAt: null }] };
    const result = applyGoReading(state, "new", reading, now).subscriptions[0];
    expect(result.windows.map((window) => window.kind)).toEqual(["weekly"]);
    expect(result.windows[0].usedPercent).toBe(24);
    expect(result.readingSource).toBe("live");
    expect(applyGoReading(state, "new", { windows: [{ kind: "weekly", usedPercent: 101 }] }, now)).toBe(state);
    expect(applyGoReading(state, "new", { windows: [{ kind: "weekly", countUsed: 3 }] }, now)).toBe(state);
  });
});

it("accepts roles only from an unambiguous matching workspace and never infers a seat", () => {
  const usage = { account_id: "mine", plan_type: "self_serve_business_prolite" };
  const row = { id: "mine", structure: "workspace", account_user_role: "account-admin" };
  expect(parseOpenAiSnapshot(usage, { accounts: [row] }).role).toBe("admin");
  expect(parseOpenAiSnapshot(usage, { accounts: [{ ...row, id: "other" }] }).role).toBeNull();
  expect(parseOpenAiSnapshot(usage, { accounts: [row, row] }).role).toBeNull();
  expect(parseOpenAiSnapshot({ plan_type: "business" }, { accounts: [row] }).role).toBeNull();
  expect(parseOpenAiSnapshot(usage, { accounts: [{ ...row, account_user_role: "standard" }] }).role).toBeNull();
  expect(parseOpenAiSnapshot({ ...usage, plan_type: "pro" }, { accounts: [{ ...row, structure: "personal" }] }).role).toBeNull();
  expect(parseOpenAiSnapshot({ ...usage, plan_type: "business_premium" }, { accounts: [row] }).plan).toBe("Business");
});
