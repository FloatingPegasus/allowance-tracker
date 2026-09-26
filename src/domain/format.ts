export function meterTone(usedPercent: number): "ok" | "warn" | "hot" {
  if (usedPercent >= 90) return "hot";
  if (usedPercent >= 70) return "warn";
  return "ok";
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
