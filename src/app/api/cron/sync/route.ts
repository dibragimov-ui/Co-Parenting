import { isNotNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { families } from "@/db/schema";
import { syncFamily } from "@/lib/sync";

export const maxDuration = 300;

// Nightly: re-read Google and restore the approved schedule if anyone edited
// or deleted the app's events directly in Google Calendar. Vercel Cron sends
// "Authorization: Bearer $CRON_SECRET".
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await db.select({ id: families.id }).from(families).where(isNotNull(families.calendarId));
  const results: Record<string, unknown> = {};
  for (const { id } of rows) results[id] = await syncFamily(id, { full: true });
  return NextResponse.json({ results });
}
