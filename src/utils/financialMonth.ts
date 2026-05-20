import { User } from "../models/User.js";

export function getFinancialMonthRange(month: string, startDay: number) {
  const [year, m] = month.split("-").map(Number);

  if (startDay <= 1) {
    return {
      start: new Date(year, m - 1, 1),
      end: new Date(year, m, 0, 23, 59, 59, 999),
      daysInPeriod: new Date(year, m, 0).getDate(),
    };
  }

  const prevMonthIdx = m - 2;
  const prevLastDay = new Date(year, prevMonthIdx + 1, 0).getDate();
  const clampedStartDay = Math.min(startDay, prevLastDay);
  const start = new Date(year, prevMonthIdx, clampedStartDay);

  const thisMonthIdx = m - 1;
  const thisLastDay = new Date(year, thisMonthIdx + 1, 0).getDate();
  const clampedEndDay = Math.min(startDay - 1, thisLastDay);
  const end = new Date(year, thisMonthIdx, clampedEndDay, 23, 59, 59, 999);

  const daysInPeriod =
    Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

  return { start, end, daysInPeriod };
}

export function getCurrentFinancialMonth(startDay: number): string {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  if (startDay > 1 && now.getDate() >= startDay) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return `${year}-${String(month).padStart(2, "0")}`;
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildPeriodDays(
  start: Date,
  daysInPeriod: number
): { date: string; dayOfWeek: number }[] {
  const days: { date: string; dayOfWeek: number }[] = [];
  for (let i = 0; i < daysInPeriod; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push({ date: formatDateStr(d), dayOfWeek: d.getDay() });
  }
  return days;
}

export async function getUserStartDay(userId: string): Promise<number> {
  const user = await User.findById(userId)
    .select("financialMonthStartDay")
    .lean<{ financialMonthStartDay?: number }>();
  return user?.financialMonthStartDay || 1;
}
