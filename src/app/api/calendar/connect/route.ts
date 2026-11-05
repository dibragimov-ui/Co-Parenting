import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { CALENDAR_SCOPES, appUrl, oauthClient } from "@/lib/google";

// Step 1 of granting calendar access: send the parent to Google's consent screen.
export async function GET() {
  const ctx = await getContext();
  if (!ctx?.family) return NextResponse.redirect(`${appUrl()}/`);
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("cal_oauth_state", state, {
    httpOnly: true,
    secure: appUrl().startsWith("https://"),
    sameSite: "lax",
    maxAge: 600,
    path: "/api/calendar",
  });
  const url = oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    scope: CALENDAR_SCOPES,
    include_granted_scopes: true,
    state,
    login_hint: ctx.session?.user?.email ?? undefined,
  });
  return NextResponse.redirect(url);
}
