const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ExpiryStatus = "normal" | "soon" | "today" | "overdue";

export function assertLocalDate(value: string): string {
  const match = LOCAL_DATE.exec(value);
  if (!match) throw new Error(`无效日期：${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`无效日期：${value}`);
  }
  return value;
}

function parts(value: string): { year: number; month: number; day: number } {
  assertLocalDate(value);
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split("-").map(Number);
  return { year, month, day };
}

function format(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addCalendarMonthsClamped(
  value: string,
  monthsToAdd: number,
  anchorDay?: number,
): string {
  if (!Number.isInteger(monthsToAdd)) throw new Error("月份增量必须是整数");
  const current = parts(value);
  const preferredDay = anchorDay ?? current.day;
  if (!Number.isInteger(preferredDay) || preferredDay < 1 || preferredDay > 31) {
    throw new Error("账期日必须在 1 到 31 之间");
  }
  const absoluteMonth = current.year * 12 + current.month - 1 + monthsToAdd;
  const year = Math.floor(absoluteMonth / 12);
  const month = ((absoluteMonth % 12) + 12) % 12 + 1;
  return format(year, month, Math.min(preferredDay, daysInMonth(year, month)));
}

export function differenceInCalendarDays(later: string, earlier: string): number {
  const left = parts(later);
  const right = parts(earlier);
  const leftTime = Date.UTC(left.year, left.month - 1, left.day);
  const rightTime = Date.UTC(right.year, right.month - 1, right.day);
  return Math.round((leftTime - rightTime) / 86_400_000);
}

export function classifyExpiry(
  dueOn: string,
  today: string,
  soonDays: number,
): ExpiryStatus {
  const remaining = differenceInCalendarDays(dueOn, today);
  if (remaining < 0) return "overdue";
  if (remaining === 0) return "today";
  if (remaining <= soonDays) return "soon";
  return "normal";
}

export function localDateNow(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

export function localDateFromInstant(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`无效时间：${value}`);
  return localDateNow(instant);
}
