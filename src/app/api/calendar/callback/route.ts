import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { auditLog, families } from "@/db/schema";
import { getContext } from "@/lib/context";
import { encrypt } from "@/lib/crypto";
import { appUrl, oauthClient } from "@/lib/google";

// Step 2: Google sends the parent back here with a one-time code.
export async function GET(req: NextRequest) {
  const settings = (msg: string) =>
    NextResponse.redirect(`${appUrl()}/settings?calendar=${encodeURIComponent(msg)}`);
  const ctx = await getContext();
  if (!ctx?.family) return NextResponse.redirect(`${appUrl()}/`);

  const jar = await cookies();
  const expected = jar.get("cal_oauth_state")?.value;
  jar.delete({ name: "cal_oauth_state", path: "/api/calendar" });
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return settings("Calendar access was not granted.");
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) {
    return settings("That link expired. Please try connecting again.");
  }

  const { tokens } = await oauthClient().getToken(code);
  if (!tokens.refresh_token) return settings("Google did not return offline access. Please try again.");
  if (!tokens.scope?.includes("https://www.googleapis.com/auth/calendar.events")) {
    return settings("Please tick the calendar permission on Google's screen.");
  }
  await db
    .update(families)
    .set({
      calendarRefreshToken: encrypt(tokens.refresh_token),
      calendarConnectedBy: ctx.userId,
      lastSyncError: null,
    })
    .where(eq(families.id, ctx.family.id));
  await db.insert(auditLog).values({ familyId: ctx.family.id, actorId: ctx.userId, action: "calendar.connected" });
  return settings("connected");
}
