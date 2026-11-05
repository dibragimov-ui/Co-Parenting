/**
 * Runs the proposal flow and calendar sync against a real Postgres, with
 * Google Calendar replaced by an in-memory fake. Skipped unless
 * TEST_DATABASE_URL points at a migrated, disposable database.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url ?? "";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

type FakeEvent = Record<string, unknown> & { id: string };
const fake = new Map<string, FakeEvent>();
let nextId = 1;
vi.mock("./google", async (orig) => {
  const real = await orig<typeof import("./google")>();
  const notFound = () => Object.assign(new Error("Not Found"), { code: 404 });
  return {
    ...real,
    calendarClient: () => ({
      events: {
        insert: async ({ requestBody }: { requestBody: object }) => {
          const id = `ev${nextId++}`;
          fake.set(id, { ...requestBody, id });
          return { data: { id } };
        },
        update: async ({ eventId, requestBody }: { eventId: string; requestBody: object }) => {
          if (!fake.has(eventId)) throw notFound();
          fake.set(eventId, { ...requestBody, id: eventId });
          return { data: {} };
        },
        delete: async ({ eventId }: { eventId: string }) => {
          if (!fake.delete(eventId)) throw notFound();
          return { data: {} };
        },
        list: async () => ({ data: { items: [...fake.values()] } }),
      },
    }),
  };
});

describe.skipIf(!url)("proposal flow with database", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const { createProposal, respondToProposal, ProposalError } = await import("./proposals");
  const { syncFamily } = await import("./sync");
  const { loadSegments } = await import("./schedule");
  const { encrypt } = await import("./crypto");
  const { atLocalTime, startOfDay } = await import("./domain/dates");
  const { eq } = await import("drizzle-orm");

  const TZ = "America/New_York";
  let familyId = "";
  const dad = "user-d-" + randomBytes(4).toString("hex");
  const co = "user-c-" + randomBytes(4).toString("hex");
  const D = () => ({ familyId, userId: dad });
  const C = () => ({ familyId, userId: co });
  const day = (d: string) => startOfDay(d, TZ);
  const summaries = () => [...fake.values()].map((e) => e.summary as string).sort();

  beforeAll(async () => {
    await db.insert(s.users).values([
      { id: dad, name: "Dimitriy", email: `${dad}@example.test` },
      { id: co, name: "Alex", email: `${co}@example.test` },
    ]);
    const [f] = await db
      .insert(s.families)
      .values({ name: "Test", timeZone: TZ, calendarId: "family-cal", calendarName: "Family", calendarRefreshToken: encrypt("rt") })
      .returning();
    familyId = f.id;
    await db.insert(s.familyMembers).values([
      { familyId, userId: dad, displayName: "Dimitriy", colorId: "7" },
      { familyId, userId: co, displayName: "Alex", colorId: "10" },
    ]);
  });

  afterAll(async () => {
    await db.delete(s.families).where(eq(s.families.id, familyId));
  });

  it("needs the other parent's approval, then syncs to the calendar", async () => {
    const id = await createProposal(D(), {
      start: day("2026-11-02"),
      end: day("2026-11-09"),
      segments: [{ parentId: dad, start: day("2026-11-02"), end: day("2026-11-09"), handoff: { kind: null, location: null, note: null } }],
    });
    await expect(respondToProposal(D(), id, "approve")).rejects.toBeInstanceOf(ProposalError);
    expect(fake.size).toBe(0);
    await respondToProposal(C(), id, "approve");
    expect(summaries()).toEqual(["Kids with Dimitriy"]);
  });

  it("handles a counter-proposal for a school drop-off handoff", async () => {
    const dropoff = atLocalTime("2026-11-04", "08:00", TZ);
    const pickup = atLocalTime("2026-11-06", "15:00", TZ);
    const first = await createProposal(C(), {
      start: dropoff,
      end: pickup,
      segments: [{ parentId: co, start: dropoff, end: pickup, handoff: { kind: "school_dropoff", location: "Oak Elementary", note: null } }],
      trailingHandoff: { kind: "school_pickup", location: "Oak Elementary", note: null },
    });
    const later = atLocalTime("2026-11-07", "10:00", TZ);
    const counter = await createProposal(D(), {
      start: dropoff,
      end: later,
      segments: [{ parentId: co, start: dropoff, end: later, handoff: { kind: "school_dropoff", location: "Oak Elementary", note: null } }],
      trailingHandoff: { kind: "exchange", location: null, note: null },
      counterOf: first,
    });
    const [orig] = await db.select().from(s.proposals).where(eq(s.proposals.id, first));
    expect(orig.status).toBe("countered");
    await respondToProposal(C(), counter, "approve");

    const segs = await loadSegments(db, familyId);
    expect(segs.map((x) => [x.parentId === dad ? "D" : "C", x.start.toISOString()])).toEqual([
      ["D", day("2026-11-02").toISOString()],
      ["C", dropoff.toISOString()],
      ["D", later.toISOString()],
    ]);
    expect(summaries()).toEqual([
      "Handoff: exchange (Alex to Dimitriy)",
      "Handoff: school drop-off (Dimitriy to Alex)",
      "Kids with Alex",
      "Kids with Alex from 8:00 AM (school drop-off)",
      "Kids with Alex until 10:00 AM (exchange)",
      "Kids with Dimitriy",
      "Kids with Dimitriy",
      "Kids with Dimitriy from 10:00 AM (exchange)",
      "Kids with Dimitriy until 8:00 AM (school drop-off)",
    ]);
  });

  it("marks overlapping pending proposals stale when another is approved", async () => {
    const seg = (who: string) => ({ parentId: who, start: day("2026-11-20"), end: day("2026-11-22"), handoff: { kind: null, location: null, note: null } });
    const a = await createProposal(D(), { start: day("2026-11-20"), end: day("2026-11-22"), segments: [seg(dad)] });
    const b = await createProposal(C(), { start: day("2026-11-20"), end: day("2026-11-22"), segments: [seg(co)] });
    await respondToProposal(C(), a, "approve");
    const [pb] = await db.select().from(s.proposals).where(eq(s.proposals.id, b));
    expect(pb.status).toBe("stale");
    await expect(respondToProposal(D(), b, "approve")).rejects.toBeInstanceOf(ProposalError);
  });

  it("restores events deleted or edited directly in Google on a full sync", async () => {
    const [first, second] = [...fake.keys()];
    fake.delete(first);
    fake.set(second, { ...fake.get(second)!, summary: "edited by hand" });
    fake.set("stray", { id: "stray", summary: "dupe", extendedProperties: { private: { coparentApp: "1", coparentKey: "full:2026-11-02" } } });
    const before = summaries().length;
    const res = await syncFamily(familyId, { full: true });
    expect(res.status).toBe("synced");
    expect(summaries()).not.toContain("edited by hand");
    expect(summaries()).not.toContain("dupe");
    expect(summaries().length).toBe(before); // one restored, one stray removed
  });

  it("the database refuses overlapping custody periods", async () => {
    await expect(
      db.insert(s.custodySegments).values({ familyId, parentId: co, startsAt: day("2026-11-03"), endsAt: day("2026-11-04") }),
    ).rejects.toThrow();
  });
});
