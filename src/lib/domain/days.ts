import { addDays, startOfDay, type DateStr } from "./dates";
import type { HandoffInfo, Segment } from "./types";

export interface DayPart {
  parentId: string | null; // null = nobody scheduled
  start: Date;
  end: Date;
  /** True when this part begins at a handoff inside the day. */
  startsWithHandoff: boolean;
  handoff: HandoffInfo | null;
}

export type DayKind = "full" | "split" | "unscheduled";

export interface DayInfo {
  date: DateStr;
  kind: DayKind;
  /** The parent for a full day. */
  parentId: string | null;
  /** Ordered parts covering the whole day. */
  parts: DayPart[];
}

/**
 * Splits the timeline into calendar days in the family's time zone.
 * `to` is exclusive.
 */
export function deriveDays(
  segments: Segment[],
  timeZone: string,
  from: DateStr,
  to: DateStr,
): DayInfo[] {
  const sorted = [...segments].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const days: DayInfo[] = [];
  for (let date = from; date < to; date = addDays(date, 1)) {
    const dayStart = startOfDay(date, timeZone);
    const dayEnd = startOfDay(addDays(date, 1), timeZone);
    const parts: DayPart[] = [];
    let cursor = dayStart;
    for (const s of sorted) {
      if (s.end <= dayStart || s.start >= dayEnd) continue;
      const start = s.start > dayStart ? s.start : dayStart;
      const end = s.end < dayEnd ? s.end : dayEnd;
      if (start > cursor) {
        parts.push({
          parentId: null,
          start: cursor,
          end: start,
          startsWithHandoff: false,
          handoff: null,
        });
      }
      const insideDay = s.start > dayStart;
      parts.push({
        parentId: s.parentId,
        start,
        end,
        startsWithHandoff: insideDay,
        handoff: insideDay ? s.handoff : null,
      });
      cursor = end;
    }
    if (cursor < dayEnd) {
      parts.push({
        parentId: null,
        start: cursor,
        end: dayEnd,
        startsWithHandoff: false,
        handoff: null,
      });
    }
    const only = parts.length === 1 ? parts[0] : null;
    days.push({
      date,
      kind: only ? (only.parentId ? "full" : "unscheduled") : "split",
      parentId: only?.parentId ?? null,
      parts,
    });
  }
  return days;
}
