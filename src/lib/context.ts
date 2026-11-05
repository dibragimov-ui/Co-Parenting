import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/db";
import { families, familyMembers } from "@/db/schema";

export const getContext = cache(async () => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const [membership] = await db.select().from(familyMembers).where(eq(familyMembers.userId, userId));
  if (!membership) return { userId, session, family: null, members: [] as (typeof familyMembers.$inferSelect)[] };
  const [family] = await db.select().from(families).where(eq(families.id, membership.familyId));
  const members = await db.select().from(familyMembers).where(eq(familyMembers.familyId, membership.familyId));
  return { userId, session, family, members };
});

/** For pages and actions that need a signed-in parent with a family. */
export async function requireFamily() {
  const ctx = await getContext();
  if (!ctx) redirect("/");
  if (!ctx.family) redirect("/setup");
  return { ...ctx, family: ctx.family };
}
