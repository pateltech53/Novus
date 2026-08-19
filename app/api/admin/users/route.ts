import { NextResponse, type NextRequest } from "next/server";

import { adminGate } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users?q=&limit=&offset=&format=csv — the account directory.
 *
 * One call to admin_list_users (0009, widened in 0016), which joins auth.users
 * to everything this schema knows about each account — including, since 0016,
 * what the account has actually DONE: runs completed, companies founded, and
 * what those companies are worth. The function is service-role only and
 * `security definer`; the gate above is therefore the entire reason a browser
 * can reach this data, which is why the gate runs first and unconditionally.
 *
 * `format=csv` returns the same rows as a download, so a question this console
 * does not answer in a band can be answered in a spreadsheet without anyone
 * opening the Supabase dashboard. It is the same query behind the same gate —
 * no wider, just a different content type.
 */

/** The row shape admin_list_users returns, in the database's own names. */
interface ListRow {
  id: string;
  email: string | null;
  display_name: string | null;
  board_handle: string | null;
  role: string;
  is_anonymous: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  last_seen: string | null;
  pro: boolean;
  paid: boolean;
  effective_pro: boolean;
  access_source: string | null;
  billing_mismatch: string | null;
  comp_pro: boolean;
  comp_until: string | null;
  comp_note: string | null;
  chapter: string | null;
  extra_islands: number;
  extra_year_closes: number;
  industry_packs: string[];
  intent: string | null;
  subscription_status: string | null;
  plan: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  owns_chapter_id: string | null;
  owns_chapter_status: string | null;
  owns_chapter_source: string | null;
  owns_chapter_licence: string | null;
  seat_chapter_id: string | null;
  runs_completed: number;
  best_year: number;
  companies: number;
  companies_alive: number;
  top_valuation: number;
  live_valuation: number;
  top_company: string | null;
  board_entries: number;
  total: number;
}

/** One CSV cell. Quoted always, quotes doubled — the only two rules a
 *  spreadsheet needs, and the reason a company called `Bell, Book & Co "Ltd"`
 *  does not become three columns. */
const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replaceAll('"', '""')}"`;
};

const CSV_COLUMNS: Array<[string, (r: ListRow) => unknown]> = [
  ["profile_id", (r) => r.id],
  ["email", (r) => r.email],
  ["display_name", (r) => r.display_name],
  ["board_handle", (r) => r.board_handle],
  ["role", (r) => r.role],
  ["anonymous", (r) => r.is_anonymous],
  ["joined", (r) => r.created_at],
  ["last_seen", (r) => r.last_seen],
  ["access", (r) => r.access_source ?? "free"],
  ["paid", (r) => r.paid],
  ["plan", (r) => r.plan],
  ["subscription_status", (r) => r.subscription_status],
  ["period_end", (r) => r.current_period_end],
  ["cancelling", (r) => r.cancel_at_period_end],
  ["billing_mismatch", (r) => r.billing_mismatch],
  ["gifted_pro", (r) => r.comp_pro],
  ["gift_until", (r) => r.comp_until],
  ["chapter", (r) => r.chapter],
  ["industry_packs", (r) => (r.industry_packs ?? []).join(" ")],
  ["extra_islands", (r) => r.extra_islands],
  ["extra_year_closes", (r) => r.extra_year_closes],
  ["runs_completed", (r) => r.runs_completed],
  ["best_year", (r) => r.best_year],
  ["companies", (r) => r.companies],
  ["companies_alive", (r) => r.companies_alive],
  ["top_company", (r) => r.top_company],
  ["top_valuation", (r) => r.top_valuation],
  ["live_valuation", (r) => r.live_valuation],
  ["board_entries", (r) => r.board_entries],
];

export async function GET(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const csv = req.nextUrl.searchParams.get("format") === "csv";
  // The export takes the function's own ceiling rather than the list's fifty:
  // a spreadsheet of the first page is not an export.
  const fallback = csv ? 200 : 50;
  const limit = Math.min(
    200,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? fallback) || fallback),
  );
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);

  const { data, error } = await adminClient().rpc("admin_list_users", {
    p_query: q,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return withSession(
      NextResponse.json({ ok: false, reason: "read-failed" }, { status: 503 }),
      gate.session,
    );
  }

  const rows = (data ?? []) as ListRow[];

  if (csv) {
    // The leading BOM is Excel's: without one it reads a UTF-8 CSV as
    // Latin-1, and an export where every accented name is mojibake is not an
    // export. Every other spreadsheet on earth ignores it.
    const body =
      "\uFEFF" +
      [
        CSV_COLUMNS.map(([name]) => cell(name)).join(","),
        ...rows.map((r) => CSV_COLUMNS.map(([, read]) => cell(read(r))).join(",")),
      ].join("\n");

    return withSession(
      new NextResponse(body, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="novus-accounts.csv"',
        },
      }),
      gate.session,
    );
  }

  return withSession(
    NextResponse.json({
      ok: true,
      total: rows[0]?.total ?? 0,
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        boardHandle: r.board_handle,
        role: r.role,
        anonymous: r.is_anonymous,
        createdAt: r.created_at,
        lastSignInAt: r.last_sign_in_at,
        lastSeen: r.last_seen,
        pro: r.pro,
        // 0016's honest answer: `pro` is the entitlement flag alone, `paid` is
        // that OR a subscription Stripe currently calls live. The console
        // badges `paid`; `pro` is kept so the panel can still show which of
        // the two records is the one saying so.
        paid: r.paid,
        effectivePro: r.effective_pro,
        accessSource: r.access_source,
        billingMismatch: r.billing_mismatch,
        compPro: r.comp_pro,
        compUntil: r.comp_until,
        compNote: r.comp_note,
        chapter: r.chapter,
        extraIslands: r.extra_islands,
        extraYearCloses: r.extra_year_closes,
        industryPacks: r.industry_packs,
        intent: r.intent,
        subscriptionStatus: r.subscription_status,
        plan: r.plan,
        currentPeriodEnd: r.current_period_end,
        cancelAtPeriodEnd: r.cancel_at_period_end,
        ownsChapter: r.owns_chapter_id
          ? {
              id: r.owns_chapter_id,
              status: r.owns_chapter_status,
              source: r.owns_chapter_source,
              licence: r.owns_chapter_licence,
            }
          : null,
        seatChapterId: r.seat_chapter_id,
        runsCompleted: r.runs_completed,
        bestYear: r.best_year,
        companies: r.companies,
        companiesAlive: r.companies_alive,
        topCompany: r.top_company,
        topValuation: r.top_valuation,
        liveValuation: r.live_valuation,
        boardEntries: r.board_entries,
      })),
    }),
    gate.session,
  );
}
