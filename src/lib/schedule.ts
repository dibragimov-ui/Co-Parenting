import { and, asc, eq, gte, lte } from "drizzle-orm";
import { custodySegments, familyMembers } from "@/db/schema";
import type { Db, Tx } from "@/db";
import type { Member } from "./domain/calendar-events";
import type { HandoffInfo, Segment } from "./domain/types";

type SegmentRow = typeof custodySegments.$inferSelect;

export function rowToSegment(r: {
  parentId: string;
  startsAt: Date;
  endsAt: Date;
  handoffKind: SegmentRow["handoffKind"];
  handoffLocation: string | null;
  handoffNote: string | null;
}): Segment {
  return {
    parentId: r.parentId,
    start: r.startsAt,
    end: r.endsAt,
    handoff: { kind: r.handoffKind, location: r.handoffLocation, note: r.handoffNote },
  };
}

export function handoffColumns(h: HandoffInfo) {
  return { handoffKind: h.kind, handoffLocation: h.location, handoffNote: h.note };
}

export async function loadSegments(
  q: Db | Tx,
  familyId: string,
  range?: { start: Date; end: Date },
): Promise<Segment[]> {
  const where = range
    ? and(
        eq(custodySegments.familyId, familyId),
        gte(custodySegments.endsAt, range.start),
        lte(custodySegments.startsAt, range.end),
      )
    : eq(custodySegments.familyId, familyId);
  const rows = await q.select().from(custodySegments).where(where).orderBy(asc(custodySegments.startsAt));
  return rows.map(rowToSegment);
}

export async function loadMembers(q: Db | Tx, familyId: string): Promise<Member[]> {
  const rows = await q.select().from(familyMembers).where(eq(familyMembers.familyId, familyId));
  return rows.map((r) => ({ parentId: r.userId, name: r.displayName, colorId: r.colorId }));
}
