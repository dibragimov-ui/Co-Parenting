import { and, desc, eq, inArray, ne } from "drizzle-orm";
import Link from "next/link";
import { respondAction } from "../actions";
import { MonthGrid, gridRange } from "./month-grid";
import { ProposeForm, type ProposeDefaults } from "./propose-form";
import { db } from "@/db";
import { proposalSegments, proposals } from "@/db/schema";
import { colorHex } from "@/lib/colors";
import { requireFamily } from "@/lib/context";
import { addDays, startOfDay, toDateStr, toTimeStr } from "@/lib/domain/dates";
import { deriveDays } from "@/lib/domain/days";
import { HANDOFF_LABELS } from "@/lib/domain/types";
import { formatInstant, formatRange } from "@/lib/format";
import { loadSegments, rowToSegment } from "@/lib/schedule";

const STATUS_LABEL = {
  pending: "Waiting for approval",
  approved: "Approved",
  declined: "Declined",
  countered: "Countered",
  withdrawn: "Withdrawn",
  stale: "Outdated: the schedule changed first",
} as const;

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const ctx = await requireFamily();
  const { family, members, userId } = ctx;
  const tz = family.timeZone;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const today = toDateStr(new Date(), tz);
  const monthParam = one(sp.month);
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : today.slice(0, 7);
  const { from, to } = gridRange(month);
  const range = { start: startOfDay(from, tz), end: startOfDay(to, tz) };

  const segments = await loadSegments(db, family.id, range);
  const days = deriveDays(segments, tz, from, to);

  const pending = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.familyId, family.id), eq(proposals.status, "pending")))
    .orderBy(desc(proposals.createdAt));
  const recent = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.familyId, family.id), ne(proposals.status, "pending")))
    .orderBy(desc(proposals.createdAt))
    .limit(5);
  const shown = [...pending, ...recent];
  const segRows = shown.length
    ? await db.select().from(proposalSegments).where(inArray(proposalSegments.proposalId, shown.map((p) => p.id)))
    : [];
  const segsOf = (id: string) => segRows.filter((s) => s.proposalId === id).map(rowToSegment);

  const pendingDates = new Set<string>();
  for (const p of pending) {
    for (let d = toDateStr(p.rangeStart, tz); startOfDay(d, tz) < p.rangeEnd; d = addDays(d, 1)) {
      pendingDates.add(d);
    }
  }

  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName ?? "Unknown";
  const other = members.find((m) => m.userId !== userId);

  // Pre-fill the form for a counter-proposal.
  let defaults: ProposeDefaults = { parentId: other?.userId ?? userId };
  const counterId = one(sp.counter);
  const counter = pending.find((p) => p.id === counterId && p.proposedBy !== userId);
  if (counter) {
    const s = segsOf(counter.id)[0];
    const endIsMidnight = startOfDay(toDateStr(counter.rangeEnd, tz), tz).getTime() === counter.rangeEnd.getTime();
    const startIsMidnight = startOfDay(toDateStr(counter.rangeStart, tz), tz).getTime() === counter.rangeStart.getTime();
    defaults = {
      counterOf: counter.id,
      parentId: s?.parentId,
      fromDate: toDateStr(counter.rangeStart, tz),
      fromTime: startIsMidnight ? "" : toTimeStr(counter.rangeStart, tz),
      untilDate: endIsMidnight ? addDays(toDateStr(counter.rangeEnd, tz), -1) : toDateStr(counter.rangeEnd, tz),
      untilTime: endIsMidnight ? "" : toTimeStr(counter.rangeEnd, tz),
      startKind: s?.handoff.kind ?? "",
      startLocation: s?.handoff.location ?? "",
      endKind: counter.trailingHandoffKind ?? "",
      endLocation: counter.trailingHandoffLocation ?? "",
    };
  }

  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T12:00:00Z`),
  );
  const error = one(sp.error);

  return (
    <div className="space-y-6">
      {!other && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          Invite your co-parent from <Link href="/settings" className="font-medium underline">Settings</Link> so you can start agreeing on days.
        </div>
      )}
      {!family.calendarId && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm">
          Connect your shared Google Calendar in <Link href="/settings" className="font-medium underline">Settings</Link> to see approved days there.
        </div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {one(sp.sent) && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Sent. {other?.displayName ?? "Your co-parent"} will see it here and can approve, decline or counter it.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{monthLabel}</h1>
            <div className="ml-auto flex gap-1">
              <Link className="btn-secondary px-3" href={`/calendar?month=${shiftMonth(month, -1)}`} aria-label="Previous month">‹</Link>
              <Link className="btn-secondary px-3" href="/calendar">Today</Link>
              <Link className="btn-secondary px-3" href={`/calendar?month=${shiftMonth(month, 1)}`} aria-label="Next month">›</Link>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {members.map((m) => (
              <span key={m.userId} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: colorHex(m.colorId) }} />
                {m.displayName}
              </span>
            ))}
            <span className="text-gray-500">Blended days have a handoff.</span>
          </div>
          <MonthGrid month={month} days={days} timeZone={tz} today={today} members={members} pendingDates={pendingDates} />
          {family.lastSyncError ? (
            <p className="text-xs text-red-700">Google Calendar sync failed: {family.lastSyncError}</p>
          ) : family.lastSyncedAt ? (
            <p className="text-xs text-gray-500">
              Google Calendar last synced {formatInstant(family.lastSyncedAt, tz)}.
            </p>
          ) : null}
        </section>

        <aside className="space-y-6">
          {shown.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-semibold">Proposals</h2>
              {shown.map((p) => {
                const mine = p.proposedBy === userId;
                const segs = segsOf(p.id);
                return (
                  <div key={p.id} className={`card space-y-2 text-sm ${p.status === "pending" ? "" : "opacity-70"}`}>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{mine ? "You" : nameOf(p.proposedBy)} proposed</span>
                      <span className={p.status === "pending" ? "font-medium text-amber-700" : ""}>{STATUS_LABEL[p.status]}</span>
                    </div>
                    {segs.length === 0 && <p>Clear the schedule {formatRange(p.rangeStart, p.rangeEnd, tz)}</p>}
                    {segs.map((s) => (
                      <p key={s.start.toISOString()}>
                        <span className="font-medium">{nameOf(s.parentId)}</span> has the kids {formatRange(s.start, s.end, tz)}
                        {s.handoff.kind && <span className="text-gray-600"> ({HANDOFF_LABELS[s.handoff.kind]}{s.handoff.location ? ` at ${s.handoff.location}` : ""})</span>}
                      </p>
                    ))}
                    {p.trailingHandoffKind && (
                      <p className="text-gray-600">
                        Back with the usual schedule by {HANDOFF_LABELS[p.trailingHandoffKind]}
                        {p.trailingHandoffLocation ? ` at ${p.trailingHandoffLocation}` : ""}
                      </p>
                    )}
                    {p.message && <p className="rounded-lg bg-gray-50 p-2 text-gray-700">“{p.message}”</p>}
                    {p.status === "pending" && (
                      <form action={respondAction} className="flex flex-wrap gap-2 pt-1">
                        <input type="hidden" name="proposalId" value={p.id} />
                        {mine ? (
                          <button name="response" value="withdraw" className="btn-secondary">Withdraw</button>
                        ) : (
                          <>
                            <button name="response" value="approve" className="btn-primary">Approve</button>
                            <button name="response" value="decline" className="btn-danger">Decline</button>
                            <Link href={`/calendar?month=${month}&counter=${p.id}#propose`} className="btn-secondary">Counter</Link>
                          </>
                        )}
                      </form>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          <div id="propose">
            <ProposeForm
              members={members}
              defaults={defaults}
              title={counter ? `Counter ${nameOf(counter.proposedBy)}'s proposal` : "Propose a change"}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
