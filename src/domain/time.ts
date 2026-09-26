export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function countdown(iso: string, now: Date): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return "due";
  const minutes = Math.round(ms / 60000);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function resetStamp(iso: string, now: Date): string {
  const reset = new Date(iso);
  const time = reset.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = sameDay(reset, now)
    ? "Today"
    : reset.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} ${time} · ${countdown(iso, now)}`;
}
