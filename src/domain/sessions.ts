export type AppLoginProvider = "openai" | "claude";

/** A provider session that belongs to this app, not to the Codex or Claude CLI on the Mac. */
export interface AppLogin {
  provider: AppLoginProvider;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string | null;
  email: string | null;
  plan: string | null;
  workspaceName: string | null;
}

const KEY = "allowance-tracker/sessions";

function isLogin(value: unknown): value is AppLogin {
  if (!value || typeof value !== "object") return false;
  const login = value as AppLogin;
  return (
    (login.provider === "openai" || login.provider === "claude") &&
    typeof login.accessToken === "string" &&
    login.accessToken.length > 0 &&
    typeof login.refreshToken === "string" &&
    typeof login.expiresAt === "number"
  );
}

export function loadSessions(): Record<string, AppLogin> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const sessions: Record<string, AppLogin> = {};
    for (const [id, login] of Object.entries(value)) {
      if (isLogin(login)) {
        sessions[id] = {
          ...login,
          accountId: typeof login.accountId === "string" ? login.accountId : null,
          email: typeof login.email === "string" ? login.email : null,
          plan: typeof login.plan === "string" ? login.plan : null,
          workspaceName: typeof login.workspaceName === "string" ? login.workspaceName : null,
        };
      }
    }
    return sessions;
  } catch {
    return {};
  }
}

export function saveSessions(sessions: Record<string, AppLogin>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    // The sign-in still works until the tab closes if storage is blocked.
  }
}

export function clearSessions(): void {
  localStorage.removeItem(KEY);
}
