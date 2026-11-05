import { TZDate } from "@date-fns/tz";

/** A calendar date as "YYYY-MM-DD". */
export type DateStr = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function parseDate(date: DateStr): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The instant a calendar date starts (local midnight) in a time zone. */
export function startOfDay(date: DateStr, timeZone: string): Date {
  const [y, mo, d] = parseDate(date);
  return new Date(new TZDate(y, mo - 1, d, timeZone).getTime());
}

/** The instant of a local wall-clock time ("HH:MM") on a date. */
export function atLocalTime(
  date: DateStr,
  time: string,
  timeZone: string,
): Date {
  const [y, mo, d] = parseDate(date);
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return new Date(
    new TZDate(y, mo - 1, d, Number(m[1]), Number(m[2]), timeZone).getTime(),
  );
}

/** Calendar arithmetic on date strings, independent of time zones. */
export function addDays(date: DateStr, days: number): DateStr {
  const [y, mo, d] = parseDate(date);
  const utc = new Date(Date.UTC(y, mo - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** The calendar date an instant falls on in a time zone. */
export function toDateStr(instant: Date, timeZone: string): DateStr {
  const z = new TZDate(instant.getTime(), timeZone);
  const mm = String(z.getMonth() + 1).padStart(2, "0");
  const dd = String(z.getDate()).padStart(2, "0");
  return `${z.getFullYear()}-${mm}-${dd}`;
}

/** Local wall-clock time "HH:MM" of an instant in a time zone. */
export function toTimeStr(instant: Date, timeZone: string): string {
  const z = new TZDate(instant.getTime(), timeZone);
  return `${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}`;
}

/** "8:00 AM" style time for event titles. */
export function formatTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(instant);
}

export function compareDates(a: DateStr, b: DateStr): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
