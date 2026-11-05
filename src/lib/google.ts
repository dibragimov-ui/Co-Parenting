import { google } from "googleapis";
import { decrypt } from "./crypto";

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export function appUrl(): string {
  const url = process.env.APP_URL ?? process.env.AUTH_URL;
  if (url) return url.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
    `${appUrl()}/api/calendar/callback`,
  );
}

export function calendarClient(encryptedRefreshToken: string) {
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: decrypt(encryptedRefreshToken) });
  return google.calendar({ version: "v3", auth });
}

export type CalendarClient = ReturnType<typeof calendarClient>;

export function googleStatus(err: unknown): number | undefined {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: number } };
  const code = Number(e?.response?.status ?? e?.status ?? e?.code);
  return Number.isFinite(code) ? code : undefined;
}
