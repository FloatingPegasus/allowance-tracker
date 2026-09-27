import type { UsageReading, WindowKind } from "./types.ts";

const USAGE_URL = "/api/opencode/usage";

const WINDOWS: Record<string, WindowKind> = {
  rolling: "five_hour",
  weekly: "weekly",
  monthly: "monthly",
};

export function maskKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 12) return "connected";
  return `${trimmed.slice(0, 10)}…`;
}

export function parseGoUsage(body: unknown, login: string): UsageReading | null {
  if (!body || typeof body !== "object") return null;
  const usage = (body as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;

  const windows: UsageReading["windows"] = [];
  for (const [key, kind] of Object.entries(WINDOWS)) {
    const raw = (usage as Record<string, unknown>)[key];
    if (!raw || typeof raw !== "object") continue;
    const record = raw as { percent?: unknown; usagePercent?: unknown; resetsAt?: unknown; status?: unknown };
    const percent = typeof record.percent === "number" ? record.percent : record.usagePercent;
    if (typeof percent !== "number" || !Number.isFinite(percent)) continue;
    windows.push({
      kind,
      usedPercent: percent,
      resetsAt: typeof record.resetsAt === "string" ? record.resetsAt : null,
      status: typeof record.status === "string" ? record.status : undefined,
    });
  }
  if (windows.length === 0) return null;
  return { login, provider: "opencode", windows };
}

export async function fetchGoUsage(apiKey: string, login: string): Promise<UsageReading> {
  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Accept: "application/json",
        "X-Allowance-Key": apiKey.trim(),
      },
    });
  } catch {
    throw new Error("Couldn't reach OpenCode. Run the app with the dev server so the usage proxy is available.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("OpenCode rejected that key.");
  }
  if (!response.ok) {
    throw new Error(`OpenCode usage returned ${response.status}.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("OpenCode usage was not JSON.");
  }
  const reading = parseGoUsage(body, login);
  if (!reading) throw new Error("OpenCode usage did not include the 5-hour, weekly, and monthly bars.");
  return reading;
}
