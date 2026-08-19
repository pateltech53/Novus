# Admin — the operator's role and console

An admin is an ordinary Novus account whose `profiles.role` cell says
`admin`. That cell lives in the Supabase table, is unwritable from any
signed-in session — **the first admin is made in the Supabase dashboard, and
every one after that by an admin, from the console** — and unlocks three
things:

- **The console at `/admin`** — user records, gifting, comped enterprise
  chapters, the board moderation queue, the site's numbers, the billing records
  that disagree with each other, and a theme switch of its own (the console is
  read for long stretches beside a Supabase tab; which light it is read in
  belongs to the operator, not to a setting three taps inside the game).
- **Everything, without paying** — the admin's own account plays fully
  unlocked (all 12 industries, The Room, 99 runs a day), with a view switch
  to play as `free` or `pro` instead, so paywalls can be tested for real.
- **The service surface** — `app/api/admin/*`, which answers 404 to every
  other account on earth.

## 快速开通（三步）

1. 在 Novus 里注册一个普通账号（邮箱 + 密码）。
2. 打开 Supabase 项目 → **Table Editor → profiles**，找到自己那一行
   （按 `display_name` 搜，或先在 **Authentication → Users** 里按邮箱找到
   UUID），把 `role` 从 `player` 改成 `admin`。
3. 用这个账号访问 `https://<你的域名>/admin` —— 控制台就在那里。
   **手机 App 里**：游戏内打开 Settings（齿轮）→ 会多出一个只有管理员
   账号可见的 **OPERATOR → Admin console** 行，点进去就是同一个控制台。

**只有第一个管理员需要走 Supabase 后台**（因为那时还没有人有权授权）。之后
再加管理员不用碰数据库、也不用跑 SQL：在控制台 ACCOUNTS 里搜到那个账号，
展开 → **ROLE** 一栏 → 照着提示把对方邮箱打一遍解锁按钮 → **MAKE ADMIN**，
下一次请求就生效。收回权限点同一栏的 **DEMOTE TO PLAYER**，一切立即恢复，
无需清理任何数据。自己的那一行没有按钮：管理员不能改自己的 `role`（自降会
把自己关在门外），要么让另一个管理员操作，要么回 Supabase 后台改那一格。

前提：`supabase/APPLY-ALL.sql`（0001 → 0016）已在 Novus 项目跑过，部署配置了
`SUPABASE_SERVICE_ROLE_KEY`（计费同款，见 `docs/ACCOUNTS-SETUP.md`）。

---

## 1. What to run

**`supabase/APPLY-ALL.sql`** — the whole schema, 0001 → 0016, idempotent.
Admin specifically is `supabase/migrations/0009_admin.sql`,
`0010_admin_analytics.sql`, `0012_year_closes.sql` and
`0016_admin_insight.sql` (§7.1, §7.2), and
`supabase/tests/admin_test.sql` proves their claims under `npm run test:db`
(95 checks: self-promotion refused, promotion by the service role allowed,
gifts expire, a granted pace clamps to its column's bound, the directory
answers to the service role alone, demotion is total, cohort math holds —
and, from 0016, that an account Stripe is charging counts as paid with the
entitlement flag off, that the disagreement is named and listed, that an
account with two companies is still one row in the directory, that a save
written before 0013 still reports a figure, and that renaming a board handle
carries across the rows already holding it).

No new environment variables. The routes run on `SUPABASE_SERVICE_ROLE_KEY`,
which billing already requires.

## 2. Why the role is a table cell, and who may write it

The guard trigger in 0009 refuses `role` and `admin_view` from `anon` and
`authenticated` outright — players can update their own profiles row, so
without the trigger `role` on that row would be a self-service promotion.
It keys on `current_user`, not a JWT claim, because the role in effect *is*
the caller's provenance: PostgREST runs as `anon`/`authenticated`, the
dashboard as `postgres`, and these routes as `service_role`.

