import type { calendar_v3 } from "googleapis";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, calendarEvents, families } from "@/db/schema";
import {
  buildDesiredEvents,
  eventHash,
  planSync,
  type DesiredEvent,
  type SyncedEventRecord,
} from "./domain/calendar-events";
import { appUrl, calendarClient, googleStatus, type CalendarClient } from "./google";
import { loadMembers, loadSegments } from "./schedule";

const APP_MARKER = "coparentApp";

function toGoogle(e: DesiredEvent, timeZone: string): calendar_v3.Schema$Event {
  const common = {
    summary: e.summary,
    description: e.description,
    colorId: e.colorId,
    extendedProperties: { private: { [APP_MARKER]: "1", coparentKey: e.key } },
  };
  if (e.type === "allDay") {
    return {
      ...common,
      start: { date: e.startDate },
      end: { date: e.endDate },
      transparency: "transparent",
      reminders: { useDefault: false, overrides: [] },
    };
  }
  return {
    ...common,
    start: { dateTime: e.start.toISOString(), timeZone },
    end: { dateTime: e.end.toISOString(), timeZone },
    location: e.location ?? undefined,
    transparency: "transparent",
  };
}

/** Rebuilds our view of an event from Google, to detect edits made there. */
function fromGoogle(g: calendar_v3.Schema$Event): DesiredEvent | null {
  const key = g.extendedProperties?.private?.coparentKey;
  if (!key) return null;
  const base = {
    key,
    summary: g.summary ?? "",
    description: g.description ?? "",
    colorId: g.colorId ?? "",
  };
  if (g.start?.date && g.end?.date) {
    return { ...base, type: "allDay", startDate: g.start.date, endDate: g.end.date };
  }
  if (g.start?.dateTime && g.end?.dateTime) {
    return {
      ...base,
      type: "timed",
      start: new Date(g.start.dateTime),
      end: new Date(g.end.dateTime),
      location: g.location ?? null,
    };
  }
  return null;
}

async function listAppEvents(cal: CalendarClient, calendarId: string) {
  const out: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({
      calendarId,
      privateExtendedProperty: [`${APP_MARKER}=1`],
      showDeleted: false,
      maxResults: 2500,
      pageToken,
    });
    out.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

export interface SyncResult {
  status: "synced" | "skipped" | "failed";
  inserted?: number;
  updated?: number;
  deleted?: number;
  error?: string;
}

/**
 * Makes the family calendar match the approved schedule. Only events the
 * app created are touched. With `full`, events in Google are re-read so
 * edits or deletions made directly in Google Calendar are undone.
 */
export async function syncFamily(
  familyId: string,
  { full = false }: { full?: boolean } = {},
): Promise<SyncResult> {
  const [family] = await db.select().from(families).where(eq(families.id, familyId));
  if (!family) return { status: "skipped", error: "Family not found" };
  if (!family.calendarId || !family.calendarRefreshToken) {
    return { status: "skipped", error: "No calendar connected" };
  }
  const calendarId = family.calendarId;
  const cal = calendarClient(family.calendarRefreshToken);

  try {
    const result = await db.transaction(async (tx) => {
      // One sync per family at a time.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${familyId}))`);

      const [segments, members] = await Promise.all([
        loadSegments(tx, familyId),
        loadMembers(tx, familyId),
      ]);
      const desired = buildDesiredEvents(segments, {
        timeZone: family.timeZone,
        members,
        appUrl: appUrl(),
      });

      let existing: SyncedEventRecord[] = (
        await tx
          .select()
          .from(calendarEvents)
          .where(and(eq(calendarEvents.familyId, familyId), eq(calendarEvents.calendarId, calendarId)))
      ).map((r) => ({ key: r.key, googleEventId: r.googleEventId, contentHash: r.contentHash }));

      if (full) {
        // Trust what Google has, not what we last wrote.
        const remote = await listAppEvents(cal, calendarId);
        const seen = new Set<string>();
        const fresh: SyncedEventRecord[] = [];
        for (const g of remote) {
          const parsed = fromGoogle(g);
          if (!g.id || !parsed || seen.has(parsed.key)) {
            if (g.id) await deleteQuietly(cal, calendarId, g.id); // duplicate or unreadable
            continue;
          }
          seen.add(parsed.key);
          fresh.push({ key: parsed.key, googleEventId: g.id, contentHash: eventHash(parsed) });
        }
        existing = fresh;
        await tx
          .delete(calendarEvents)
          .where(and(eq(calendarEvents.familyId, familyId), eq(calendarEvents.calendarId, calendarId)));
        if (fresh.length) {
          await tx.insert(calendarEvents).values(fresh.map((r) => ({ ...r, familyId, calendarId })));
        }
      }

      const plan = planSync(desired, existing);
      const save = (key: string, googleEventId: string, contentHash: string) =>
        tx
          .insert(calendarEvents)
          .values({ familyId, calendarId, key, googleEventId, contentHash })
          .onConflictDoUpdate({
            target: [calendarEvents.familyId, calendarEvents.calendarId, calendarEvents.key],
            set: { googleEventId, contentHash, updatedAt: new Date() },
          });

      const insert = async (e: DesiredEvent) => {
        const res = await cal.events.insert({ calendarId, requestBody: toGoogle(e, family.timeZone) });
        await save(e.key, res.data.id!, eventHash(e));
      };

      for (const e of plan.inserts) await insert(e);
      for (const { event, googleEventId } of plan.updates) {
        try {
          await cal.events.update({
            calendarId,
            eventId: googleEventId,
            requestBody: toGoogle(event, family.timeZone),
          });
          await save(event.key, googleEventId, eventHash(event));
        } catch (err) {
          const code = googleStatus(err);
          if (code !== 404 && code !== 410) throw err;
          await insert(event); // deleted in Google: put it back
        }
      }
      for (const r of plan.deletes) {
        await deleteQuietly(cal, calendarId, r.googleEventId);
        await tx
          .delete(calendarEvents)
          .where(
            and(
              eq(calendarEvents.familyId, familyId),
              eq(calendarEvents.calendarId, calendarId),
              eq(calendarEvents.key, r.key),
            ),
          );
      }
      return {
        inserted: plan.inserts.length,
        updated: plan.updates.length,
        deleted: plan.deletes.length,
      };
    });

    await db
      .update(families)
      .set({ lastSyncedAt: new Date(), lastSyncError: null })
      .where(eq(families.id, familyId));
    if (result.inserted + result.updated + result.deleted > 0) {
      await db.insert(auditLog).values({ familyId, action: "calendar.synced", details: result, automated: true });
    }
    return { status: "synced", ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(families).set({ lastSyncError: message }).where(eq(families.id, familyId));
    return { status: "failed", error: message };
  }
}

async function deleteQuietly(cal: CalendarClient, calendarId: string, eventId: string) {
  try {
    await cal.events.delete({ calendarId, eventId });
  } catch (err) {
    const code = googleStatus(err);
    if (code !== 404 && code !== 410) throw err;
  }
}

/** Removes every event the app wrote to a calendar (used when switching calendars). */
export async function clearCalendar(familyId: string, calendarId: string, encryptedRefreshToken: string) {
  const cal = calendarClient(encryptedRefreshToken);
  const remote = await listAppEvents(cal, calendarId);
  for (const g of remote) if (g.id) await deleteQuietly(cal, calendarId, g.id);
  await db
    .delete(calendarEvents)
    .where(and(eq(calendarEvents.familyId, familyId), eq(calendarEvents.calendarId, calendarId)));
}
