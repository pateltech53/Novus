import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { CATALOGUE, availableSkus, priceIdFor, type SkuId } from "@/lib/stripe/catalogue";
import { billingConfigured, missingBillingConfig, stripeMode } from "@/lib/stripe/config";
import { resolvePrice } from "@/lib/stripe/prices";
import { callerKey, throttle } from "@/lib/auth/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/status — can this deploy actually take money, and if not, why.
 *
 * It exists so the pricing screens can tell the truth. The line under CHOOSE
 * PRO would otherwise still promise "no card is taken" on a deploy that can
 * charge one, and a screen cannot read a server-only env var, so it asks.
 *
 * ── It also has to be a diagnostic ─────────────────────────────────────────
 *
 * The first version answered `{configured: false}` and stopped, which told an
 * operator that something was missing and nothing about what. Setting this up
 * means juggling four required variables plus four price ids across a
 * dashboard and a deploy, and "false" sent them guessing. So the unset names
 * are listed.
 *
 * Names, never values — and the names are in .env.example in the repository
 * already, so this discloses nothing that reading the repo would not.
 *
 * ── …and `?deep=1` is the rest of that job ─────────────────────────────────
 *
 * Everything above checks that variables are SET. Checkout fails for a second
 * class of reason entirely: a price id that is set and points at the wrong
 * amount, a product with two active prices, a billing table that exists in
 * supabase/migrations and was never applied to the project the deploy actually
 * talks to. Each of those turns into one 500 from /api/billing/checkout, which
 * the player reads as "Checkout could not be opened" and nobody can tell apart
 * from any other failure.
 *
 * `?deep=1` runs those checks directly — the same `resolvePrice` the checkout
 * route runs, and a read against the two tables it writes — so the answer to
 * "why does checkout fail in production" is one request rather than an
 * afternoon. It is off by default because it costs a Stripe round trip per SKU
 * and every pricing surface in the app calls this route on mount.
 *
 * Stripe ids are stripped from the answers. The failure MODE is what an
 * operator needs and is not a secret; the identifiers add nothing to it.
 */

/** `price_1Ab…`, `prod_Xyz…`, `cus_…` — removed from anything echoed back. */
const scrub = (text: string): string => text.replace(/\b(price|prod|cus)_[A-Za-z0-9_]+/g, "$1_…");

interface SkuCheck {
  sku: SkuId;
  envVar: string;
  ok: boolean;
  /** Absent when ok. Never contains a Stripe id or an env var's value. */
  reason?: string;
}

interface TableCheck {
  table: string;
  ok: boolean;
  reason?: string;
}

/**
 * Every SKU, against Stripe, exactly as checkout would.
 *
 * Sequential rather than parallel on purpose: this is an operator's route, run
 * by hand, and four requests at once against a rate limit to save two seconds
 * is a trade nobody asked for.
 */
async function checkSkus(): Promise<SkuCheck[]> {
  const out: SkuCheck[] = [];
  for (const id of Object.keys(CATALOGUE) as SkuId[]) {
    const sku = CATALOGUE[id];
    if (!priceIdFor(sku)) {
      out.push({ sku: id, envVar: sku.envVar, ok: false, reason: `${sku.envVar} is not set` });
      continue;
    }
    try {
      const resolved = await resolvePrice(sku);
      out.push(
        resolved.ok
          ? { sku: id, envVar: sku.envVar, ok: true }
          : { sku: id, envVar: sku.envVar, ok: false, reason: scrub(resolved.reason) },
      );
    } catch (e) {
      out.push({ sku: id, envVar: sku.envVar, ok: false, reason: scrub((e as Error).message) });
    }
  }
  return out;
}

/**
 * The two tables checkout writes, read with the service role.
 *
 * `billing_customers` is the one that bites: checkout reads it before it will
 * create a Stripe customer, and a project that never had 0003_billing.sql
 * applied answers with an error the route turns into a 500 — for every player,
 * on every plan, only ever after they have signed in. `limit 1` and no columns
 * beyond the key, because this is asking whether the table is THERE.
 */
