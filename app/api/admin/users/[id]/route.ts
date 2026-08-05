import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { windDownOwnedChapters } from "@/lib/stripe/chapter";
import { cancelActivePersonalPro } from "@/lib/stripe/subscription";
import { adminClient } from "@/lib/supabase/admin";
import { purgeAccountRows } from "@/lib/supabase/purge";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/users/[id]
 *
 * GET    — everything the schema knows about one account, for the console's
 *          detail panel. Reads run on the service role after the gate; every
 *          query filters by the id in the path (lib/supabase/admin.ts's
 *          standing rule — there is no RLS backstop here).
 * DELETE — the support tool for "please delete my child's account". Refused
 *          for admins (demote in the dashboard first, so two admins cannot
 *          delete each other in a squabble) and for the caller themselves
 *          (Settings has the self-serve path with its own confirmation).
 *          auth.users cascades through profiles to every table in the schema.
 */

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;

  const { id } = await ctx.params;
  if (!isUuid(id)) return withSession(bad(400, "not a profile id"), gate.session);

  const db = adminClient();

  const [user, profile, entitlements, billing, ownedChapters, seat, saves, legacy, board, log] =
    await Promise.all([
      db.auth.admin.getUserById(id),
      db.from("profiles").select("display_name, board_handle, role, admin_view, accepted_privacy_at, created_at").eq("id", id).maybeSingle(),
      db.from("entitlements").select("pro, extra_islands, extra_year_closes, industry_packs, cosmetic_bundles, chapter, intent, comp_pro, comp_until, comp_note").eq("profile_id", id).maybeSingle(),
      db.from("billing_customers").select("subscription_status, plan, current_period_end, cancel_at_period_end, created_at").eq("profile_id", id).maybeSingle(),
      db.from("chapters").select("id, licence, seats, status, source, current_period_end, created_at").eq("owner_profile_id", id).order("created_at", { ascending: false }),
      db.from("chapter_seats").select("chapter_id, email, origin, claimed_at, created_at").eq("profile_id", id).maybeSingle(),
      db.from("saves").select("slot, company_name, industry, year, month, stage, alive, ended_by, updated_at").eq("profile_id", id).order("slot"),
      db.from("legacy").select("best_year, runs_completed, shark_respect, badges").eq("profile_id", id).maybeSingle(),
      db.from("leaderboard_entries").select("id, board, season, company_name, industry, peak_valuation, years_survived, listed, created_at").eq("profile_id", id).order("created_at", { ascending: false }).limit(20),
      db.from("admin_audit").select("action, actor_email, detail, created_at").eq("target", id).order("created_at", { ascending: false }).limit(20),
    ]);

  const account = user.data?.user;
  if (!account && !profile.data) {
    return withSession(bad(404, "no such account"), gate.session);
  }

  return withSession(
    NextResponse.json({
      ok: true,
      user: {
        id,
        email: account?.email ?? null,
        anonymous: (account as { is_anonymous?: boolean } | null | undefined)?.is_anonymous === true,
        createdAt: account?.created_at ?? null,
        lastSignInAt: account?.last_sign_in_at ?? null,
        displayName: profile.data?.display_name ?? null,
        boardHandle: profile.data?.board_handle ?? null,
        role: profile.data?.role ?? "player",
        adminView: profile.data?.admin_view ?? null,
        acceptedPrivacyAt: profile.data?.accepted_privacy_at ?? null,
      },
      entitlements: entitlements.data ?? null,
      billing: billing.data ?? null,
      ownedChapters: ownedChapters.data ?? [],
      seat: seat.data ?? null,
      saves: saves.data ?? [],
      legacy: legacy.data ?? null,
      board: board.data ?? [],
      audit: log.data ?? [],
    }),
    gate.session,
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return withSession(bad(400, "not a profile id"), gate.session);
  if (id === gate.session.userId) {
    return withSession(
      bad(409, "not your own account from here — Settings has the self-serve path"),
      gate.session,
    );
  }

  const db = adminClient();

  // The email is captured BEFORE the delete: after it, there is nothing left
  // to name in the audit row, and a deletion log that says only a uuid is a
  // log about nobody.
  const [target, targetProfile] = await Promise.all([
    db.auth.admin.getUserById(id),
    db.from("profiles").select("role").eq("id", id).maybeSingle(),
  ]);

  if (!target.data?.user) {
    return withSession(bad(404, "no such account"), gate.session);
  }
  if (targetProfile.data?.role === "admin") {
    return withSession(
      bad(409, "that account is an admin — demote it in the Supabase dashboard first"),
      gate.session,
    );
  }

  const email = target.data.user.email ?? null;

  /*
   * Wind down owned chapters BEFORE the cascade removes them. The cascade
   * deletes the chapter and its seats, but each member's entitlements.chapter
   * lives on the member's own profile — nothing clears it once the chapter row
   * is gone, so a whole class would keep Pro-equivalent access forever. And a
   * licence's Stripe subscription lives on the chapter, not billing_customers,
   * so it would keep charging the school. This lapses every seat and cancels
   * every live licence; any subscription it could not stop is surfaced to the
   * operator to cancel in Stripe rather than silently stranded.
   */
  const { failedCancellations } = await windDownOwnedChapters(db, id, {
    cancelSubscriptions: true,
  });

  // The personal Pro subscription lives on billing_customers, not chapters, so
  // the wind-down above never touches it. Cancel it too, or a deleted
  // subscriber's card keeps being charged with no account to serve. Unlike the
  // self-serve path this warns rather than refuses — a support agent deleting an
  // account on request should not be blocked by a Stripe hiccup, but must be
  // told to finish the cancellation by hand.
  const pro = await cancelActivePersonalPro(db, id);
  const uncancelled = [
    ...failedCancellations,
    ...(pro.ok ? [] : pro.subscriptionId ? [pro.subscriptionId] : []),
  ];

  const { error } = await db.auth.admin.deleteUser(id);
  if (error) {
    return withSession(bad(503, `delete failed: ${error.message}`), gate.session);
  }

  // Belt and braces behind the cascade: clear every table by name, so "delete
  // this account" holds even against a production schema that drifted from the
  // migrations. A table that refuses is surfaced to the operator, not swallowed.
  const leftovers = await purgeAccountRows(db, id);

  await audit(gate.session, "account_delete", {
    target: id,
    targetEmail: email,
    detail: {
      ...(uncancelled.length ? { uncancelledSubscriptions: uncancelled } : {}),
      ...(leftovers.length ? { tablesNotPurged: leftovers } : {}),
    },
  });

  const warnings = [
    ...(uncancelled.length
      ? [
          "The account was deleted, but a Stripe subscription could not be cancelled automatically — cancel it in the Stripe dashboard.",
        ]
      : []),
    ...(leftovers.length
      ? [
          `The account was deleted, but some rows could not be purged (${leftovers.join("; ")}) — check the database.`,
        ]
      : []),
  ];

  return withSession(
    NextResponse.json({
      ok: true,
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
      ...(uncancelled.length ? { uncancelledSubscriptions: uncancelled } : {}),
    }),
    gate.session,
  );
}
