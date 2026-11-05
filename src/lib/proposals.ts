import { and, eq, gt, gte, inArray, lt, lte, ne } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  auditLog,
  custodySegments,
  families,
  familyMembers,
  proposalSegments,
  proposals,
} from "@/db/schema";
import { applyChange, TimelineError, type Change } from "./domain/timeline";
import { NO_HANDOFF } from "./domain/types";
import { handoffColumns, loadSegments, rowToSegment } from "./schedule";
import { syncFamily } from "./sync";

export class ProposalError extends Error {}

interface Actor {
  familyId: string;
  userId: string;
}

export interface ProposalInput extends Change {
  message?: string | null;
  counterOf?: string | null;
}

async function lockFamily(tx: Tx, familyId: string) {
  const [family] = await tx.select().from(families).where(eq(families.id, familyId)).for("update");
  if (!family) throw new ProposalError("Family not found.");
  return family;
}

async function loadProposal(tx: Tx, actor: Actor, id: string) {
  const [p] = await tx
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.familyId, actor.familyId)));
  if (!p) throw new ProposalError("Proposal not found.");
  return p;
}

export async function createProposal(actor: Actor, input: ProposalInput): Promise<string> {
  return db.transaction(async (tx) => {
    const family = await lockFamily(tx, actor.familyId);
    const members = await tx
      .select({ userId: familyMembers.userId })
      .from(familyMembers)
      .where(eq(familyMembers.familyId, actor.familyId));
    const memberIds = new Set(members.map((m) => m.userId));
    if (members.length < 2) {
      throw new ProposalError("Invite your co-parent before proposing changes.");
    }
    for (const s of input.segments) {
      if (!memberIds.has(s.parentId)) throw new ProposalError("Unknown parent in proposal.");
    }
    // Dry run, so an invalid proposal is rejected now rather than at approval.
    const current = await loadSegments(tx, actor.familyId, { start: input.start, end: input.end });
    try {
      applyChange(current, input);
    } catch (err) {
      if (err instanceof TimelineError) throw new ProposalError(err.message);
      throw err;
    }

    if (input.counterOf) {
      const original = await loadProposal(tx, actor, input.counterOf);
      if (original.status !== "pending") throw new ProposalError("That proposal is no longer pending.");
      if (original.proposedBy === actor.userId) throw new ProposalError("You can't counter your own proposal.");
      await tx
        .update(proposals)
        .set({ status: "countered", respondedBy: actor.userId, respondedAt: new Date() })
        .where(eq(proposals.id, original.id));
    }

    const trailing = input.trailingHandoff ?? NO_HANDOFF;
    const [row] = await tx
      .insert(proposals)
      .values({
        familyId: actor.familyId,
        proposedBy: actor.userId,
        baseVersion: family.scheduleVersion,
        rangeStart: input.start,
        rangeEnd: input.end,
        message: input.message?.trim() || null,
        trailingHandoffKind: trailing.kind,
        trailingHandoffLocation: trailing.location,
        trailingHandoffNote: trailing.note,
        counterOf: input.counterOf ?? null,
      })
      .returning({ id: proposals.id });
    if (input.segments.length) {
      await tx.insert(proposalSegments).values(
        input.segments.map((s) => ({
          proposalId: row.id,
          parentId: s.parentId,
          startsAt: s.start,
          endsAt: s.end,
          ...handoffColumns(s.handoff),
        })),
      );
    }
    await tx.insert(auditLog).values({
      familyId: actor.familyId,
      actorId: actor.userId,
      action: input.counterOf ? "proposal.countered" : "proposal.created",
      details: { proposalId: row.id, counterOf: input.counterOf ?? null },
    });
    return row.id;
  });
}

export type Response = "approve" | "decline" | "withdraw";

export async function respondToProposal(actor: Actor, proposalId: string, response: Response) {
  const approved = await db.transaction(async (tx) => {
    const family = await lockFamily(tx, actor.familyId);
    const p = await loadProposal(tx, actor, proposalId);
    if (p.status !== "pending") throw new ProposalError("That proposal is no longer pending.");
    const mine = p.proposedBy === actor.userId;
    if (response === "withdraw" && !mine) throw new ProposalError("Only the parent who proposed it can withdraw it.");
    if (response !== "withdraw" && mine) throw new ProposalError("The other parent has to respond to this proposal.");

    const now = new Date();
    if (response !== "approve") {
      await tx
        .update(proposals)
        .set({ status: response === "decline" ? "declined" : "withdrawn", respondedBy: actor.userId, respondedAt: now })
        .where(eq(proposals.id, p.id));
      await tx.insert(auditLog).values({
        familyId: actor.familyId,
        actorId: actor.userId,
        action: `proposal.${response === "decline" ? "declined" : "withdrawn"}`,
        details: { proposalId: p.id },
      });
      return false;
    }

    const proposed = (
      await tx.select().from(proposalSegments).where(eq(proposalSegments.proposalId, p.id))
    ).map(rowToSegment);
    const touching = await tx
      .select()
      .from(custodySegments)
      .where(
        and(
          eq(custodySegments.familyId, actor.familyId),
          gte(custodySegments.endsAt, p.rangeStart),
          lte(custodySegments.startsAt, p.rangeEnd),
        ),
      );
    const next = applyChange(touching.map(rowToSegment), {
      start: p.rangeStart,
      end: p.rangeEnd,
      segments: proposed,
      trailingHandoff: {
        kind: p.trailingHandoffKind,
        location: p.trailingHandoffLocation,
        note: p.trailingHandoffNote,
      },
    });
    if (touching.length) {
      await tx.delete(custodySegments).where(inArray(custodySegments.id, touching.map((r) => r.id)));
    }
    if (next.length) {
      await tx.insert(custodySegments).values(
        next.map((s) => ({
          familyId: actor.familyId,
          parentId: s.parentId,
          startsAt: s.start,
          endsAt: s.end,
          ...handoffColumns(s.handoff),
        })),
      );
    }
    await tx
      .update(families)
      .set({ scheduleVersion: family.scheduleVersion + 1 })
      .where(eq(families.id, family.id));
    await tx
      .update(proposals)
      .set({ status: "approved", respondedBy: actor.userId, respondedAt: now })
      .where(eq(proposals.id, p.id));
    // Other pending proposals for the same days were built on the old schedule.
    await tx
      .update(proposals)
      .set({ status: "stale" })
      .where(
        and(
          eq(proposals.familyId, actor.familyId),
          eq(proposals.status, "pending"),
          ne(proposals.id, p.id),
          lt(proposals.rangeStart, p.rangeEnd),
          gt(proposals.rangeEnd, p.rangeStart),
        ),
      );
    await tx.insert(auditLog).values({
      familyId: actor.familyId,
      actorId: actor.userId,
      action: "proposal.approved",
      details: { proposalId: p.id, version: family.scheduleVersion + 1 },
    });
    return true;
  });

  if (approved) await syncFamily(actor.familyId);
}
