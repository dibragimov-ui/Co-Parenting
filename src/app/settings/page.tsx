import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { chooseCalendarAction, createInviteAction, syncNowAction } from "../actions";
import { MemberForm } from "./member-form";
import { db } from "@/db";
import { auditLog, invites } from "@/db/schema";
import { requireFamily } from "@/lib/context";
import { formatInstant } from "@/lib/format";
import { appUrl, calendarClient } from "@/lib/google";

const ACTIONS: Record<string, string> = {
  "family.created": "created the family",
  "family.joined": "joined",
  "proposal.created": "proposed a change",
  "proposal.countered": "sent a counter-proposal",
  "proposal.approved": "approved a change",
  "proposal.declined": "declined a change",
  "proposal.withdrawn": "withdrew a proposal",
  "calendar.connected": "connected Google Calendar",
  "calendar.selected": "chose the family calendar",
  "calendar.synced": "Google Calendar was updated",
};

async function writableCalendars(token: string) {
  try {
    const res = await calendarClient(token).calendarList.list({ minAccessRole: "writer", maxResults: 250 });
    return { items: res.data.items ?? [] };
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const ctx = await requireFamily();
  const { family, members, userId } = ctx;
  const sp = await searchParams;
  const me = members.find((m) => m.userId === userId)!;
  const other = members.find((m) => m.userId !== userId);
  const tz = family.timeZone;

  const [invite] = other
    ? []
    : await db
        .select()
        .from(invites)
        .where(and(eq(invites.familyId, family.id), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
        .orderBy(desc(invites.expiresAt))
        .limit(1);

  const picking = family.calendarRefreshToken && (!family.calendarId || sp.change);
  const calendars = picking ? await writableCalendars(family.calendarRefreshToken!) : null;
  const activity = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.familyId, family.id))
    .orderBy(desc(auditLog.at))
    .limit(15);
  const nameOf = (id: string | null) =>
    id === userId ? "You" : (members.find((m) => m.userId === id)?.displayName ?? "Someone");
  const calendarMsg = typeof sp.calendar === "string" && sp.calendar !== "connected" ? sp.calendar : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {!other && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Invite your co-parent</h2>
          <p className="text-sm text-gray-600">
            Send them this link. They sign in with their own Google account and pick their own color.
          </p>
          {invite ? (
            <>
              <input readOnly className="input font-mono text-xs" value={`${appUrl()}/join/${invite.token}`} />
              <p className="text-xs text-gray-500">Works once, until {formatInstant(invite.expiresAt, tz, { withTime: false })}.</p>
            </>
          ) : (
            <form action={createInviteAction}>
              <button className="btn-primary">Create invite link</button>
            </form>
          )}
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">Google Calendar</h2>
        {calendarMsg && <p className="text-sm text-red-700">{calendarMsg}</p>}
        {!family.calendarRefreshToken ? (
          <>
            <p className="text-sm text-gray-600">
              One of you connects once, using a Google account that can edit your shared family calendar. The app only
              adds, changes and removes the events it creates.
            </p>
            <a href="/api/calendar/connect" className="btn-primary">Connect Google Calendar</a>
          </>
        ) : picking ? (
          <>
            <p className="text-sm text-gray-600">Which calendar should the kids&apos; schedule go on?</p>
            {calendars?.error && (
              <p className="text-sm text-red-700">
                Couldn&apos;t list calendars: {calendars.error}. <a className="underline" href="/api/calendar/connect">Reconnect</a>
              </p>
            )}
            <form action={chooseCalendarAction} className="space-y-3">
              <select name="calendar" className="input" defaultValue={family.calendarId ? `${family.calendarId}\u0000${family.calendarName ?? ""}` : undefined}>
                {calendars?.items.map((c) => (
                  <option key={c.id} value={`${c.id}\u0000${c.summaryOverride ?? c.summary ?? ""}`}>
                    {c.summaryOverride ?? c.summary}
                    {c.primary ? " (your main calendar)" : ""}
                  </option>
                ))}
              </select>
              <button className="btn-primary">Use this calendar</button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm">
              Syncing to <span className="font-medium">{family.calendarName}</span>
              {family.calendarConnectedBy && <> through {nameOf(family.calendarConnectedBy)}&apos;s Google account</>}.
            </p>
            {family.lastSyncError ? (
              <p className="text-sm text-red-700">Last sync failed: {family.lastSyncError}</p>
            ) : family.lastSyncedAt ? (
              <p className="text-sm text-gray-500">Last synced {formatInstant(family.lastSyncedAt, tz)}.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <form action={syncNowAction}>
                <button className="btn-primary">Sync now</button>
              </form>
              <a href="/settings?change=1" className="btn-secondary">Change calendar</a>
              <a href="/api/calendar/connect" className="btn-secondary">Reconnect</a>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">You</h2>
        <MemberForm name={me.displayName} colorId={me.colorId} taken={other ? [other.colorId] : []} />
      </section>

      {activity.length > 0 && (
      <section className="card">
        <h2 className="mb-3 font-semibold">Recent activity</h2>
        <ul className="space-y-1 text-sm">
          {activity.map((a) => (
            <li key={a.id} className="flex justify-between gap-4">
              <span>{a.automated ? ACTIONS[a.action] ?? a.action : `${nameOf(a.actorId)} ${ACTIONS[a.action] ?? a.action}`}</span>
              <span className="shrink-0 text-gray-500">{formatInstant(a.at, tz)}</span>
            </li>
          ))}
        </ul>
      </section>
      )}
    </div>
  );
}
