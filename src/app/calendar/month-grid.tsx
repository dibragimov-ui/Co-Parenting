import { colorHex } from "@/lib/colors";
import { addDays, formatTime, type DateStr } from "@/lib/domain/dates";
import type { DayInfo } from "@/lib/domain/days";
import { HANDOFF_LABELS } from "@/lib/domain/types";

const tint = (hex: string) => `color-mix(in srgb, ${hex} 45%, white)`;

/**
 * The in-app view can do what Google Calendar can't: a split day is drawn
 * as a gradient from one parent's color to the other's at the handoff time.
 */
function background(day: DayInfo, colorOf: (id: string) => string): string {
  const dayStart = day.parts[0].start.getTime();
  const dayLen = day.parts.at(-1)!.end.getTime() - dayStart;
  if (day.kind === "full" && day.parentId) return tint(colorOf(day.parentId));
  if (day.kind === "unscheduled") return "white";
  const stops: string[] = [];
  day.parts.forEach((p) => {
    const c = p.parentId ? tint(colorOf(p.parentId)) : "white";
    const a = ((p.start.getTime() - dayStart) / dayLen) * 100;
    const b = ((p.end.getTime() - dayStart) / dayLen) * 100;
    // Soft 8% blend around each handoff.
    stops.push(`${c} ${Math.min(a + 4, b).toFixed(1)}%`, `${c} ${Math.max(b - 4, a).toFixed(1)}%`);
  });
  return `linear-gradient(135deg, ${stops.join(", ")})`;
}

export function MonthGrid({
  month,
  days,
  timeZone,
  today,
  members,
  pendingDates,
}: {
  month: string; // YYYY-MM
  days: DayInfo[]; // covering the whole grid
  timeZone: string;
  today: DateStr;
  members: { userId: string; displayName: string; colorId: string }[];
  pendingDates: Set<DateStr>;
}) {
  const byId = new Map(members.map((m) => [m.userId, m]));
  const colorOf = (id: string) => colorHex(byId.get(id)?.colorId ?? "8");
  const nameOf = (id: string) => byId.get(id)?.displayName ?? "?";
  const weeks: DayInfo[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-center text-xs font-medium text-gray-500">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].date} className="grid grid-cols-7">
          {week.map((day) => {
            const inMonth = day.date.startsWith(month);
            const handoffs = day.parts.filter((p) => p.startsWithHandoff && p.parentId);
            const pending = pendingDates.has(day.date);
            return (
              <div
                key={day.date}
                className={`relative min-h-20 min-w-0 border-b border-r border-gray-100 p-1 text-xs sm:p-1.5 sm:min-h-24 ${inMonth ? "" : "opacity-40"}`}
                style={{ background: background(day, colorOf) }}
                title={day.parts
                  .filter((p) => p.parentId)
                  .map((p) => `${nameOf(p.parentId!)} ${formatTime(p.start, timeZone)} to ${formatTime(p.end, timeZone)}`)
                  .join("\n")}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] ${day.date === today ? "bg-gray-900 font-semibold text-white" : "text-gray-800"}`}
                  >
                    {Number(day.date.slice(8))}
                  </span>
                  {pending && (
                    <span title="Pending proposal" className="h-2 w-2 rounded-full bg-amber-500 sm:h-auto sm:w-auto sm:rounded sm:bg-amber-100 sm:px-1 sm:text-[10px] sm:font-medium sm:text-amber-800">
                      <span className="sr-only sm:not-sr-only">pending</span>
                    </span>
                  )}
                </div>
                {day.kind === "full" && day.parentId && (
                  <div className="mt-1 truncate font-medium text-gray-800">{nameOf(day.parentId)}</div>
                )}
                {handoffs.map((p) => (
                  <div key={p.start.toISOString()} className="mt-1 leading-tight text-gray-800">
                    <div className="truncate font-medium">→ {nameOf(p.parentId!)}</div>
                    <div className="truncate text-[11px] text-gray-700">
                      {formatTime(p.start, timeZone)}
                      {p.handoff?.kind && <span className="hidden sm:inline"> · {HANDOFF_LABELS[p.handoff.kind]}</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** First Sunday on or before the 1st, through the Saturday after month end. */
export function gridRange(month: string): { from: DateStr; to: DateStr } {
  const first = `${month}-01`;
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
  const from = addDays(first, -dow);
  const [y, m] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const lastDow = new Date(`${addDays(nextMonth, -1)}T00:00:00Z`).getUTCDay();
  return { from, to: addDays(nextMonth, 6 - lastDow) };
}
