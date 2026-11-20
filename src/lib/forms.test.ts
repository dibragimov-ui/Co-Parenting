import { expect, it } from "vitest";
import { atLocalTime, startOfDay } from "./domain/dates";
import { proposalForm, proposalFromForm } from "./forms";

const TZ = "America/Chicago";

it("treats blank times as whole days", () => {
  const f = proposalForm.parse({ parentId: "c", fromDate: "2026-11-03", fromTime: "", untilDate: "2026-11-05", untilTime: "" });
  const p = proposalFromForm(f, TZ);
  expect(p.start).toEqual(startOfDay("2026-11-03", TZ));
  expect(p.end).toEqual(startOfDay("2026-11-06", TZ));
  expect(p.segments[0].handoff.kind).toBeNull();
});

it("keeps handoff times and kinds", () => {
  const f = proposalForm.parse({
    parentId: "c", fromDate: "2026-11-03", fromTime: "08:00", untilDate: "2026-11-06", untilTime: "15:15",
    startKind: "school_dropoff", startLocation: " Oak Elementary ", endKind: "school_pickup", endLocation: "",
  });
  const p = proposalFromForm(f, TZ);
  expect(p.start).toEqual(atLocalTime("2026-11-03", "08:00", TZ));
  expect(p.end).toEqual(atLocalTime("2026-11-06", "15:15", TZ));
  expect(p.segments[0].handoff).toEqual({ kind: "school_dropoff", location: "Oak Elementary", note: null });
  expect(p.trailingHandoff).toEqual({ kind: "school_pickup", location: null, note: null });
});

it("formats ranges the way the form reads them", async () => {
  const { formatRange } = await import("./format");
  const tz = "America/New_York";
  expect(formatRange(atLocalTime("2026-11-25", "08:00", tz), startOfDay("2026-11-28", tz), tz)).toBe(
    "Wed, Nov 25, 8:00 AM through Fri, Nov 27",
  );
  expect(formatRange(startOfDay("2026-11-03", tz), startOfDay("2026-11-06", tz), tz)).toBe("Tue, Nov 3 through Thu, Nov 5");
  expect(formatRange(atLocalTime("2026-11-20", "15:00", tz), atLocalTime("2026-11-23", "08:00", tz), tz)).toBe(
    "Fri, Nov 20, 3:00 PM until Mon, Nov 23, 8:00 AM",
  );
});