async function checkTables(): Promise<TableCheck[]> {
  let db: ReturnType<typeof adminClient>;
  try {
    db = adminClient();
  } catch (e) {
    return [{ table: "*", ok: false, reason: (e as Error).message }];
  }

  const tables: Array<[string, string]> = [
    ["entitlements", "profile_id"],
    ["billing_customers", "profile_id"],
  ];

  const out: TableCheck[] = [];
  for (const [table, column] of tables) {
    const { error } = await db.from(table).select(column).limit(1);
    out.push(error ? { table, ok: false, reason: scrub(error.message) } : { table, ok: true });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const missing = missingBillingConfig();
  const configured = billingConfigured();

  // Which SKUs have no price id. Reported even when the four core variables
  // are set, because "checkout says the SKU is not configured" is the other
  // half of this question.
  const missingPrices = (Object.keys(CATALOGUE) as SkuId[]).filter(
    (id) => !priceIdFor(CATALOGUE[id]),
  ).map((id) => CATALOGUE[id].envVar);

  /*
   * Read from the key alone, NEVER gated on `configured`.
   *
   * This used to be `configured && isLiveMode()`, so a deploy that was missing
   * any other variable reported `live: false` no matter what key it held — and
   * the field was then read as "you are in test mode", which is the one thing
   * it must never say wrongly. The mode of the key is a fact about the key.
   */
  const mode = stripeMode();

  // Only when asked for, and only when there is something to ask: with the
  // core variables missing there is no Stripe client and no service role to
  // run these with, and `missing` above is already the whole answer.
  const deepAsked = configured && req.nextUrl.searchParams.get("deep") === "1";

  /*
   * `?deep=1` fires a Stripe round trip per SKU. It is an operator diagnostic
   * run by hand a few times, but nothing stopped an anonymous caller from
   * looping it — a dozen-plus Stripe reads each, sharing the account's rate
   * budget with real checkouts until they start failing. So the deep path is
   * metered per address; the base call every pricing screen makes on mount is
   * untouched. Fails open where there is no throttle store, same as everywhere.
   */
  let deepThrottled = false;
  if (deepAsked) {
    const gate = await throttle([
      { bucket: "billing_deep:ip", key: callerKey(req), limit: 10, windowMinutes: 15 },
    ]);
    deepThrottled = !gate.allowed;
  }
  const deep = deepAsked && !deepThrottled;
  const prices = deep ? await checkSkus() : null;
  const tables = deep ? await checkTables() : null;

  const broken = [
    ...(prices ?? []).filter((p) => !p.ok).map((p) => p.envVar),
    ...(tables ?? []).filter((t) => !t.ok).map((t) => `table ${t.table}`),
  ];

  return NextResponse.json({
    configured,
    mode,
    live: mode === "live",
    // Which SKUs are actually purchasable right now.
    skus: configured ? availableSkus() : [],

    // ── Diagnostics ────────────────────────────────────────────────────────
    /** Required variables that are unset. Empty when `configured` is true. */
    missing,
    /** Price ids that are unset. Each one disables exactly one button. */
    missingPrices,

    /** `?deep=1` only: each SKU resolved and verified against Stripe. */
    ...(prices ? { prices } : {}),
    /** `?deep=1` only: the tables checkout cannot run without. */
    ...(tables ? { tables } : {}),
    /** `?deep=1` asked but rate-limited: the deep checks were skipped this time
     *  to keep the Stripe read budget for real checkouts. Try again shortly. */
    ...(deepThrottled ? { deepThrottled: true } : {}),

    /**
     * The commonest cause by far, and not something the server can detect:
     * variables added to a hosting dashboard do not reach a build that already
     * happened. Said here because the alternative is half an hour of checking
     * spellings that were right.
     */
    // Loudest thing in the payload when it is true, because the difference
    // between the two modes is whether a test run charges a real card.
    ...(mode === "live"
      ? { WARNING: "LIVE key — checkouts here charge real cards. Test card 4242… will be DECLINED." }
      : {}),

    hint:
      missing.length > 0
        ? "Set these, then REDEPLOY — env vars added after a build do not reach it. On Vercel, check you set them for the right environment (Production vs Preview)."
        : // Ahead of `missingPrices`, which it already contains: a deep run
          // knows both which ids are unset AND which set ones do not work, and
          // reporting only the first half sends an operator to check spellings
          // that were right.
          broken.length > 0
          ? `Checkout will fail on: ${broken.join(", ")}. See prices/tables above for each reason.`
          : missingPrices.length > 0
            ? "Core config is complete. Each price id above disables one purchase button until set."
            : deep
              ? "Billing is fully configured, every price verifies against Stripe, and both billing tables are reachable. A checkout that still fails is a signed-out or already-subscribed caller, not configuration."
              : "Billing is fully configured. Add ?deep=1 to verify the prices against Stripe and the billing tables against the database.",
  });
}
