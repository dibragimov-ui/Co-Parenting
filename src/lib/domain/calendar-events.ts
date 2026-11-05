import { createHash } from "node:crypto";
import { addDays, formatTime, startOfDay, toDateStr, type DateStr } from "./dates";
import { deriveDays } from "./days";
import { HANDOFF_LABELS, type HandoffInfo, type Segment } from "./types";

export interface Member {
  parentId: string;
  name: string;
  /** Google Calendar event color id, "1" to "11". */
  colorId: string;
}

interface BaseEvent {
  /** Stable identity used to match this event with the one in Google. */
  key: string;
  summary: string;
  description: string;
  colorId: string;
}

export interface AllDayEvent extends BaseEvent {
  type: "allDay";
  startDate: DateStr;
  /** Exclusive, as Google Calendar expects. */
  endDate: DateStr;
}

export interface TimedEvent extends BaseEvent {
  type: "timed";
  start: Date;
  end: Date;
  location: string | null;
}

export type DesiredEvent = AllDayEvent | TimedEvent;

export const HANDOFF_EVENT_MINUTES = 15;

export interface BuildOptions {
  timeZone: string;
  members: Member[];
  appUrl: string;
}

function label(handoff: HandoffInfo | null): string {
  return handoff?.kind ? ` (${HANDOFF_LABELS[handoff.kind]})` : "";
}

/**
 * Turns the approved timeline into the events the family calendar should
 * contain: one all-day event per run of full days, one all-day event per
 * parent on split days, and a short timed event at each handoff.
 */
export function buildDesiredEvents(
  segments: Segment[],
  { timeZone, members, appUrl }: BuildOptions,
): DesiredEvent[] {
  if (segments.length === 0) return [];
  const byId = new Map(members.map((m) => [m.parentId, m]));
  const member = (id: string): Member =>
    byId.get(id) ?? { parentId: id, name: "Unknown", colorId: "8" };
  const description = `Managed by the co-parenting app. Edits made here are overwritten; propose changes at ${appUrl}`;

  const sorted = [...segments].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const from = toDateStr(sorted[0].start, timeZone);
  const to = addDays(toDateStr(new Date(sorted.at(-1)!.end.getTime() - 1), timeZone), 1);
  const days = deriveDays(sorted, timeZone, from, to);

  const events: DesiredEvent[] = [];

  // Runs of full days with the same parent.
  let run: { parentId: string; start: DateStr; end: DateStr } | null = null;
  const flush = () => {
    if (!run) return;
    const m = member(run.parentId);
    events.push({
      type: "allDay",
      key: `full:${run.start}`,
      summary: `Kids with ${m.name}`,
      description,
      colorId: m.colorId,
      startDate: run.start,
      endDate: run.end,
    });
    run = null;
  };
  for (const day of days) {
    if (day.kind === "full" && day.parentId) {
      if (run && run.parentId === day.parentId && run.end === day.date) {
        run.end = addDays(day.date, 1);
      } else {
        flush();
        run = { parentId: day.parentId, start: day.date, end: addDays(day.date, 1) };
      }
      continue;
    }
    flush();
    if (day.kind !== "split") continue;
    const dayStart = startOfDay(day.date, timeZone).getTime();
    const dayEnd = startOfDay(addDays(day.date, 1), timeZone).getTime();
    day.parts.forEach((part, i) => {
      if (!part.parentId) return;
      const m = member(part.parentId);
      const fromStart = part.start.getTime() === dayStart;
      const toEnd = part.end.getTime() === dayEnd;
      const next = day.parts[i + 1];
      let summary: string;
      if (fromStart && !toEnd) {
        summary = `Kids with ${m.name} until ${formatTime(part.end, timeZone)}${next?.parentId ? label(next.handoff) : ""}`;
      } else if (!fromStart && toEnd) {
        summary = `Kids with ${m.name} from ${formatTime(part.start, timeZone)}${label(part.handoff)}`;
      } else {
        summary = `Kids with ${m.name} ${formatTime(part.start, timeZone)} to ${formatTime(part.end, timeZone)}`;
      }
      events.push({
        type: "allDay",
        key: `part:${day.date}:${i}`,
        summary,
        description,
        colorId: m.colorId,
        startDate: day.date,
        endDate: addDays(day.date, 1),
      });
    });
  }
  flush();

  // A timed event at each handoff.
  sorted.forEach((s, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const contiguous = prev && prev.end.getTime() === s.start.getTime();
    const atMidnight =
      startOfDay(toDateStr(s.start, timeZone), timeZone).getTime() ===
      s.start.getTime();
    const isHandoff =
      s.handoff.kind !== null || (contiguous && prev.parentId !== s.parentId && !atMidnight);
    if (!isHandoff) return;
    const to = member(s.parentId);
    const what = s.handoff.kind ? HANDOFF_LABELS[s.handoff.kind] : "handoff";
    const who = contiguous ? `${member(prev.parentId).name} to ${to.name}` : `to ${to.name}`;
    events.push({
      type: "timed",
      key: `handoff:${s.start.toISOString()}`,
      summary: `Handoff: ${what} (${who})`,
      description: s.handoff.note ? `${s.handoff.note}\n\n${description}` : description,
      colorId: to.colorId,
      start: s.start,
      end: new Date(s.start.getTime() + HANDOFF_EVENT_MINUTES * 60_000),
      location: s.handoff.location,
    });
  });

  return events;
}

export function eventHash(e: DesiredEvent): string {
  const body =
    e.type === "allDay"
      ? [e.type, e.summary, e.description, e.colorId, e.startDate, e.endDate]
      : [e.type, e.summary, e.description, e.colorId, e.start.toISOString(), e.end.toISOString(), e.location];
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export interface SyncedEventRecord {
  key: string;
  googleEventId: string;
  contentHash: string;
}

export interface SyncPlan {
  inserts: DesiredEvent[];
  updates: { event: DesiredEvent; googleEventId: string }[];
  deletes: SyncedEventRecord[];
}

/** What must change in Google so it matches the desired events. */
export function planSync(
  desired: DesiredEvent[],
  existing: SyncedEventRecord[],
): SyncPlan {
  const have = new Map(existing.map((r) => [r.key, r]));
  const want = new Set(desired.map((e) => e.key));
  const plan: SyncPlan = { inserts: [], updates: [], deletes: [] };
  for (const e of desired) {
    const rec = have.get(e.key);
    if (!rec) plan.inserts.push(e);
    else if (rec.contentHash !== eventHash(e)) {
      plan.updates.push({ event: e, googleEventId: rec.googleEventId });
    }
  }
  for (const r of existing) if (!want.has(r.key)) plan.deletes.push(r);
  return plan;
}
