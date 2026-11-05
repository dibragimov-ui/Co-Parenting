import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---- Auth.js tables (shape required by @auth/drizzle-adapter) ----

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---- App tables ----

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(),
  /** The Google calendar the schedule is mirrored to. */
  calendarId: text("calendar_id"),
  calendarName: text("calendar_name"),
  /** AES-GCM encrypted Google refresh token with calendar access. */
  calendarRefreshToken: text("calendar_refresh_token"),
  calendarConnectedBy: text("calendar_connected_by").references(() => users.id, { onDelete: "set null" }),
  scheduleVersion: integer("schedule_version").notNull().default(0),
  lastSyncedAt: ts("last_synced_at"),
  lastSyncError: text("last_sync_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const familyMembers = pgTable(
  "family_members",
  {
    familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    /** Google Calendar event color id, "1" to "11". */
    colorId: text("color_id").notNull(),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.familyId, t.userId] }),
    unique("family_members_one_family_per_user").on(t.userId),
    unique("family_members_unique_color").on(t.familyId, t.colorId),
  ],
);

export const invites = pgTable("invites", {
  token: text("token").primaryKey(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const handoffKind = pgEnum("handoff_kind", [
  "school_dropoff",
  "school_pickup",
  "exchange",
  "other",
]);

const handoffColumns = {
  handoffKind: handoffKind("handoff_kind"),
  handoffLocation: text("handoff_location"),
  handoffNote: text("handoff_note"),
};

/**
 * The approved schedule. Each row: one parent has the kids from starts_at
 * until ends_at. Overlaps are blocked by an exclusion constraint (see the
 * custom migration).
 */
export const custodySegments = pgTable(
  "custody_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
    parentId: text("parent_id").notNull().references(() => users.id),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    ...handoffColumns,
  },
  (t) => [index("custody_segments_family_start").on(t.familyId, t.startsAt)],
);

export const proposalStatus = pgEnum("proposal_status", [
  "pending",
  "approved",
  "declined",
  "countered",
  "withdrawn",
  "stale",
]);

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
    proposedBy: text("proposed_by").notNull().references(() => users.id),
    status: proposalStatus("status").notNull().default("pending"),
    baseVersion: integer("base_version").notNull(),
    rangeStart: ts("range_start").notNull(),
    rangeEnd: ts("range_end").notNull(),
    message: text("message"),
    /** Handoff details for when the existing schedule resumes at range_end. */
    trailingHandoffKind: handoffKind("trailing_handoff_kind"),
    trailingHandoffLocation: text("trailing_handoff_location"),
    trailingHandoffNote: text("trailing_handoff_note"),
    counterOf: uuid("counter_of"),
    respondedBy: text("responded_by").references(() => users.id),
    respondedAt: ts("responded_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("proposals_family_status").on(t.familyId, t.status)],
);

export const proposalSegments = pgTable("proposal_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  parentId: text("parent_id").notNull().references(() => users.id),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  ...handoffColumns,
});

/** Maps app events to Google events so sync can update or delete them. */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    key: text("key").notNull(),
    googleEventId: text("google_event_id").notNull(),
    contentHash: text("content_hash").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.familyId, t.calendarId, t.key] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    details: jsonb("details"),
    automated: boolean("automated").notNull().default(false),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_family_at").on(t.familyId, t.at)],
);
