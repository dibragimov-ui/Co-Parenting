"use server";

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { db } from "@/db";
import { auditLog, families, familyMembers, invites } from "@/db/schema";
import { isColorId } from "@/lib/colors";
import { getContext, requireFamily } from "@/lib/context";
import { proposalForm, proposalFromForm } from "@/lib/forms";
import { ProposalError, createProposal, respondToProposal, type Response } from "@/lib/proposals";
import { clearCalendar, syncFamily } from "@/lib/sync";

export type FormState = { error?: string; ok?: string } | undefined;

export async function signInAction(formData: FormData) {
  const redirectTo = String(formData.get("redirectTo") || "/calendar");
  await signIn("google", { redirectTo });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

const memberFields = z.object({
  displayName: z.string().trim().min(1, "Enter your name.").max(40),
  colorId: z.string().refine(isColorId, "Pick a color."),
});

function validTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function createFamilyAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  if (!ctx) redirect("/");
  if (ctx.family) redirect("/calendar");
  const parsed = memberFields
    .extend({
      familyName: z.string().trim().min(1, "Name the family calendar.").max(60),
      timeZone: z.string().refine(validTimeZone, "Pick a time zone."),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  await db.transaction(async (tx) => {
    const [family] = await tx
      .insert(families)
      .values({ name: v.familyName, timeZone: v.timeZone })
      .returning({ id: families.id });
    await tx.insert(familyMembers).values({
      familyId: family.id,
      userId: ctx.userId,
      displayName: v.displayName,
      colorId: v.colorId,
    });
    await tx.insert(auditLog).values({ familyId: family.id, actorId: ctx.userId, action: "family.created" });
  });
  redirect("/settings?welcome=1");
}

export async function joinFamilyAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  if (!ctx) redirect("/");
  if (ctx.family) redirect("/calendar");
  const parsed = memberFields.extend({ token: z.string().min(1) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  try {
    await db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(invites)
        .where(and(eq(invites.token, v.token), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
        .for("update");
      if (!invite) throw new ProposalError("This invite link has expired or was already used.");
      const members = await tx.select().from(familyMembers).where(eq(familyMembers.familyId, invite.familyId));
      if (members.length >= 2) throw new ProposalError("This family already has two parents.");
      if (members.some((m) => m.colorId === v.colorId)) {
        throw new ProposalError("Your co-parent already uses that color. Pick another one.");
      }
      await tx.insert(familyMembers).values({
        familyId: invite.familyId,
        userId: ctx.userId,
        displayName: v.displayName,
        colorId: v.colorId,
      });
      await tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.token, invite.token));
      await tx.insert(auditLog).values({ familyId: invite.familyId, actorId: ctx.userId, action: "family.joined" });
    });
  } catch (err) {
    if (err instanceof ProposalError) return { error: err.message };
    throw err;
  }
  redirect("/calendar");
}

export async function createInviteAction() {
  const ctx = await requireFamily();
  const token = randomBytes(18).toString("base64url");
  await db.insert(invites).values({
    token,
    familyId: ctx.family.id,
    createdBy: ctx.userId,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
  });
  revalidatePath("/settings");
}

export async function updateMemberAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireFamily();
  const parsed = memberFields.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (ctx.members.some((m) => m.userId !== ctx.userId && m.colorId === parsed.data.colorId)) {
    return { error: "Your co-parent already uses that color. Pick another one." };
  }
  await db
    .update(familyMembers)
    .set(parsed.data)
    .where(and(eq(familyMembers.familyId, ctx.family.id), eq(familyMembers.userId, ctx.userId)));
  await syncFamily(ctx.family.id); // names and colors appear in events
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}

export async function proposeAction(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireFamily();
  const parsed = proposalForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = proposalFromForm(parsed.data, ctx.family.timeZone);
  if (input.end <= input.start) return { error: "The end has to be after the start." };
  try {
    await createProposal({ familyId: ctx.family.id, userId: ctx.userId }, input);
  } catch (err) {
    if (err instanceof ProposalError) return { error: err.message };
    throw err;
  }
  revalidatePath("/calendar");
  redirect("/calendar?sent=1");
}

export async function respondAction(formData: FormData) {
  const ctx = await requireFamily();
  const id = String(formData.get("proposalId"));
  const response = String(formData.get("response")) as Response;
  if (!["approve", "decline", "withdraw"].includes(response)) return;
  try {
    await respondToProposal({ familyId: ctx.family.id, userId: ctx.userId }, id, response);
  } catch (err) {
    if (err instanceof ProposalError) redirect(`/calendar?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  revalidatePath("/calendar");
}

export async function chooseCalendarAction(formData: FormData) {
  const ctx = await requireFamily();
  const [calendarId, calendarName] = String(formData.get("calendar")).split("\u0000");
  if (!calendarId || !ctx.family.calendarRefreshToken) return;
  const previous = ctx.family.calendarId;
  if (previous && previous !== calendarId) {
    await clearCalendar(ctx.family.id, previous, ctx.family.calendarRefreshToken);
  }
  await db
    .update(families)
    .set({ calendarId, calendarName: calendarName || calendarId })
    .where(eq(families.id, ctx.family.id));
  await db.insert(auditLog).values({
    familyId: ctx.family.id,
    actorId: ctx.userId,
    action: "calendar.selected",
    details: { calendarId },
  });
  await syncFamily(ctx.family.id, { full: true });
  revalidatePath("/settings");
}

export async function syncNowAction() {
  const ctx = await requireFamily();
  await syncFamily(ctx.family.id, { full: true });
  revalidatePath("/", "layout");
}
