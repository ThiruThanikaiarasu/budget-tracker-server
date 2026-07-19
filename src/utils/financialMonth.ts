import { User } from "../models/User.js";

// India Standard Time is a fixed UTC+5:30 offset (no DST). All "today" and
// financial-month boundaries are computed against IST explicitly, regardless
// of the server process's own timezone — the server runs on Vercel, whose
// serverless functions default to UTC, which would otherwise misclassify
// "today"/"this month" for up to 5.5 hours around IST midnight.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The real UTC instant for 00:00:00.000 IST at the given (year, 0-indexed month, day).
 *  Accepts out-of-range month/day and normalizes them the same way Date.UTC does
 *  (e.g. day 0 = last day of the previous month, month 12 = January next year). */
function istDayStart(year: number, monthIdx: number, day: number): Date {
  return new Date(Date.UTC(year, monthIdx, day, 0, 0, 0, 0) - IST_OFFSET_MS);
}

/** Number of days in the given (year, 0-indexed month) — a calendar fact, TZ-irrelevant. */
function daysInMonth(year: number, monthIdx: number): number {
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
}

/** { year, month (1-indexed), day } as seen on an IST wall clock for the given instant
 *  (defaults to now), independent of the server process's own timezone. */
function istCalendarFields(instant: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function getFinancialMonthRange(month: string, startDay: number) {
  const [year, m] = month.split("-").map(Number);

  if (startDay <= 1) {
    const dim = daysInMonth(year, m - 1);
    return {
      start: istDayStart(year, m - 1, 1),
      end: new Date(istDayStart(year, m - 1, dim + 1).getTime() - 1),
      daysInPeriod: dim,
    };
  }

  const prevMonthIdx = m - 2;
  const prevLastDay = daysInMonth(year, prevMonthIdx);
  // Anchor the start on the PREVIOUS financial month's own end (its last day,
  // clamped to how many days that calendar month actually has) plus one day.
  // This guarantees months are contiguous with no overlap/gap even when a
  // short month (e.g. Feb) can never reach `startDay` — the short month just
  // keeps its own last day as its end, and the next month starts right after
  // it (date-overflow rolls forward automatically, e.g. Feb 28 + 1 day
  // becomes Mar 1).
  const prevClampedEndDay = Math.min(startDay - 1, prevLastDay);
  const start = istDayStart(year, prevMonthIdx, prevClampedEndDay + 1);

  const thisMonthIdx = m - 1;
  const thisLastDay = daysInMonth(year, thisMonthIdx);
  const clampedEndDay = Math.min(startDay - 1, thisLastDay);
  // "End" = 1ms before the next day's IST midnight, i.e. 23:59:59.999 IST of
  // the last day in the period.
  const end = new Date(istDayStart(year, thisMonthIdx, clampedEndDay + 1).getTime() - 1);

  // +1 ms folded into the numerator (not added after rounding) so this counts
  // whole calendar days inclusively without an off-by-one.
  const daysInPeriod = Math.round((end.getTime() - start.getTime() + 1) / 86400000);

  return { start, end, daysInPeriod };
}

export function getCurrentFinancialMonth(startDay: number): string {
  return getFinancialMonthForDate(new Date(), startDay);
}

/** "YYYY-MM-DD" for the given instant's IST calendar date. */
export function formatISTDateStr(instant: Date): string {
  const f = istCalendarFields(instant);
  return `${f.year}-${String(f.month).padStart(2, "0")}-${String(f.day).padStart(2, "0")}`;
}

export function buildPeriodDays(
  start: Date,
  daysInPeriod: number
): { date: string; dayOfWeek: number }[] {
  const days: { date: string; dayOfWeek: number }[] = [];
  for (let i = 0; i < daysInPeriod; i++) {
    // Add whole days as fixed 86400000ms steps (not local setDate/getDate),
    // since IST has no DST — this stays correct regardless of server TZ.
    const instant = new Date(start.getTime() + i * 86400000);
    // dayOfWeek in IST terms: derive from the IST-shifted instant's UTC day.
    const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
    days.push({ date: formatISTDateStr(instant), dayOfWeek: shifted.getUTCDay() });
  }
  return days;
}

export async function getUserStartDay(userId: string): Promise<number> {
  const user = await User.findById(userId)
    .select("financialMonthStartDay")
    .lean<{ financialMonthStartDay?: number }>();
  return user?.financialMonthStartDay || 1;
}

/** Returns the financial month ("YYYY-MM") that a given instant falls in, as seen on an IST wall clock. */
export function getFinancialMonthForDate(date: Date, startDay: number): string {
  const f = istCalendarFields(date);
  if (startDay <= 1) {
    return `${f.year}-${String(f.month).padStart(2, "0")}`;
  }
  // If day >= startDay, this date belongs to the NEXT calendar month's financial period.
  let year = f.year;
  let month = f.month;
  if (f.day >= startDay) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Days remaining in the period from today (inclusive, in IST) to periodEnd (inclusive). Min 1. */
export function getDaysLeftInPeriod(today: Date, periodEnd: Date): number {
  const f = istCalendarFields(today);
  const startOfTodayIST = istDayStart(f.year, f.month - 1, f.day);
  const diff = Math.floor((periodEnd.getTime() - startOfTodayIST.getTime()) / 86400000) + 1;
  return Math.max(1, diff);
}

/** The UTC instant for 00:00:00.000 IST "today" (or for a given instant's IST calendar day). */
export function startOfISTDay(instant: Date = new Date()): Date {
  const f = istCalendarFields(instant);
  return istDayStart(f.year, f.month - 1, f.day);
}

/** The UTC instant for 23:59:59.999 IST "today" (or for a given instant's IST calendar day). */
export function endOfISTDay(instant: Date = new Date()): Date {
  return new Date(startOfISTDay(instant).getTime() + 86400000 - 1);
}
