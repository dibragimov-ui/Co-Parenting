import { startOfDay, toDateStr } from "./domain/dates";

export function formatInstant(d: Date, timeZone: string, opts: { withTime?: boolean } = {}) {
  const midnight = startOfDay(toDateStr(d, timeZone), timeZone).getTime() === d.getTime();
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(opts.withTime !== false && !midnight ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone,
  }).format(d);
}

/** "Tue, Nov 3, 8:00 AM until Fri, Nov 6, 3:00 PM" or "Tue, Nov 3 through Thu, Nov 5". */
export function formatRange(start: Date, end: Date, timeZone: string) {
  const endMidnight = startOfDay(toDateStr(end, timeZone), timeZone).getTime() === end.getTime();
  const startMidnight = startOfDay(toDateStr(start, timeZone), timeZone).getTime() === start.getTime();
  if (startMidnight && endMidnight) {
    const lastDay = new Date(end.getTime() - 1);
    const a = formatInstant(start, timeZone);
    const b = formatInstant(startOfDay(toDateStr(lastDay, timeZone), timeZone), timeZone);
    return a === b ? `all day ${a}` : `${a} through ${b}`;
  }
  if (endMidnight) {
    const lastDay = startOfDay(toDateStr(new Date(end.getTime() - 1), timeZone), timeZone);
    return `${formatInstant(start, timeZone)} through ${formatInstant(lastDay, timeZone)}`;
  }
  return `${formatInstant(start, timeZone)} until ${formatInstant(end, timeZone)}`;
}
