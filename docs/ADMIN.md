# Admin — the operator's role and console

An admin is an ordinary Novus account whose `profiles.role` cell says
`admin`. That cell lives in the Supabase table, is flipped **in the Supabase
dashboard and nowhere else**, and unlocks three things:

- **The console at `/admin`** — user records, gifting, comped enterprise
  chapters, the board moderation queue, and the site's numbers.
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
   降权同理：把 `role` 改回 `player`，一切立即恢复，无需清理任何数据。

前提：`supabase/APPLY-ALL.sql`（0001 → 0010）已在 Novus 项目跑过，部署配置了
`SUPABASE_SERVICE_ROLE_KEY`（计费同款，见 `docs/ACCOUNTS-SETUP.md`）。

---

## 1. What to run

**`supabase/APPLY-ALL.sql`** — the whole schema, 0001 → 0010, idempotent.
Admin specifically is `supabase/migrations/0009_admin.sql` and
`0010_admin_analytics.sql`, and `supabase/tests/admin_test.sql` proves their
claims under `npm run test:db` (62 checks: self-promotion refused, gifts
expire, the directory answers to the service role alone, demotion is total,
cohort math holds).

No new environment variables. The routes run on `SUPABASE_SERVICE_ROLE_KEY`,
which billing already requires.

## 2. Why the role is a table cell and not a route

The moderation endpoint said it first (app/api/leaderboard/moderate): an
admin *account* with a password-reset flow is a bigger thing to hold
correctly than a cell only the dashboard can write. So there is deliberately
**no API path that changes `role`** — not for admins, not for anyone. The
guard trigger in 0009 refuses the column from `anon` and `authenticated`
outright (players can update their own profiles row; without the trigger,
`role` on that row would be a self-service promotion), while the dashboard
(`postgres`) and the service role stay free to flip it.

Bootstrap is therefore the dashboard, by design, and so is emergency
revocation: one cell edit, effective on the admin's next request.

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
flow and the in-game paywalls, industry packs and run slots in the shelf,
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
the same row), and extra run slots are set outright, 0–20.

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

**Deletion** is the support tool for "please delete my child's account":
type the email to arm the button; `auth.users` cascades through profiles to
every table. Admins cannot be deleted from the console (demote in the
dashboard first), and the caller cannot delete themselves (Settings has the
self-serve path).

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

Every grant, revoke, view switch, board decision and deletion writes a row
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
leaderboard result, or `NEVER_PURCHASABLE` anything. Gifts are content:
the same Pro, packs, slots and seats money buys, and nothing money cannot.