So there is **no API path a player's own session can take to `role`** — that
is the property, and it is unchanged. What the trigger never refused is the
service role, which is how `/api/admin/role` promotes and demotes
(`POST { profileId, role }`, §7). The authorisation is the same one every
other console write uses: the caller proves `role = 'admin'` on their own row
through their own session, and the work then runs on the service role, with
an `admin_audit` line naming both accounts.

**The dashboard still owns two moments.** The *first* admin, because a
console that can only be opened by an admin has nobody to authorise the first
promotion; and getting back in if the last admin is lost, because the route
refuses to change the caller's own row — a self-demotion would close the door
from the inside, and refusing it is also what guarantees a promotion always
leaves at least one admin standing. Emergency revocation of *someone else* is
now either place: the console's `DEMOTE TO PLAYER`, or one cell edit,
effective on that admin's next request.

Two accounts the route will not promote: an anonymous one (it signs in with a
device and no credential — an operator nobody can be, and a console anyone
holding that device can open) and one with no email (the audit log
denormalises emails so it still reads after the account is gone; an operator
it cannot name is one it cannot describe).

## 3. What an admin's own account gets

Derived, never stored. The entitlement reads (`/api/sync`,
`/api/billing/entitlements`) overlay the answer at read time from
`profiles.role` + `profiles.admin_view` (lib/admin/entitlements.ts), and the
run-a-day ledger reads the same switch inside the database
(`player_allowance`, 0009). Nothing is written into `entitlements` for an
admin, so demotion reverts everything with nothing to chase down.

The view switch on the console (`PLAY THIS ACCOUNT AS`):

| view | the admin's own game |
|---|---|
| `all` (default) | Pro everywhere, 99 runs/day, all industries |
| `pro` | exactly a Pro subscriber — 3 runs, 12 industries |
| `free` | exactly a new free player — locked doors included, even the admin's own purchases hidden |

Cold calls stay at Pro's three a day in every view: the cap lives inside the
engine, which deliberately knows nothing about entitlements beyond
`run.pro`.

## 4. Skipping checkout (跳过付款)

Every paid button in the game — Pro plans on the landing page, the welcome
flow and the in-game paywalls, industry packs and islands in the shelf,
chapter licences — funnels through one function, and for an **admin session
only** that function pauses with a choice:

- **TEST THE REAL CHECKOUT** — continue to Stripe and exercise the money
  path end to end;
- **SKIP PAYMENT — GRANT NOW** — `/api/admin/skip` grants the item to the
  admin's own account using the same functions the webhook calls (Pro lands
  in the comp column; packs and slots via 0003's own grants; licences as a
  comped chapter), writes a `checkout_skip` audit row, and the screen
  updates in place;
- **CANCEL** — nothing happens.

Players never see any of this: the fork exists only after a per-tab admin
check that answers 404 for everyone else. Skipping while in the FREE view
grants but does not show (FREE hides even owned things by design) — the
prompt says so and offers a one-tap switch to the PRO view.

## 5. Gifting (送会员)

**Gift Pro** writes `entitlements.comp_pro` / `comp_until` — *beside* the
paid flag, never inside it, because the Stripe webhook owns `pro` and
overwrites it on every subscription event; a gift written there would
evaporate on the giftee's next billing update. Effective Pro everywhere is
`pro OR (comp_pro AND not expired)`, evaluated at read time — an expiry
needs no sweeper, it simply stops being true.

The console's chips: 30 days, 1 year, forever, revoke. Industry packs gift
through 0003's own `grant_industry_pack` (a gifted pack and a bought one are
the same row), and extra islands are set outright, 0–20 (only the first ten
are reachable — `saves.slot` stops at nine).

**Extra year closes a day (给用户加 year)** — `entitlements.extra_year_closes`
(0012), set outright 0–20 through `/api/admin/years`, on top of whatever the
account's tier allows: free closes four fiscal years a real day, Pro as many
as it can pitch. The console row states the total it adds up to, so an
operator granting 6 to a free player can see the account now closes ten a
day; typing `0` takes the grant back.

