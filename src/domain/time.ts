export function hoursFrom(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function nextWeekday(now: Date, weekday: number, hour: number, minute = 0): string {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  let delta = (weekday - next.getDay() + 7) % 7;
  if (delta === 0 && next.getTime() <= now.getTime()) delta = 7;
  next.setDate(next.getDate() + delta);
  return next.toISOString();
}

export function nextMonthDay(now: Date, day: number, hour: number): string {
  const next = new Date(now.getFullYear(), now.getMonth(), day, hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setMonth(next.getMonth() + 1);
  return next.toISOString();
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "today (Friday)", "Friday", or a calendar date once it's past a week. */
export function resetPhrase(iso: string, now: Date): string {
  const reset = new Date(iso);
  const weekday = reset.toLocaleDateString("en-US", { weekday: "long" });
  const hours = (reset.getTime() - now.getTime()) / 36e5;
  if (hours < 0) return "is due";
  if (sameDay(reset, now)) return `today (${weekday})`;
  if (hours < 24 * 7) return weekday;
  return reset.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
