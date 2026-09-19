# Enterprise management and competitions

Enterprise owners and accepted administrators use `/chapter` on the website and in the iOS/Android app. These roles do not grant the global `/admin` operator role. Administrators can manage students and competitions; only the owner controls administrator invitations, enterprise details, deletion, and billing. An administrator does not consume a student seat.

Owners create an email-bound invitation and share its link. The recipient opens `/chapter`, signs into the invited email account, verifies that email, and accepts. Invitations alone grant no access. Revocation takes effect on the next request. Users managing several enterprises can select the enterprise at the top of the console.

Progress and member rosters are paginated, with exact counts, so large enterprises are not truncated by the API row limit. Progress shows the latest synced companies, current and peak valuations, company year/month and status, completed runs, and recent activity. Raw save blobs and other enterprises' data are never returned.

## Competition rules

- Administrators publish a title, description, start/end times, all or selected students, automatic or opt-in enrollment, and prizes by finishing place. Rules and rewards are fixed after publication.
- Only companies registered online during the competition qualify. Opt-in students must join before founding. Existing or offline-created companies cannot be attached retroactively.
- One newly created company can count toward all overlapping competitions for which its student is eligible.
- The server issues each online company's seed and records its founding time. Replayed game inputs, checked against that registration, determine its peak value. Neither synced save scalars nor claimed client values determine prizes.
- A student's highest verified value across eligible companies is retained. A lower or equal update never replaces its achievement timestamp. Ties use the first score received by the server, then a stable profile ID fallback.
- Only scores committed before the database deadline count. Offline play can continue in an already loaded web game, but late uploads do not extend a competition. The student screen explains this and shows pending score-sync errors.
- Student leaderboards use existing board handles, with a neutral fallback; they never reveal email addresses. The top 50 and the viewer's own rank are returned.
- Removing a student revokes participation access and excludes their score from that enterprise's current rankings and settlement.

## Rewards and reliability

`settle_chapter_competitions()` runs every minute through `pg_cron`. It locks due competitions, ranks eligible students, inserts a unique award, and grants the prize in one transaction. A retry cannot grant the same place or student twice. Existing unopened chest/vault/opening behavior is reused, with the administrator's selected tier and quantity.

Run tickets are permanent consumable credits. Online founding uses the normal daily allowance first, then spends one ticket. The per-player lock, persistent daily founding history, and request UUID make parallel attempts and retries safe. Tickets do not increase the simultaneous-company limit. Offline founding cannot consume tickets or enter a competition.

The migration is additive and compatible with existing clients. Old clients retain ordinary saves and play but cannot register competition companies or consume tickets. iOS/Android currently load the production site through the existing Capacitor shell, and share the enterprise pages, session handling and native navigation. No purchase controls are added inside store builds.

## Validation

- `npm run test:competitions` exercises form validation, the score route's authority boundary, and saved-company score synchronization after navigation, including separate island tapes and permanent server rejections.
- `supabase/tests/competitions_test.sql` covers administrator RLS/revocation, scoped progress, eligibility, overlapping competitions, opt-in timing, peak preservation, ties, deadline rejection, settlement and ticket idempotency. Included in `npm run test:db`.
- Existing application checks and all SQL suites are run with the new migration. When local Postgres was unavailable, the SQL suites ran on isolated PGlite Postgres instances with pgcrypto and the repository's auth shim; only psql client directives were translated.
- Browser verification uses synthetic data to exercise publication, owner/admin controls and student leaderboards at desktop and mobile widths. This is interface verification, not a live-account end-to-end test or a native simulator test.