Reach for it when Pro is more than the situation needs — a classroom being
demoed, a support case, a player who lost an afternoon to a bug. It is pace,
not progress: the year still has to be played and the pitch still has to be
given (§11). The count of years closed today lives on the DEVICE
(`novus:yearcloses:v1`), because it is a limit rather than a ledger of things
owned; this column is the allowance that count is measured against, and it
reaches the giftee on their next entitlement sync. The refusal screen prints
the granted number rather than "four", so it never states a limit it is not
the one enforcing.

Notes on gifts (`comp_note`) are technically readable by the player through
their own entitlements row — keep them neutral.

## 6. Comped enterprise (开 chapter)

`GRANT 35 SEATS` / `GRANT 100 SEATS` on an account mints a real `chapters`
row with `source = 'comp'` and **no Stripe subscription** (0009 relaxed
`stripe_subscription_id` to nullable). From that moment the account owns a
live seat console at `/chapter` — invites, CSV registration, the cap, all of
0007 unchanged — exactly as if a school had paid.

- One active chapter per owner, enforced in the function.
- Revoking (comp chapters only) keeps the roster and turns the seats off —
  the webhook's own lapse shape. Paid chapters lapse through Stripe, never
  from the console, so the row and Stripe's next event cannot disagree.
- A comp chapter given an end date lapses lazily: `/api/admin/stats` sweeps
  overdue ones every time the console loads.

## 7. User records (用户记录)

The ACCOUNTS band searches by email, display name, or exact profile id
(`admin_list_users`, service-role only, `security definer` over
`auth.users`). The detail panel shows what the schema knows: profile,
entitlements (paid and gifted), billing state, chapters owned, seat held,
companies (the saves listing cache), legacy, board entries, and the audit
tail for that account.

**Promotion (把用户改成 admin)** is the ROLE band on that panel, and the one
grant here that is not content or pace — it hands over the console itself, so
it is armed the way deletion is: type the account's email, then `MAKE ADMIN`.
The account becomes a full operator on its next request, with nothing written
anywhere but the one cell (§3), and `DEMOTE TO PLAYER` takes it back just as
completely, clearing `admin_view` with the role. The band shows no button on
the operator's own row, and `/api/admin/role` refuses it there regardless
(§2). Both directions write `role_set` to the audit log.

**Deletion** is the support tool for "please delete my child's account":
type the email to arm the button; `auth.users` cascades through profiles to
every table. Admins cannot be deleted from the console (demote them in the
ROLE band first), and the caller cannot delete themselves (Settings has the
self-serve path).

## 7.1 What the directory now says about play (0016)

