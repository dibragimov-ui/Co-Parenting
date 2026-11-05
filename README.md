# Kids' Schedule

A small web app for two co-parents. Both sign in with Google, agree on who has the kids for each day or part of a day (school drop-off by one parent, pick-up by the other), and every approved change is pushed to the shared family Google Calendar.

## How it works

- **Custody is a timeline, not a list of days.** Each period says "this parent has the kids from this moment until that moment". A handoff is the boundary between two periods, with optional details (school drop-off, pick-up, exchange, plus a place).
- **Nothing changes without the other parent.** Every change is a proposal. Only the other parent can approve, decline or counter it. Approving a change marks any other pending proposal for the same days as outdated.
- **Google Calendar mirrors what was approved.** Google can't draw gradients, so the app writes:
  - full days: one all-day event per run of days ("Kids with Dimitriy"), in that parent's color;
  - handoff days: two stacked all-day events ("Kids with Dimitriy until 8:00 AM (school drop-off)" and "Kids with Alex from 8:00 AM (school drop-off)");
  - each handoff: a 15-minute timed event with the location.
- **Colors** come from Google's 11 event colors (Peacock is the closest to baby blue). The two parents can't pick the same one. The in-app month view does draw a gradient on handoff days.
- The app only ever touches events it created (tagged with a private extended property). A nightly job re-reads Google and puts back anything edited or deleted there by hand.

Code map: `src/lib/domain` holds the pure schedule logic (timeline edits, splitting into days, building calendar events, the sync diff) with unit tests; `src/lib/proposals.ts` the approval rules; `src/lib/sync.ts` the Google Calendar sync; `src/db/schema.ts` the tables.

## Setup

### 1. Database

Create a free Postgres database on [Neon](https://neon.tech) or [Supabase](https://supabase.com), then apply the migrations:

```bash
cp .env.example .env.local   # fill in DATABASE_URL first
npm install
DATABASE_URL=... npm run db:migrate
```

The migrations enable `btree_gist` so the database itself refuses overlapping custody periods.

### 2. Google Cloud project

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com) and enable the **Google Calendar API**.
2. **OAuth consent screen**: user type External, add both parents' Google accounts as test users while setting up, and add the scopes `.../auth/calendar.events` and `.../auth/calendar.calendarlist.readonly`.
3. **Publish the app** ("In production") once it works. Apps left in *Testing* have their refresh tokens expire after 7 days, which would silently stop the calendar sync. An unverified app is fine for two people: Google shows a "Google hasn't verified this app" screen once, and the limit is 100 users.
4. **Credentials > Create OAuth client ID > Web application** with these redirect URIs (add the localhost ones for development):
   - `https://YOUR-DOMAIN/api/auth/callback/google`
   - `https://YOUR-DOMAIN/api/calendar/callback`
5. Put the client id and secret in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000, sign in, create the family, copy the invite link for your co-parent, then connect Google Calendar in Settings and pick the shared family calendar.

### 4. Deploy to Vercel

1. Import the repository in Vercel.
2. Add every variable from `.env.example` (use the pooled database URL, set `APP_URL` to the production URL, and set a random `CRON_SECRET`).
3. Deploy. `vercel.json` schedules the nightly re-sync at 09:00 UTC.

## Development

```bash
npm test          # unit tests
npm run lint
npm run build
```

`src/lib/integration.test.ts` runs the full proposal and sync flow against a real Postgres with a fake Google Calendar. It is skipped unless `TEST_DATABASE_URL` points at a disposable, migrated database:

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/coparent_test npm test
```

## Not built yet

- Email or push notifications when a proposal is waiting (today it shows on the calendar page).
- Proposing several periods in one proposal from the UI (the backend already supports it).
- Repeating templates such as "alternate weekends".
