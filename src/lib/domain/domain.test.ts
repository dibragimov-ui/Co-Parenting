import { describe, expect, it } from "vitest";
import { buildDesiredEvents, eventHash, planSync, type AllDayEvent, type TimedEvent } from "./calendar-events";
import { addDays, atLocalTime, startOfDay, toDateStr } from "./dates";
import { deriveDays } from "./days";
import { applyChange, TimelineError } from "./timeline";
import { NO_HANDOFF, type Segment } from "./types";

const TZ = "America/New_York";
const at = (date: string, time = "00:00") => atLocalTime(date, time, TZ);
const seg = (parentId: string, s: Date, e: Date, handoff = NO_HANDOFF): Segment => ({
  parentId, start: s, end: e, handoff,
});
const members = [
  { parentId: "d", name: "Dimitriy", colorId: "7" },
  { parentId: "c", name: "Alex", colorId: "10" },
];
const opts = { timeZone: TZ, members, appUrl: "https://example.test" };

describe("dates", () => {
  it("handles DST: Nov 1 2026 in New York is 25 hours long", () => {
    const len = startOfDay("2026-11-02", TZ).getTime() - startOfDay("2026-11-01", TZ).getTime();
    expect(len).toBe(25 * 3600_000);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(toDateStr(at("2026-11-03", "23:30"), TZ)).toBe("2026-11-03");
  });
});

describe("applyChange", () => {
  it("replaces the range, clips neighbours and merges same-parent periods", () => {
    const existing = [seg("d", at("2026-11-01"), at("2026-11-08"))];
    const result = applyChange(existing, {
      start: at("2026-11-03", "08:00"),
      end: at("2026-11-05", "15:00"),
      segments: [seg("c", at("2026-11-03", "08:00"), at("2026-11-05", "15:00"), { kind: "school_dropoff", location: "School", note: null })],
      trailingHandoff: { kind: "school_pickup", location: "School", note: null },
    });
    expect(result.map((s) => [s.parentId, s.start.toISOString(), s.end.toISOString(), s.handoff.kind])).toEqual([
      ["d", at("2026-11-01").toISOString(), at("2026-11-03", "08:00").toISOString(), null],
      ["c", at("2026-11-03", "08:00").toISOString(), at("2026-11-05", "15:00").toISOString(), "school_dropoff"],
      ["d", at("2026-11-05", "15:00").toISOString(), at("2026-11-08").toISOString(), "school_pickup"],
    ]);
  });

  it("merges when the same parent is proposed", () => {
    const existing = [seg("d", at("2026-11-01"), at("2026-11-03")), seg("c", at("2026-11-03"), at("2026-11-05"))];
    const result = applyChange(existing, {
      start: at("2026-11-03"), end: at("2026-11-05"),
      segments: [seg("d", at("2026-11-03"), at("2026-11-05"))],
    });
    expect(result).toHaveLength(1);
    expect(result[0].end.getTime()).toBe(at("2026-11-05").getTime());
  });

  it("rejects proposed periods outside the change", () => {
    expect(() =>
      applyChange([], { start: at("2026-11-03"), end: at("2026-11-04"), segments: [seg("d", at("2026-11-02"), at("2026-11-04"))] }),
    ).toThrow(TimelineError);
  });
});

describe("deriveDays", () => {
  it("marks full, split and unscheduled days", () => {
    const segs = [
      seg("d", at("2026-11-02"), at("2026-11-03", "08:00")),
      seg("c", at("2026-11-03", "08:00"), at("2026-11-05")),
    ];
    const days = deriveDays(segs, TZ, "2026-11-01", "2026-11-05");
    expect(days.map((d) => d.kind)).toEqual(["unscheduled", "full", "split", "full"]);
    expect(days[2].parts.map((p) => p.parentId)).toEqual(["d", "c"]);
    expect(days[3].parentId).toBe("c");
  });
});

describe("buildDesiredEvents", () => {
  const segs = [
    seg("d", at("2026-11-02"), at("2026-11-04", "08:00")),
    seg("c", at("2026-11-04", "08:00"), at("2026-11-07"), { kind: "school_dropoff", location: "Oak Elementary", note: null }),
  ];
  const events = buildDesiredEvents(segs, opts);
  const allDay = events.filter((e): e is AllDayEvent => e.type === "allDay");
  const timed = events.filter((e): e is TimedEvent => e.type === "timed");

  it("writes a multi-day event for each run of full days", () => {
    expect(allDay.find((e) => e.key === "full:2026-11-02")).toMatchObject({
      summary: "Kids with Dimitriy", startDate: "2026-11-02", endDate: "2026-11-04", colorId: "7",
    });
    expect(allDay.find((e) => e.key === "full:2026-11-05")).toMatchObject({
      summary: "Kids with Alex", endDate: "2026-11-07", colorId: "10",
    });
  });

  it("writes two stacked all-day events on a handoff day", () => {
    const split = allDay.filter((e) => e.startDate === "2026-11-04");
    expect(split.map((e) => e.summary)).toEqual([
      "Kids with Dimitriy until 8:00 AM (school drop-off)",
      "Kids with Alex from 8:00 AM (school drop-off)",
    ]);
    expect(split.map((e) => e.colorId)).toEqual(["7", "10"]);
  });

  it("writes a 15-minute timed event at the handoff", () => {
    expect(timed).toHaveLength(1);
    expect(timed[0]).toMatchObject({
      summary: "Handoff: school drop-off (Dimitriy to Alex)",
      location: "Oak Elementary",
      colorId: "10",
    });
    expect(timed[0].end.getTime() - timed[0].start.getTime()).toBe(15 * 60_000);
  });

  it("plans only the differences", () => {
    const existing = events.map((e, i) => ({ key: e.key, googleEventId: `g${i}`, contentHash: eventHash(e) }));
    expect(planSync(events, existing)).toEqual({ inserts: [], updates: [], deletes: [] });

    const changed = buildDesiredEvents(
      [seg("d", at("2026-11-02"), at("2026-11-04", "09:00")), seg("c", at("2026-11-04", "09:00"), at("2026-11-07"))],
      opts,
    );
    const plan = planSync(changed, existing);
    expect(plan.updates.map((u) => u.event.key).sort()).toEqual(["part:2026-11-04:0", "part:2026-11-04:1"]);
    expect(plan.inserts.map((e) => e.key)).toEqual([`handoff:${at("2026-11-04", "09:00").toISOString()}`]);
    expect(plan.deletes.map((d) => d.key)).toEqual([`handoff:${at("2026-11-04", "08:00").toISOString()}`]);
  });
});