The list used to say only who somebody had **paid** to be. It says what they
have **done** as well: runs completed (the `legacy` ledger's own count),
companies founded and how many are still alive, the biggest company's name and
what it was worth, and how many board entries the account holds. Every one of
those numbers already existed in this schema and none of them were being read.

The figures come from `saves.valuation` / `peak_valuation` / `cash` — 0013's
listing cache, mirrored out of `state` by the sync route — falling back to the
`state` blob itself for rows written before those columns existed, so a company
founded before 0013 shows a real figure rather than a dash.

Three bands read the same source: **THE BIGGEST COMPANIES** on the overview
(top twelve by peak valuation, with the account behind each), the play figures
in THE NUMBERS (runs completed, runs started today, companies, players
playing, the live value of every company added up, the biggest books anyone has
ever had), and the per-company lines on an account's own panel.

The directory also gained a lens — filter chips (PAYING, GIFTED, CHAPTER,
PLAYING, BILLING ⚠, ADMINS, ANONYMOUS) with live counts, four sorts, and
**EXPORT CSV**, which is the same query behind the same gate returned as a
download, so a question the console does not answer in a band can be answered
in a spreadsheet without anyone opening the Supabase dashboard. Filtering
happens on the page over the rows the search returned (up to the function's
200), which is why the heading says how many of how many are shown.

## 7.2 PRO · PAID, and why it used to read zero (0016)

`entitlements.pro` is written by exactly one thing — the Stripe webhook — and
the tile counted that column alone. So it read **zero for every subscriber
whose webhook never landed**: an endpoint added to Stripe after the first sale,
a wrong `STRIPE_WEBHOOK_SECRET`, a `customer.subscription.*` event nobody
ticked in the dashboard. `billing_customers` had the truth the whole time (the
checkout route writes it before Stripe ever sees the customer), which is
exactly why opening the account showed a live subscription while the tile above
it said nobody was paying.

**Paid is now the union of both records** — `admin_access()` in 0016, one
function every reader calls — and the disagreement between them is counted and
listed rather than hidden:

| tile | what it counts |
|---|---|
| `PRO · PAID` | `entitlements.pro` **OR** a Stripe status of active/trialing/past_due |
| `PRO · GIFTED` | an unexpired `comp_pro` |
| `PRO · IN TOTAL` | paid, gifted, chapter seats and admins — everyone with Pro access |
| `REVENUE / MONTH` | subscriptions by plan × the prices in `lib/monetization.ts`, yearly ÷ 12 |
| `PAYING & NOT PRO` | Stripe is charging and the entitlement is off — **a player paying for nothing** |
| `PRO & NOT PAYING` | the entitlement is on and Stripe has nothing live |

The BILLING band lists both kinds with a **RECONCILE** button. It is not a
grant: `/api/admin/reconcile` reads the subscription back **from Stripe** and
hands it to the same `syncSubscription` both webhook paths call, so an account
repaired here lands in exactly the state the webhook would have left it in —
including the state where the answer is "this lapsed, take Pro away". It cannot
give Pro to anyone Stripe is not already charging, which is what makes it safe
to press on any account without thinking about it. Every press writes a
`billing_reconcile` audit row naming the subscription, its status, and whether
the flag moved.

`admin_daily.pro_paid` follows the same correction from the day 0016 lands.
Rows recorded before it keep the number they were recorded with — inventing
yesterday's figure is the one thing that table's own header refuses to do.

## 8. The charts (0010)

THE CHARTS band on the console: signups/day and board entries/day (exact,
reconstructed from `created_at`), weekly cohort **retention** (back after
7/30 days) and **bounce rate** (never seen after day one), the last-seen
histogram, and a tracked actives & runs/day series.

Two honesty rules baked in:

- **"Seen" is more than sign-ins.** Sessions ride a refresh-token cookie, so
  `last_sign_in_at` alone undercounts; `admin_last_seen()` folds in saves,
  preferences and legacy timestamps.
- **No per-player history is collected.** Actives/runs per day cannot be
  reconstructed backwards, so `admin_daily` snapshots **counts only** (no
  ids) each time the console loads — the line builds itself from the day
  0010 lands, and days nobody opened the console show as gaps, not zeros.
  Cohort windows a cohort has not lived through yet render as dots, never
  as fake zeros.

Charts follow the dataviz method: the two series hues and the recency ramp
are validated for color-blind separation and contrast against both themes'
card surfaces (see `--viz-*` in globals.css), every chart has hover
tooltips and an AS-A-TABLE view, and none of the brand-law colors (CTA
orange, solvency green, prestige gold) appear in a chart.

## 9. The audit log

Every grant, revoke, promotion, demotion, view switch, board decision and
deletion writes a row
to `admin_audit` — who, what, whom, when, with emails denormalised so the
log still reads after the account it is about is gone. No RLS policy and no
grants: PostgREST cannot expose it to anyone. The console's overview shows
the recent tail.

## 10. Moderation, without the token

The BOARD QUEUE band is `/api/leaderboard/moderate` re-authorised by the
role instead of `NOVUS_MODERATOR_TOKEN`. Both doors end at
`set_entry_listed` (0006), so there is exactly one way a row goes public.
The token route stays for curl and CI; the env var can now be retired at
your leisure.

## 11. What admin deliberately cannot do

Brand Law 4 holds for operators too. There is no code path here — console,
route, or SQL function — that changes a score, a survival, a revive, a
leaderboard result, or `NEVER_PURCHASABLE` anything. Gifts are content and
pace: the same Pro, packs, slots, seats and fiscal-year closes money buys,
and nothing money cannot. A granted year close is permission to play the
year — never the year's result.
