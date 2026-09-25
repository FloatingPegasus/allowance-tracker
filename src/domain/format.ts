export function formatBite(bite: number): string {
  const rounded = bite < 10 ? Math.round(bite * 10) / 10 : Math.round(bite);
  return `${rounded} pts`;
}

export function formatSessions(sessions: number): string {
  const rounded = sessions < 10 ? Math.round(sessions * 10) / 10 : Math.round(sessions);
  return `about ${rounded} ${rounded === 1 ? "session" : "sessions"} left`;
}

export function meterTone(usedPercent: number): "ok" | "warn" | "hot" {
  if (usedPercent >= 90) return "hot";
  if (usedPercent >= 70) return "warn";
  return "ok";
}

export function bankedClause(count: number): string {
  if (count === 0) return "no banked resets";
  if (count === 1) return "1 banked reset";
  return `${count} banked resets`;
}

export function formatMoney(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function remainingPercent(usedPercent: number): number {
  return Math.round(clampPercent(100 - usedPercent));
}

export function remainingLabel(usedPercent: number): string {
  return `${remainingPercent(usedPercent)}% left`;
}

export function seatLine(provider: string, plan: string, seat: string | null): string {
  const names: Record<string, string> = {
    codex: "ChatGPT",
    chatgpt: "ChatGPT",
    claude: "Claude",
    opencode: "OpenCode",
  };
  return [names[provider] ?? provider, plan, seat].filter(Boolean).join(" · ");
}

export function qualityLabel(quality: number): string {
  if (quality >= 5) return "Top";
  if (quality >= 4) return "Frontier";
  if (quality >= 3) return "Strong";
  if (quality >= 2) return "Light";
  return "Bulk";
}
