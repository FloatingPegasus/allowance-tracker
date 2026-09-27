export interface BillingSchedule {
  anchorDate: string;
  interval?: "monthly" | "annual";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || year > 9998) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function isBillingSchedule(value: unknown): value is BillingSchedule {
  return !!value && typeof value === "object" && !Array.isArray(value) && "anchorDate" in value && parseDate(value.anchorDate) !== null && (!("interval" in value) || value.interval === "monthly" || value.interval === "annual");
}

export function nextBilling(schedule: BillingSchedule, now: Date): { date: Date; days: number } | null {
  const anchor = parseDate(schedule.anchorDate);
  if (!anchor || !isBillingSchedule(schedule) || !Number.isFinite(now.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const occurrence = (year: number, month: number) => new Date(year, month, Math.min(anchor.getDate(), new Date(year, month + 1, 0).getDate()));
  let date = anchor;
  if (date < today) {
    if (schedule.interval === "annual") {
      date = occurrence(today.getFullYear(), anchor.getMonth());
      if (date < today) date = occurrence(today.getFullYear() + 1, anchor.getMonth());
    } else {
      date = occurrence(today.getFullYear(), today.getMonth());
      if (date < today) date = occurrence(today.getFullYear(), today.getMonth() + 1);
    }
  }
  const calendarDay = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return { date, days: Math.round((calendarDay(date) - calendarDay(today)) / 86_400_000) };
}
