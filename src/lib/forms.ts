import { z } from "zod";
import { addDays, atLocalTime, startOfDay } from "./domain/dates";
import { HANDOFF_KINDS, NO_HANDOFF, type HandoffInfo } from "./domain/types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const time = z
  .string()
  .regex(/^(\d{2}:\d{2})?$/)
  .transform((v) => v || null);
const optionalText = z
  .string()
  .max(500)
  .optional()
  .transform((v) => v?.trim() || null);
const kind = z
  .enum(["", ...HANDOFF_KINDS])
  .optional()
  .transform((v) => (v ? v : null));

export const proposalForm = z.object({
  parentId: z.string().min(1, "Pick who has the kids."),
  fromDate: date,
  fromTime: time,
  untilDate: date,
  untilTime: time,
  startKind: kind,
  startLocation: optionalText,
  endKind: kind,
  endLocation: optionalText,
  message: optionalText,
  counterOf: z
    .string()
    .optional()
    .transform((v) => v || null),
});

export type ProposalForm = z.infer<typeof proposalForm>;

/**
 * Turns the form into instants in the family's time zone. A blank "from"
 * time means the start of that day; a blank "until" time means the end of
 * that day, so "Nov 3 to Nov 5" covers all three days.
 */
export function proposalFromForm(f: ProposalForm, timeZone: string) {
  const start = f.fromTime ? atLocalTime(f.fromDate, f.fromTime, timeZone) : startOfDay(f.fromDate, timeZone);
  const end = f.untilTime
    ? atLocalTime(f.untilDate, f.untilTime, timeZone)
    : startOfDay(addDays(f.untilDate, 1), timeZone);
  const startHandoff: HandoffInfo = f.startKind
    ? { kind: f.startKind, location: f.startLocation, note: null }
    : NO_HANDOFF;
  const endHandoff: HandoffInfo = f.endKind
    ? { kind: f.endKind, location: f.endLocation, note: null }
    : NO_HANDOFF;
  return {
    start,
    end,
    segments: [{ parentId: f.parentId, start, end, handoff: startHandoff }],
    trailingHandoff: endHandoff,
    message: f.message,
    counterOf: f.counterOf,
  };
}
