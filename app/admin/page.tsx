"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
import { useNativeOverlay, useNativeOverlayOwned } from "@/components/native/useNativeOverlay";
import { useResolvedTheme } from "@/lib/native/theme";
import { appPath } from "@/lib/native/href";
import { entryRoute } from "@/lib/entry";
import { storefront } from "@/lib/commerce";
import {
  ChartShell,
  DailyBars,
  DualLines,
  RecencyBars,
  WeeklyPercentBars,
  type WeeklyBar,
} from "@/components/admin/charts";
import { restorePurchases } from "@/lib/cloud/billing";
import { INDUSTRIES } from "@/lib/engine/constants";
import { fmtMoney } from "@/lib/engine/format";
import {
  CHAPTER_CUSTOM_MAX_SEATS,
  CHAPTER_CUSTOM_MIN_SEATS,
  CHAPTER_LICENCES,
  formatPrice,
  FREE_LIMITS,
  ISLAND_CAP,
  isCustomSeatCount,
  PRO_LIMITS,
  PRO_MONTHLY,
  PRO_YEARLY,
} from "@/lib/monetization";
import { play } from "@/lib/sound";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

/**
 * /admin — the operator's console.
 *
 * Reached by URL, linked from nowhere: the role is a cell in the database
 * (profiles.role — the first admin is made in the Supabase dashboard, every
 * one after that from the ROLE band below; docs/ADMIN.md), and to
 * everyone else this page renders the same "nothing here" the API answers
 * with. Everything on it talks to app/api/admin/*; the page itself holds no
 * privilege beyond the operator's own session cookie, exactly like /chapter.
 *
 * One page, four bands: the numbers, the accounts (search → detail → grants),
 * the moderation queue, and the view switch in the masthead that makes the
 * admin's OWN account play as free / pro / all for testing paywalls.
 */

// ── Wire shapes (app/api/admin/*) ───────────────────────────────────────────

interface UserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  boardHandle: string | null;
  role: string;
  anonymous: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  lastSeen: string | null;
  /** The entitlement flag alone — what the webhook wrote. */
  pro: boolean;
  /** That OR a subscription Stripe currently calls live (0016). This is the
   *  one the badge reads: an account being charged is a paying account
   *  whether or not the flag beside it agrees. */
  paid: boolean;
  effectivePro: boolean;
  /** Why this account has Pro: admin / paid / gift / chapter, or null. */
  accessSource: string | null;
  /** 'stripe-not-granted' | 'granted-not-billed' | null. */
  billingMismatch: string | null;
  compPro: boolean;
  compUntil: string | null;
  compNote: string | null;
  chapter: string | null;
  extraIslands: number;
  extraYearCloses: number;
  industryPacks: string[];
  subscriptionStatus: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  ownsChapter: { id: string; status: string | null; source: string | null; licence: string | null } | null;
  seatChapterId: string | null;
  // ── What the account has actually done (0016) ────────────────────────────
  runsCompleted: number;
  bestYear: number;
  companies: number;
  companiesAlive: number;
  topCompany: string | null;
  topValuation: number;
  liveValuation: number;
  boardEntries: number;
}

/** One row of admin_billing_mismatches — the two billing records disagreeing. */
interface Mismatch {
  id: string;
  email: string | null;
  display_name: string | null;
  kind: "stripe-not-granted" | "granted-not-billed";
  entitlement_pro: boolean;
  subscription_status: string | null;
  plan: string | null;
  current_period_end: string | null;
  has_customer: boolean;
}

/** One row of admin_top_companies. */
interface TopCompany {
  profile_id: string;
  email: string | null;
  board_handle: string | null;
  company_name: string;
  industry: string;
  year: number;
  stage: number;
  alive: boolean;
  valuation: number;
  peak_valuation: number;
  updated_at: string;
}

interface Detail {
  user: {
    id: string;
    email: string | null;
    anonymous: boolean;
    createdAt: string | null;
    lastSignInAt: string | null;
    displayName: string | null;
    boardHandle: string | null;
    role: string;
    acceptedPrivacyAt: string | null;
  };
  entitlements: {
    pro: boolean;
    extra_islands: number;
    extra_year_closes: number;
    industry_packs: string[];
    cosmetic_bundles: string[];
    chapter: string | null;
    intent: string | null;
    comp_pro: boolean;
    comp_until: string | null;
    comp_note: string | null;
  } | null;
  billing: {
    subscription_status: string | null;
    plan: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
  ownedChapters: Array<{
    id: string;
    licence: string;
    seats: number;
    status: string;
    source: string;
    current_period_end: string | null;
  }>;
  seat: { chapter_id: string; email: string; claimed_at: string | null } | null;
  /** admin_user_companies (0016) — the listing columns plus the figures. */
  saves: Array<{
    slot: number;
    company_name: string;
    industry: string;
    year: number;
    month: number;
    stage: number;
    alive: boolean;
    ended_by: string | null;
    valuation: number;
    peak_valuation: number;
    cash: number;
    revenue_annual: number;
    employees: number | null;
    updated_at: string;
  }>;
  legacy: { best_year: number; runs_completed: number; shark_respect: number; badges: string[] } | null;
  board: Array<{
    id: string;
    board: string;
    season: string;
    company_name: string;
    peak_valuation: number;
    years_survived: number;
    listed: boolean;
  }>;
  audit: Array<{ action: string; actor_email: string | null; detail: Record<string, unknown>; created_at: string }>;
}

interface QueueRow {
  id: string;
  board: string;
  season: string;
  company_name: string;
  founder_display_name: string;
  industry: string;
  peak_valuation: number;
  years_survived: number;
  reports: number;
  created_at: string;
}

interface Stats {
  accounts?: number;
  anonymous?: number;
  admins?: number;
  newWeek?: number;
  activeToday?: number;
  activeWeek?: number;
  activeMonth?: number;
  /** The last-seen histogram: within 1d / 1–7d / 7–30d / 30–90d / older. */
  activity?: { d1: number; d7: number; d30: number; d90: number; older: number };
  // ── Paid, and the evidence on both sides of it (0016) ────────────────────
  /** Entitlement flag OR a live Stripe subscription. The honest total. */
  proPaid?: number;
  /** Stripe alone. */
  proStripe?: number;
  /** The entitlement flag alone — what the old, wrong tile counted. */
  proGranted?: number;
  proComp?: number;
  proChapter?: number;
  proEffective?: number;
  proMonthly?: number;
  proYearly?: number;
  proUnknownPlan?: number;
  billingMismatch?: number;
  notGranted?: number;
  notBilled?: number;
  cancelling?: number;
  pastDue?: number;
  chapterSeats?: number;
  chaptersActive?: number;
  chaptersComp?: number;
  // ── What has been played ─────────────────────────────────────────────────
  runsCompleted?: number;
  runsToday?: number;
  companies?: number;
  savesAlive?: number;
  playersPlaying?: number;
  islandsSold?: number;
  valuationLive?: number;
  valuationBest?: number;
  boardEntries?: number;
  boardListed?: number;
  boardQueue?: number;
}

/** One admin_timeseries row. actives/runs are null before tracking began. */
interface SeriesRow {
  day: string;
  signups: number;
  submissions: number;
  actives: number | null;
  runs_started: number | null;
}

/** One admin_cohorts row — raw counts; percentages are derived here. */
interface CohortRow {
  week: string;
  cohort: number;
  bounced: number;
  retained_7: number;
  retained_30: number;
}

interface AuditRow {
  action: string;
  actor_email: string | null;
  target_email: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

type View = "free" | "pro" | "all";
type Phase = "loading" | "denied" | "ready";

/** The directory's lens. Every one of these answers a question an operator
 *  actually asks out loud — "who is paying", "who is stuck", "who plays". */
type Filter =
  | "all"
  | "paid"
  | "gifted"
  | "chapter"
  | "playing"
  | "mismatch"
  | "admins"
  | "anonymous";

type Sort = "joined" | "seen" | "runs" | "value";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "EVERYONE" },
  { id: "paid", label: "PAYING" },
  { id: "gifted", label: "GIFTED" },
  { id: "chapter", label: "CHAPTER" },
  { id: "playing", label: "PLAYING" },
  { id: "mismatch", label: "BILLING ⚠" },
  { id: "admins", label: "ADMINS" },
  { id: "anonymous", label: "ANONYMOUS" },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: "joined", label: "NEWEST" },
  { id: "seen", label: "LAST SEEN" },
  { id: "runs", label: "MOST RUNS" },
  { id: "value", label: "BIGGEST CO." },
];

const matchesFilter = (u: UserRow, filter: Filter): boolean => {
  switch (filter) {
    case "paid":      return u.paid;
    case "gifted":    return u.compPro;
    case "chapter":   return !!u.chapter || u.ownsChapter?.status === "active";
    case "playing":   return u.companiesAlive > 0;
    case "mismatch":  return !!u.billingMismatch;
    case "admins":    return u.role === "admin";
    case "anonymous": return u.anonymous;
    default:          return true;
  }
};

const compare = (a: UserRow, b: UserRow, sort: Sort): number => {
  switch (sort) {
    case "seen":
      return Date.parse(b.lastSeen ?? b.createdAt) - Date.parse(a.lastSeen ?? a.createdAt);
    case "runs":
      return b.runsCompleted - a.runsCompleted || b.companies - a.companies;
    case "value":
      return b.topValuation - a.topValuation;
    default:
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  }
};

// ── Plumbing ────────────────────────────────────────────────────────────────

/**
 * Where BACK TO NOVUS goes. On the web that is the front page. In the app it
 * must not be: "/" is the marketing landing with prices and checkout on it,
 * which a store build is not allowed to show (lib/commerce.ts) — and an
 * extensionless document navigation would resolve to it anyway
 * (lib/native/href.ts). So the app goes to the ordinary entry route, by
 * filename.
 */
const homeHref = (): string =>
  storefront() === "web" ? "/" : appPath(entryRoute());

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(path), {
      credentials: API_CREDENTIALS,
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    throw e instanceof Error ? e : new Error("Could not reach the server.");
  }
}

const day = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

/** ISO for "now plus n days", for the gift chips. */
const inDays = (n: number): string => new Date(Date.now() + n * 86400000).toISOString();

/** A company's worth, in the game's own shorthand — "$1.4M", "$860K". The
 *  console reads the same figures the year-end statement does, so it should
 *  read them the same way. */
const money = (n: number | null | undefined): string =>
  typeof n === "number" && Number.isFinite(n) ? fmtMoney(n) : "—";

/** Recurring revenue, monthly, from the subscription counts. The prices come
 *  from lib/monetization.ts rather than a constant here, so a price rise is
 *  one edit in the place prices already live. A yearly plan is divided by
 *  twelve — this is what the month is worth, not what was charged this month. */
const monthlyRevenueCents = (stats: Stats): number =>
  (stats.proMonthly ?? 0) * PRO_MONTHLY.priceCents +
  Math.round(((stats.proYearly ?? 0) * PRO_YEARLY.priceCents) / 12);

const INDUSTRY_CODES = INDUSTRIES.map((i) => i.code);

// ── The page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<View>("all");
  const [email, setEmail] = useState<string | null>(null);
  // The operator's own profile id, so the directory can tell "this row is me"
  // and leave the role alone there (/api/admin/role refuses it regardless).
  const [selfId, setSelfId] = useState<string | null>(null);

  const [stats, setStats] = useState<Stats>({});
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [topCompanies, setTopCompanies] = useState<TopCompany[]>([]);
  const [auditTail, setAuditTail] = useState<AuditRow[]>([]);

  const [q, setQ] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  /* The directory's own lens. Filtering and sorting happen on the page rather
     than in the query: the list is at most 200 rows, and a round trip to
     re-sort a list already in memory is a spinner nobody needed to see. */
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("joined");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // ── Loads ─────────────────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    const body = await call<{
      stats: Stats;
      series: SeriesRow[];
      cohorts: CohortRow[];
      mismatches: Mismatch[];
      topCompanies: TopCompany[];
      audit: AuditRow[];
    }>("/api/admin/stats");
    if (body) {
      setStats(body.stats);
      setSeries(body.series ?? []);
      setCohorts(body.cohorts ?? []);
      setMismatches(body.mismatches ?? []);
      setTopCompanies(body.topCompanies ?? []);
      setAuditTail(body.audit);
    }
  }, []);

  const loadUsers = useCallback(async (needle: string) => {
    /*
     * 200, the function's own ceiling, rather than 50.
     *
     * The filter chips below cut the list down on this page, and a chip that
     * says PAID while the server only sent the fifty newest accounts is a
     * filter that lies by omission — it would show "3 paid" out of a database
     * with thirty. The count under the heading still says how many the search
     * actually matched, so a search wider than one page announces itself.
     */
    const body = await call<{ users: UserRow[]; total: number }>(
      `/api/admin/users?q=${encodeURIComponent(needle)}&limit=200`,
    );
    if (body) {
      setUsers(body.users);
      setTotal(body.total);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    const body = await call<{ queue: QueueRow[] }>("/api/admin/moderation");
    if (body) setQueue(body.queue);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const body = await call<Detail & { ok: boolean }>(`/api/admin/users/${id}`);
    if (body) setDetail(body);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const me = await call<{ ok: boolean; id: string; view: View; email: string | null }>(
          "/api/admin/me",
        );
        if (!alive) return;
        if (!me?.ok) {
          setPhase("denied");
          return;
        }
        setView(me.view);
        setEmail(me.email);
        setSelfId(me.id);
        setPhase("ready");
        await Promise.all([loadStats(), loadUsers(""), loadQueue()]);
      } catch {
        if (alive) setPhase("denied");
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadStats, loadUsers, loadQueue]);

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Runs one console action: busy state, error note, then refresh. */
  const act = useCallback(
    async (key: string, work: () => Promise<unknown>, refresh: Array<() => Promise<void>>) => {
      if (busy) return;
      setBusy(key);
      setNote(null);
      try {
        await work();
        play("success");
        await Promise.all(refresh.map((fn) => fn()));
      } catch (e) {
        setNote((e as Error).message);
      }
      setBusy(null);
    },
    [busy],
  );

  /*
   * Take the operator to an account they found somewhere other than the
   * directory — a billing mismatch, a company on the leaderboard of the
   * biggest. The search box is set to the account so the row is definitely in
   * the list when it opens: expanding a row the list does not contain would
   * draw a detail panel attached to nothing.
   */
  const openAccount = useCallback(
    (id: string, needle: string | null) => {
      const search = needle ?? id;
      setQ(search);
      setOpenId(id);
      setDetail(null);
      void loadUsers(search);
      void loadDetail(id);
    },
    [loadUsers, loadDetail],
  );

  const refreshOpen = useCallback(async () => {
    if (openId) await loadDetail(openId);
    await loadUsers(q);
  }, [openId, q, loadDetail, loadUsers]);

  const switchView = (next: View) =>
    act(
      `view:${next}`,
      async () => {
        await call("/api/admin/view", { method: "POST", body: JSON.stringify({ view: next }) });
        setView(next);
        // The game reads entitlements from its local cache; pull the fresh
        // overlay down now so the switch is visible without a reload.
        await restorePurchases();
      },
      [],
    );

  const giftPro = (id: string, until: string | null) =>
    act(
      `comp:${id}`,
      () =>
        call("/api/admin/comp", {
          method: "POST",
          body: JSON.stringify({ profileId: id, active: true, until, note: "console gift" }),
        }),
      [refreshOpen],
    );

  const revokePro = (id: string) =>
    act(
      `comp:${id}`,
      () =>
        call("/api/admin/comp", {
          method: "POST",
          body: JSON.stringify({ profileId: id, active: false }),
        }),
      [refreshOpen],
    );

  const togglePack = (id: string, industry: string, grant: boolean) =>
    act(
      `pack:${industry}`,
      () =>
        call("/api/admin/packs", {
          method: "POST",
          body: JSON.stringify({ profileId: id, industry, grant }),
        }),
      [refreshOpen],
    );

  const setIslands = (id: string, islands: number) =>
    act(
      "islands",
      () =>
        call("/api/admin/islands", {
          method: "POST",
          body: JSON.stringify({ profileId: id, islands }),
        }),
      [refreshOpen],
    );

  const setYearCloses = (id: string, closes: number) =>
    act(
      "years",
      () =>
        call("/api/admin/years", {
          method: "POST",
          body: JSON.stringify({ profileId: id, closes }),
        }),
      [refreshOpen],
    );

  const grantChapter = (id: string, licence: string, seats?: number) =>
    act(
      `chapter:${licence}`,
      () =>
        call("/api/admin/chapters", {
          method: "POST",
          body: JSON.stringify({
            ownerProfileId: id,
            licence,
            ...(seats !== undefined ? { seats } : {}),
          }),
        }),
      [refreshOpen, loadStats],
    );

  const revokeChapter = (chapterId: string) =>
    act(
      "chapter:revoke",
      () =>
        call("/api/admin/chapters", {
          method: "DELETE",
          body: JSON.stringify({ chapterId }),
        }),
      [refreshOpen, loadStats],
    );

  // Promotion and demotion, the one grant that is not content or pace: it
  // hands over the console itself. loadStats refreshes because the overview
  // counts admins, and a promotion that did not move that number would look
  // like it had not happened.
  const setRole = (id: string, role: "admin" | "player") =>
    act(
      "role",
      () =>
        call("/api/admin/role", {
          method: "POST",
          body: JSON.stringify({ profileId: id, role }),
        }),
      [refreshOpen, loadStats],
    );

  const deleteAccount = (id: string) =>
    act(
      "delete",
      () => call(`/api/admin/users/${id}`, { method: "DELETE" }),
      [
        async () => {
          setOpenId(null);
          setDetail(null);
        },
        () => loadUsers(q),
        loadStats,
      ],
    );

  /*
   * Ask Stripe what is true and write it down.
   *
   * Not a grant: /api/admin/reconcile reads the subscription back FROM Stripe
   * and hands it to the same syncSubscription both webhook paths call, so this
   * button cannot give Pro to anyone Stripe is not already charging — and will
   * take it away if Stripe says the subscription ended. That is what makes it
   * safe to press on any account without thinking about it.
   */
  const reconcile = (id: string) =>
    act(
      `reconcile:${id}`,
      async () => {
        const out = await call<{ ok: boolean; message?: string }>("/api/admin/reconcile", {
          method: "POST",
          body: JSON.stringify({ profileId: id }),
        });
        if (out?.message) setNote(out.message);
      },
      [refreshOpen, loadStats],
    );

  /*
   * The directory, as a file.
   *
   * A fetch rather than a plain link, because the export is behind the same
   * session the console is and an `<a download>` to an API route would be a
   * navigation that the native shell handles differently on every platform.
   * The blob is built here and clicked here, which works the same everywhere.
   */
  const exportCsv = () =>
    act(
      "export",
      async () => {
        const res = await fetch(
          apiUrl(`/api/admin/users?q=${encodeURIComponent(q)}&format=csv&limit=200`),
          { credentials: API_CREDENTIALS },
        );
        if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}).`);
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = "novus-accounts.csv";
        a.click();
        // Revoked on the next frame, not immediately: Safari has not finished
        // reading the blob when click() returns.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      [],
    );

  const decide = (entryId: string, listed: boolean) =>
    act(
      `mod:${entryId}`,
      () =>
        call("/api/admin/moderation", {
          method: "POST",
          body: JSON.stringify({ entryId, listed, note: "console decision" }),
        }),
      [loadQueue, loadStats],
    );

  const refreshAll = useCallback(async () => {
    await Promise.all([loadStats(), loadUsers(q), loadQueue()]);
  }, [loadStats, loadUsers, loadQueue, q]);

  /*
   * The console's chrome, drawn by UIKit — the same Liquid Glass treatment
   * the chapter console gets: the title rides the glass plate, the way back
   * is a circle on the left, refresh on the right once there is a console to
   * refresh. The charts, the roster and the queue stay DOM on every
   * platform: they are content. On the denied screen the plate says plain
   * "Novus" — the 404 posture extends to the toolbar.
   */
  const native = useNativeOverlayOwned();
  const resolvedTheme = useResolvedTheme();
  useNativeOverlay(
    useMemo(
      () => ({
        mode: "shown" as const,
        theme: resolvedTheme,
        title: phase === "ready" ? "Admin" : "Novus",
        leading: [
          {
            id: "back",
            symbol: "chevron.backward",
            label: "Back to Novus",
            style: "plain" as const,
          },
        ],
        trailing:
          phase === "ready"
            ? [
                {
                  id: "refresh",
                  symbol: "arrow.clockwise",
                  label: "Refresh the console",
                  style: "plain" as const,
                  enabled: busy === null,
                },
              ]
            : [],
      }),
      [resolvedTheme, phase, busy],
    ),
    {
      onAction: (id) => {
        if (id === "back") {
          if (window.history.length > 1) window.history.back();
          else window.location.assign(homeHref());
        } else if (id === "refresh") void refreshAll();
      },
    },
  );

  // ── Chart data, derived ───────────────────────────────────────────────────

  const signupBars = useMemo(
    () => series.map((r) => ({ day: r.day, value: r.signups })),
    [series],
  );
  const submissionBars = useMemo(
    () => series.map((r) => ({ day: r.day, value: r.submissions })),
    [series],
  );
  const trackedLines = useMemo(
    () => series.map((r) => ({ day: r.day, a: r.actives, b: r.runs_started })),
    [series],
  );

  /*
   * Retention percentages exist only for windows a cohort has fully lived
   * through — conservatively dated from the END of the signup week, so a
   * cohort is never asked "did they come back after 7 days" while its
   * youngest member is five days old. Bounce needs every member to be at
   * least a day old: the week's end plus one day.
   */
  const { retentionBars, bounceBars } = useMemo(() => {
    const now = Date.now();
    const DAY = 86400000;
    const pct = (part: number, whole: number) => Math.round((part / whole) * 100);
    const retention: WeeklyBar[] = [];
    const bounce: WeeklyBar[] = [];
    for (const c of cohorts) {
      const weekEnd = new Date(`${c.week}T00:00:00`).getTime() + 7 * DAY;
      const empty = c.cohort === 0;
      retention.push({
        week: c.week,
        a: !empty && now >= weekEnd + 7 * DAY ? pct(c.retained_7, c.cohort) : null,
        b: !empty && now >= weekEnd + 30 * DAY ? pct(c.retained_30, c.cohort) : null,
        aDetail: `${c.retained_7} of ${c.cohort}`,
        bDetail: `${c.retained_30} of ${c.cohort}`,
      });
      bounce.push({
        week: c.week,
        a: !empty && now >= weekEnd + 1 * DAY ? pct(c.bounced, c.cohort) : null,
        aDetail: `${c.bounced} of ${c.cohort}`,
      });
    }
    return { retentionBars: retention, bounceBars: bounce };
  }, [cohorts]);

  /** The list as it is actually shown: the lens applied, in memory. */
  const shown = useMemo(
    () => users.filter((u) => matchesFilter(u, filter)).sort((a, b) => compare(a, b, sort)),
    [users, filter, sort],
  );

  const mrr = useMemo(() => monthlyRevenueCents(stats), [stats]);

  const recencyBuckets = useMemo(() => {
    const a = stats.activity;
    if (!a) return [];
    return [
      { label: "today", value: a.d1, color: "var(--viz-r1)" },
      { label: "2–7 days", value: a.d7, color: "var(--viz-r2)" },
      { label: "8–30 days", value: a.d30, color: "var(--viz-r3)" },
      { label: "31–90 days", value: a.d90, color: "var(--viz-r4)" },
      { label: "dormant", value: a.older, color: "var(--viz-r5)" },
    ];
  }, [stats.activity]);

  // ── Screens ───────────────────────────────────────────────────────────────

  if (phase !== "ready") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center px-6 pb-16 pt-[max(4rem,var(--nv-safe-top),calc(var(--nv-overlay-top)+1rem))]">
        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">NOVUS</p>
        {phase === "loading" ? (
          <>
            <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
              One moment.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">Checking…</p>
          </>
        ) : (
          <>
            {/* The API's 404 posture, kept: nothing here confirms the page
                exists for accounts that cannot use it. */}
            <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
              Nothing here.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              There is nothing at this address for this account.
            </p>
            <a
              href={homeHref()}
              className="nv-gc mt-6 flex h-14 w-full items-center justify-center rounded-[var(--radius-card)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
            >
              BACK TO NOVUS
            </a>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pb-[max(6rem,calc(var(--nv-overlay-bottom)+2rem))] pt-[max(2.5rem,var(--nv-safe-top),calc(var(--nv-overlay-top)+0.75rem))]">
      {/* ── Masthead ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">
            NOVUS ADMIN
          </p>
          <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
            The console
          </h1>
          <p className="tnum mt-1 text-sm text-[var(--text-secondary)]">{email}</p>
        </div>
        {/* On iOS the way back is the toolbar's leading chevron and refresh
            its trailing circle — the DOM chip is not rendered at all rather
            than hidden, so no invisible control can take a tap. */}
        <div className="flex items-center gap-3">
          {/* The console is a working surface, read for long stretches and
              often beside a Supabase tab. Which theme it is read in belongs to
              the operator, here, rather than three taps away inside the game's
              own Settings. */}
          <ThemeToggle />
          {native ? null : (
            <a
              href={homeHref()}
              className="nv-gc rounded-full px-4 py-2 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]"
            >
              BACK TO NOVUS
            </a>
          )}
        </div>
      </div>

      {/* ── The view switch ─────────────────────────────────────────────── */}
      <section className="mt-6 rounded-[var(--radius-card)] bg-[var(--n-3)] p-5 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold tracking-[0.08em]">PLAY THIS ACCOUNT AS</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              Your own game follows this switch — FREE and PRO behave exactly like
              those tiers, locked doors included, so paywalls can be tested for real.
              ALL is everything, no card.
            </p>
          </div>
          <div className="flex gap-2">
            {(["free", "pro", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => void switchView(v)}
                disabled={busy !== null}
                className={`rounded-full px-4 py-2 text-2xs font-bold tracking-[0.1em] disabled:opacity-35 ${
                  view === v
                    ? "bg-[var(--text-primary)] text-[var(--n-1)]"
                    : "nv-gc text-[var(--text-secondary)]"
                }`}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </section>

      {note && (
        <p role="alert" className="mt-4 rounded-[var(--radius-card)] bg-[var(--alert)]/10 px-4 py-3 text-sm text-[var(--text-primary)]">
          {note}
        </p>
      )}

      {/* ── The numbers ─────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-sm font-extrabold tracking-[0.08em]">THE NUMBERS</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="ACCOUNTS" value={stats.accounts} />
          <Stat label="NEW · 7 DAYS" value={stats.newWeek} />
          <Stat label="ACTIVE TODAY" value={stats.activeToday} />
          <Stat label="ACTIVE · 7 DAYS" value={stats.activeWeek} />
          <Stat label="ACTIVE · 30 DAYS" value={stats.activeMonth} />
          {/*
            PRO · PAID is the union of both billing records (0016), not the
            entitlement flag alone — which is why it used to read zero for
            subscribers whose webhook never landed. The sub-line names the
            two halves so the number can be checked rather than trusted.
          */}
          <Stat
            label="PRO · PAID"
            value={stats.proPaid}
            sub={
              stats.proPaid !== undefined
                ? `${stats.proStripe ?? 0} live in Stripe · ${stats.proGranted ?? 0} granted`
                : undefined
            }
          />
          <Stat label="PRO · GIFTED" value={stats.proComp} />
          <Stat
            label="PRO · IN TOTAL"
            value={stats.proEffective}
            sub="paid, gifted, seats and admins"
          />
          <Stat
            label="REVENUE / MONTH"
            value={stats.proPaid === undefined ? undefined : mrr}
            display={stats.proPaid === undefined ? undefined : formatPrice(mrr)}
            sub={`${stats.proMonthly ?? 0} monthly · ${stats.proYearly ?? 0} yearly${
              stats.proUnknownPlan ? ` · ${stats.proUnknownPlan} unknown plan` : ""
            }`}
          />
          <Stat label="CHAPTERS" value={stats.chaptersActive} sub={stats.chaptersComp ? `${stats.chaptersComp} comped` : undefined} />
          <Stat label="SEATS FILLED" value={stats.chapterSeats} />
          <Stat label="ADMINS" value={stats.admins} />
        </div>

        {/* ── What has been played ─────────────────────────────────────── */}
        <h3 className="mt-6 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          WHAT HAS BEEN PLAYED
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="RUNS COMPLETED"
            value={stats.runsCompleted}
            sub="companies carried to an ending"
          />
          <Stat label="RUNS STARTED TODAY" value={stats.runsToday} />
          <Stat
            label="COMPANIES"
            value={stats.companies}
            sub={stats.savesAlive !== undefined ? `${stats.savesAlive} still alive` : undefined}
          />
          <Stat
            label="PLAYERS PLAYING"
            value={stats.playersPlaying}
            sub="accounts with a live company"
          />
          <Stat
            label="LIVE VALUE"
            value={stats.valuationLive}
            display={money(stats.valuationLive)}
            sub="every live company, added up"
          />
          <Stat
            label="BIGGEST EVER"
            value={stats.valuationBest}
            display={money(stats.valuationBest)}
            sub="the highest any books have read"
          />
          <Stat
            label="BOARD ENTRIES"
            value={stats.boardEntries}
            sub={stats.boardListed !== undefined ? `${stats.boardListed} listed` : undefined}
          />
          <Stat label="BOARD · QUEUE" value={stats.boardQueue} />
        </div>
        {auditTail.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
              RECENT ADMIN ACTIONS
            </summary>
            <ul className="mt-2">
              {auditTail.map((a, i) => (
                <li key={i} className="border-t border-[var(--hairline)] py-2 text-2xs leading-relaxed text-[var(--text-secondary)]">
                  <span className="tnum">{day(a.created_at)}</span> · <span className="font-bold">{a.action}</span>
                  {a.target_email ? ` → ${a.target_email}` : ""} · by {a.actor_email ?? "?"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ── The charts ──────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-sm font-extrabold tracking-[0.08em]">THE CHARTS</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartShell
            title="SIGNUPS / DAY"
            note="Accounts created, last 60 days."
            table={{
              head: ["day", "signups"],
              rows: signupBars.filter((d) => d.value > 0).map((d) => [d.day, d.value]).reverse(),
            }}
          >
            <DailyBars data={signupBars} />
          </ChartShell>

          <ChartShell
            title="ACTIVE PLAYERS & RUNS / DAY"
            note="Counted on each console visit — days nobody opened the console show as gaps, not zeros."
            legend={[
              { swatch: "var(--viz-1)", label: "active players" },
              { swatch: "var(--viz-2)", label: "runs started" },
            ]}
            table={{
              head: ["day", "active", "runs"],
              rows: trackedLines
                .filter((d) => d.a != null || d.b != null)
                .map((d) => [d.day, d.a ?? "—", d.b ?? "—"])
                .reverse(),
            }}
          >
            <DualLines data={trackedLines} aLabel="active" bLabel="runs" />
          </ChartShell>

          <ChartShell
            title="RETENTION BY SIGNUP WEEK"
            note="Of each week's signups, the share seen again at least 7 and 30 days later. A dot means the cohort is too young to answer."
            legend={[
              { swatch: "var(--viz-1)", label: "back after 7d" },
              { swatch: "var(--viz-2)", label: "back after 30d" },
            ]}
            table={{
              head: ["week", "cohort", "7d", "30d"],
              rows: cohorts
                .map((c) => [c.week, c.cohort, `${c.retained_7}`, `${c.retained_30}`])
                .reverse(),
            }}
          >
            <WeeklyPercentBars data={retentionBars} aLabel="back after 7d" bLabel="back after 30d" />
          </ChartShell>

          <ChartShell
            title="BOUNCE RATE BY SIGNUP WEEK"
            note="Signed up and never seen again after their first day. Lower is better."
            table={{
              head: ["week", "cohort", "bounced"],
              rows: cohorts.map((c) => [c.week, c.cohort, c.bounced]).reverse(),
            }}
          >
            <WeeklyPercentBars data={bounceBars} aLabel="bounced" />
          </ChartShell>

          <ChartShell
            title="WHEN PLAYERS WERE LAST SEEN"
            note="Every account, by how recently it was seen — sign-ins, saves, and settings all count as seen."
            table={{
              head: ["bucket", "accounts"],
              rows: recencyBuckets.map((b) => [b.label, b.value]),
            }}
          >
            <RecencyBars buckets={recencyBuckets} />
          </ChartShell>

          <ChartShell
            title="BOARD ENTRIES / DAY"
            note="Leaderboard submissions, last 60 days."
            table={{
              head: ["day", "entries"],
              rows: submissionBars.filter((d) => d.value > 0).map((d) => [d.day, d.value]).reverse(),
            }}
          >
            <DailyBars data={submissionBars} />
          </ChartShell>
        </div>
      </section>

      {/* ── Billing, and where its two records disagree ─────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em]">BILLING</h2>
          <p className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
            {mismatches.length === 0 ? "NOTHING TO FIX" : `${mismatches.length} TO CHECK`}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="PAYING & NOT PRO"
            value={stats.notGranted}
            tone="alert"
            sub="Stripe is charging; access is off"
          />
          <Stat
            label="PRO & NOT PAYING"
            value={stats.notBilled}
            sub="access is on; Stripe has nothing live"
          />
          <Stat label="CANCELLING" value={stats.cancelling} sub="Pro until the period ends" />
          <Stat label="PAST DUE" value={stats.pastDue} tone="alert" sub="a card Stripe is retrying" />
        </div>

        {mismatches.length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-card)] bg-[var(--n-2)] px-4 py-6 text-sm leading-relaxed text-[var(--text-secondary)]">
            Every account&rsquo;s entitlement agrees with its Stripe subscription.
            Nothing to reconcile.
          </p>
        ) : (
          <>
            <p className="mt-3 text-2xs leading-relaxed text-[var(--text-tertiary)]">
              <b>PAYING &amp; NOT PRO</b> is the one that costs a player money for
              nothing: Stripe is charging the card and the entitlement never
              landed, which is what a missed webhook looks like from this side.
              RECONCILE asks Stripe what is true and writes it down — it grants
              nothing Stripe is not already charging for, and it will take Pro
              back if the subscription has ended.
            </p>
            <ul className="mt-2">
              {mismatches.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--hairline)] py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="tnum truncate text-sm font-extrabold">
                      {m.email ?? "(no email)"}
                    </p>
                    <p className="tnum text-2xs text-[var(--text-tertiary)]">
                      {m.kind === "stripe-not-granted"
                        ? `Stripe says ${m.subscription_status ?? "?"} · entitlement says no Pro`
                        : `Entitlement says Pro · Stripe says ${m.subscription_status ?? "nothing live"}`}
                      {m.plan ? ` · ${m.plan}` : ""}
                      {m.current_period_end ? ` · until ${day(m.current_period_end)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {m.kind === "stripe-not-granted" && <Badge tone="alert">PAYING, NO PRO</Badge>}
                    <button
                      type="button"
                      onClick={() => openAccount(m.id, m.email)}
                      className="rounded-full border border-[var(--hairline)] px-3 py-1.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)]"
                    >
                      OPEN
                    </button>
                    <button
                      type="button"
                      onClick={() => void reconcile(m.id)}
                      disabled={busy !== null}
                      className="nv-gc rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] disabled:opacity-35"
                    >
                      {busy === `reconcile:${m.id}` ? "…" : "RECONCILE"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── The companies ───────────────────────────────────────────────── */}
      {topCompanies.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-extrabold tracking-[0.08em]">THE BIGGEST COMPANIES</h2>
            <p className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
              BY PEAK VALUATION
            </p>
          </div>
          <ul className="mt-3">
            {topCompanies.map((c, i) => (
              <li
                key={`${c.profile_id}-${c.company_name}-${i}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--hairline)] py-2.5"
              >
                <p className="tnum w-6 shrink-0 text-2xs font-bold text-[var(--text-tertiary)]">
                  {i + 1}
                </p>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">
                    {c.company_name}{" "}
                    <span className="font-normal text-[var(--text-secondary)]">
                      {c.board_handle ?? c.email ?? "—"}
                    </span>
                  </p>
                  <p className="tnum text-2xs text-[var(--text-tertiary)]">
                    {c.industry} · year {c.year} · stage {c.stage} ·{" "}
                    {c.alive ? "alive" : "ended"} · saved {day(c.updated_at)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tnum text-sm font-extrabold">{money(c.peak_valuation)}</p>
                  <p className="tnum text-2xs text-[var(--text-tertiary)]">
                    {c.alive ? `${money(c.valuation)} now` : "peak"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openAccount(c.profile_id, c.email)}
                  className="shrink-0 rounded-full border border-[var(--hairline)] px-3 py-1.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)]"
                >
                  OWNER
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Accounts ────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em]">ACCOUNTS</h2>
          <p className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
            {shown.length < users.length
              ? `${shown.length} OF ${users.length} SHOWN`
              : users.length < total
                ? `SHOWING ${users.length} OF ${total}`
                : `${total} FOUND`}
          </p>
        </div>
        <form
          className="mt-3 grid grid-cols-[1fr_auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void loadUsers(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="email, name, or profile id"
            spellCheck={false}
            className="tnum block w-full rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-3 py-2.5 text-sm placeholder:text-[var(--n-6)] focus:border-[var(--n-11)] focus-visible:outline-none!"
          />
          <button
            type="submit"
            disabled={busy !== null}
            className="nv-gc h-11 rounded-[var(--radius-pill)] px-5 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)] disabled:opacity-35"
          >
            SEARCH
          </button>
        </form>

        {/* ── The lens ───────────────────────────────────────────────────
            Applied here rather than in the query: the search already brought
            back everything it matched, and a round trip to re-sort a list
            that is already in memory is a spinner nobody needed to see. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.08em] ${
                filter === f.id
                  ? "bg-[var(--text-primary)] text-[var(--n-1)]"
                  : "nv-gc text-[var(--text-secondary)]"
              }`}
            >
              {f.label}
              {f.id !== "all" && (
                <span className="tnum ml-1.5 opacity-60">
                  {users.filter((u) => matchesFilter(u, f.id)).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">SORT</p>
          {SORTS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setSort(o.id)}
              className={`rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.08em] ${
                sort === o.id
                  ? "bg-[var(--text-primary)] text-[var(--n-1)]"
                  : "nv-gc text-[var(--text-secondary)]"
              }`}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={busy !== null}
            className="ml-auto rounded-full border border-[var(--hairline)] px-3 py-1.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] disabled:opacity-35"
          >
            {busy === "export" ? "…" : "EXPORT CSV"}
          </button>
        </div>

        {shown.length === 0 && (
          <p className="mt-3 rounded-[var(--radius-card)] bg-[var(--n-2)] px-4 py-6 text-sm leading-relaxed text-[var(--text-secondary)]">
            {users.length === 0
              ? "No account matches that search."
              : "No account in this search matches that filter."}
          </p>
        )}

        <ul className="mt-3">
          {shown.map((u) => (
            <li key={u.id} className="border-t border-[var(--hairline)]">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-3 text-left"
                onClick={() => {
                  if (openId === u.id) {
                    setOpenId(null);
                    setDetail(null);
                  } else {
                    setOpenId(u.id);
                    setDetail(null);
                    void loadDetail(u.id);
                  }
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="tnum truncate text-sm font-extrabold">
                    {u.email ?? (u.anonymous ? "(anonymous)" : "(no email)")}
                  </p>
                  <p className="text-2xs text-[var(--text-tertiary)]">
                    {u.displayName ? `${u.displayName} · ` : ""}
                    {u.boardHandle ? `${u.boardHandle} · ` : ""}
                    joined {day(u.createdAt)} · seen {day(u.lastSeen ?? u.lastSignInAt)}
                  </p>
                  {/*
                    What the account has DONE, on the row rather than three
                    taps into a panel. The directory used to say only who
                    somebody had paid to be.
                  */}
                  <p className="tnum text-2xs text-[var(--text-secondary)]">
                    {u.runsCompleted} {u.runsCompleted === 1 ? "run" : "runs"} ·{" "}
                    {u.companies} {u.companies === 1 ? "company" : "companies"}
                    {u.companiesAlive > 0 ? ` (${u.companiesAlive} alive)` : ""}
                    {u.topCompany ? ` · ${u.topCompany} ${money(u.topValuation)}` : ""}
                    {u.boardEntries > 0 ? ` · ${u.boardEntries} on the board` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {u.role === "admin" && <Badge tone="prestige">ADMIN</Badge>}
                  {/* PAID, not `pro`: the badge follows the same union the
                      tile does, so an account Stripe is charging reads as
                      paying even while its entitlement flag lags. */}
                  {u.paid && <Badge tone="good">PAID</Badge>}
                  {u.billingMismatch === "stripe-not-granted" && (
                    <Badge tone="alert">PAYING, NO PRO</Badge>
                  )}
                  {u.billingMismatch === "granted-not-billed" && <Badge tone="alert">UNBILLED</Badge>}
                  {u.cancelAtPeriodEnd && <Badge>CANCELLING</Badge>}
                  {u.compPro && <Badge tone="good">GIFTED</Badge>}
                  {u.chapter && <Badge>SEAT</Badge>}
                  {u.ownsChapter?.status === "active" && (
                    <Badge tone={u.ownsChapter.source === "comp" ? "good" : undefined}>
                      {u.ownsChapter.source === "comp" ? "COMP CHAPTER" : "CHAPTER"}
                    </Badge>
                  )}
                  {u.industryPacks.length > 0 && <Badge>{u.industryPacks.length} PACKS</Badge>}
                </div>
              </button>

              {openId === u.id && (
                <div className="mb-4 rounded-[var(--radius-card)] bg-[var(--n-2)] p-4">
                  {!detail ? (
                    <p className="text-sm text-[var(--text-secondary)]">Reading…</p>
                  ) : (
                    <DetailPanel
                      detail={detail}
                      busy={busy}
                      self={u.id === selfId}
                      onSetRole={(role) => void setRole(u.id, role)}
                      onGiftPro={(until) => void giftPro(u.id, until)}
                      onRevokePro={() => void revokePro(u.id)}
                      onTogglePack={(code, grant) => void togglePack(u.id, code, grant)}
                      onSetIslands={(n) => void setIslands(u.id, n)}
                      onSetYearCloses={(n) => void setYearCloses(u.id, n)}
                      onGrantChapter={(licence, seats) => void grantChapter(u.id, licence, seats)}
                      onRevokeChapter={(cid) => void revokeChapter(cid)}
                      onReconcile={() => void reconcile(u.id)}
                      onDelete={() => void deleteAccount(u.id)}
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Moderation ──────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em]">BOARD QUEUE</h2>
          <p className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
            {queue.length} WAITING
          </p>
        </div>
        {queue.length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-card)] bg-[var(--n-2)] px-4 py-6 text-sm leading-relaxed text-[var(--text-secondary)]">
            Nothing waiting. New leaderboard names land here before anyone else
            sees them.
          </p>
        ) : (
          <ul className="mt-3">
            {queue.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--hairline)] py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">
                    {r.company_name} <span className="font-normal text-[var(--text-secondary)]">by {r.founder_display_name}</span>
                  </p>
                  <p className="tnum text-2xs text-[var(--text-tertiary)]">
                    {r.board} · {r.season} · {r.industry} · {r.years_survived} yrs
                    {r.reports > 0 ? ` · ${r.reports} reports` : ""} · {day(r.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void decide(r.id, true)}
                    disabled={busy !== null}
                    className="nv-gc rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] disabled:opacity-35"
                  >
                    {busy === `mod:${r.id}` ? "…" : "LIST IT"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(r.id, false)}
                    disabled={busy !== null}
                    className="rounded-full border border-[var(--hairline)] px-3 py-1.5 text-2xs font-bold tracking-[0.08em] text-[var(--alert)] disabled:opacity-35"
                  >
                    KEEP HIDDEN
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-2xs leading-relaxed text-[var(--text-tertiary)]">
        Every grant, revoke and deletion here is written to the audit log. Gifts
        never touch the paid flag, and nothing on this page can put a score,
        a survival, a revive or a board place on any account — those are earned
        or they are nothing.
      </p>
    </main>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
  display,
  tone,
}: {
  label: string;
  value: number | undefined;
  sub?: string;
  /** What to print instead of the raw number — a money figure, usually. The
   *  VALUE still decides whether the tile has an answer at all, so a stat
   *  that has not loaded shows a dash rather than a confident "$0". */
  display?: string;
  tone?: "alert";
}) {
  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--n-3)] px-4 py-3 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
      <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">{label}</p>
      <p
        className={`tnum mt-1 text-xl font-extrabold ${
          tone === "alert" && value ? "text-[var(--alert)]" : ""
        }`}
      >
        {value === undefined ? "—" : (display ?? value)}
      </p>
      {sub && <p className="text-2xs text-[var(--text-tertiary)]">{sub}</p>}
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "good" | "prestige" | "alert";
}) {
  const colour =
    tone === "good"
      ? "text-[var(--solvency)]"
      : tone === "prestige"
        ? "text-[var(--color-prestige)]"
        : tone === "alert"
          ? "text-[var(--alert)]"
          : "text-[var(--text-tertiary)]";
  return (
    <span className={`rounded-full border border-[var(--hairline)] px-2 py-0.5 text-2xs font-bold tracking-[0.08em] ${colour}`}>
      {children}
    </span>
  );
}

function DetailPanel({
  detail,
  busy,
  self,
  onSetRole,
  onGiftPro,
  onRevokePro,
  onTogglePack,
  onSetIslands,
  onSetYearCloses,
  onGrantChapter,
  onRevokeChapter,
  onReconcile,
  onDelete,
}: {
  detail: Detail;
  busy: string | null;
  self: boolean;
  onSetRole: (role: "admin" | "player") => void;
  onGiftPro: (untilISO: string | null) => void;
  onRevokePro: () => void;
  onTogglePack: (code: string, grant: boolean) => void;
  onSetIslands: (n: number) => void;
  onSetYearCloses: (n: number) => void;
  onGrantChapter: (licence: string, seats?: number) => void;
  onRevokeChapter: (chapterId: string) => void;
  onReconcile: () => void;
  onDelete: () => void;
}) {
  const [islandsText, setIslandsText] = useState(String(detail.entitlements?.extra_islands ?? 0));
  const [yearsText, setYearsText] = useState(String(detail.entitlements?.extra_year_closes ?? 0));
  const [chapterSeatsText, setChapterSeatsText] = useState("");
  const [confirmText, setConfirmText] = useState("");
  // Promotion is armed by the same typed email the deletion is, and for the
  // same reason: it is the other action on this panel that cannot be undone
  // by tapping the chip again.
  const [promoteText, setPromoteText] = useState("");

  const e = detail.entitlements;
  const compActive = !!e?.comp_pro && (!e.comp_until || new Date(e.comp_until) > new Date());
  /*
   * The same union 0016's admin_access() computes, recomputed here from what
   * this panel already holds. The two records are shown SEPARATELY on the Pro
   * line above rather than folded into one word, because when they disagree
   * the disagreement is the thing worth reading.
   */
  const stripeLive = ["active", "trialing", "past_due"].includes(
    detail.billing?.subscription_status ?? "",
  );
  const mismatch: "stripe-not-granted" | "granted-not-billed" | null = stripeLive
    ? e?.pro
      ? null
      : "stripe-not-granted"
    : e?.pro
      ? "granted-not-billed"
      : null;
  const companiesLiveValue = detail.saves.reduce(
    (sum, s) => sum + (s.alive ? s.valuation : 0),
    0,
  );
  // What the account's TIER allows before the grant, so the row can state the
  // total rather than leaving the operator to add four and a gift in their head.
  const paceBase =
    e?.pro || compActive || e?.chapter
      ? PRO_LIMITS.yearClosesPerDay
      : FREE_LIMITS.yearClosesPerDay;
  const paceGranted = e?.extra_year_closes ?? 0;
  const activeChapter = detail.ownedChapters.find((c) => c.status === "active") ?? null;
  const confirmNeeded = detail.user.email ?? "delete";
  const isAdmin = detail.user.role === "admin";

  return (
    <div className="space-y-5">
      {/* The record */}
      <div className="grid gap-x-6 gap-y-1 text-2xs leading-relaxed text-[var(--text-secondary)] sm:grid-cols-2">
        <p><b>Profile</b> · <span className="tnum">{detail.user.id}</span></p>
        <p><b>Board handle</b> · {detail.user.boardHandle ?? "none"}</p>
        <p><b>Privacy accepted</b> · {day(detail.user.acceptedPrivacyAt)}</p>
        <p>
          <b>Billing</b> ·{" "}
          {detail.billing
            ? `${detail.billing.plan ?? "—"} (${detail.billing.subscription_status ?? "—"}${detail.billing.cancel_at_period_end ? ", cancelling" : ""})`
            : "never bought"}
          {detail.billing?.current_period_end
            ? ` · until ${day(detail.billing.current_period_end)}`
            : ""}
        </p>
        <p>
          <b>Pro</b> ·{" "}
          {e?.pro ? "entitlement granted" : "entitlement off"}
          {stripeLive ? ", Stripe live" : ", Stripe not live"}
          {compActive ? ", gifted" : ""}
          {e?.chapter ? ", chapter seat" : ""}
        </p>
        {detail.legacy && (
          <p>
            <b>Legacy</b> · best year {detail.legacy.best_year}, {detail.legacy.runs_completed} runs,
            respect {detail.legacy.shark_respect}
          </p>
        )}
        {detail.seat && (
          <p><b>Seat</b> · in a chapter as {detail.seat.email}{detail.seat.claimed_at ? "" : " (unclaimed)"}</p>
        )}
      </div>

      {/* ── Billing, when the two records disagree ──────────────────────── */}
      {mismatch && (
        <div className="rounded-[var(--radius-card)] bg-[var(--alert)]/10 px-3 py-3">
          <p className="text-2xs font-bold tracking-[0.1em] text-[var(--alert)]">
            {mismatch === "stripe-not-granted"
              ? "PAYING WITHOUT PRO"
              : "PRO WITHOUT A LIVE SUBSCRIPTION"}
          </p>
          <p className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
            {mismatch === "stripe-not-granted"
              ? "Stripe is charging this card and the entitlement never landed — a webhook that did not arrive. RECONCILE reads the subscription back from Stripe and writes it down."
              : "This account holds Pro and Stripe has nothing live behind it. Usually a subscription that ended while the flag was never cleared. RECONCILE writes down whatever Stripe actually says, which may take Pro back."}
          </p>
          <button
            type="button"
            onClick={onReconcile}
            disabled={busy !== null}
            className="nv-gc mt-2 rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] disabled:opacity-35"
          >
            RECONCILE WITH STRIPE
          </button>
        </div>
      )}

      {detail.saves.length > 0 && (
        <div>
          <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
            COMPANIES · {money(companiesLiveValue)} live
          </p>
          <ul className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
            {detail.saves.map((s) => (
              <li key={s.slot} className="tnum">
                <b>{s.company_name}</b> · {s.industry} · year {s.year}, stage {s.stage} ·{" "}
                {s.alive ? "alive" : (s.ended_by ?? "ended")} ·{" "}
                {s.alive ? `worth ${money(s.valuation)}` : `peaked at ${money(s.peak_valuation)}`}
                {s.alive ? ` (peak ${money(s.peak_valuation)})` : ""} · cash {money(s.cash)}
                {s.employees ? ` · ${s.employees} staff` : ""} · saved {day(s.updated_at)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.board.length > 0 && (
        <div>
          <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">BOARD ENTRIES</p>
          <ul className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
            {detail.board.map((b) => (
              <li key={b.id} className="tnum">
                {b.board} · {b.season} · {b.company_name} · {b.years_survived} yrs ·{" "}
                {b.listed ? "listed" : "hidden"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Gift Pro */}
      <div>
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          GIFT PRO
          {compActive
            ? ` — active${e?.comp_until ? ` until ${day(e.comp_until)}` : ", no expiry"}`
            : e?.pro
              ? " — already Pro (paid)"
              : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip onClick={() => onGiftPro(inDays(30))} disabled={busy !== null}>30 DAYS</Chip>
          <Chip onClick={() => onGiftPro(inDays(365))} disabled={busy !== null}>1 YEAR</Chip>
          <Chip onClick={() => onGiftPro(null)} disabled={busy !== null}>FOREVER</Chip>
          {compActive && (
            <Chip onClick={onRevokePro} disabled={busy !== null} danger>
              REVOKE GIFT
            </Chip>
          )}
        </div>
      </div>

      {/* Packs */}
      <div>
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          INDUSTRY PACKS — tap to grant or take back
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {INDUSTRY_CODES.map((code) => {
            const has = e?.industry_packs?.includes(code) ?? false;
            return (
              <Chip
                key={code}
                onClick={() => onTogglePack(code, !has)}
                disabled={busy !== null}
                active={has}
              >
                {code}
              </Chip>
            );
          })}
        </div>
      </div>

      {/* Islands */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">EXTRA ISLANDS</p>
        <input
          value={islandsText}
          onChange={(ev) => setIslandsText(ev.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
          inputMode="numeric"
          className="tnum w-16 rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-center text-sm focus:border-[var(--n-11)] focus-visible:outline-none!"
        />
        <Chip
          onClick={() => onSetIslands(Math.min(48, Number(islandsText) || 0))}
          disabled={busy !== null}
        >
          SET
        </Chip>
        <span className="text-2xs text-[var(--text-tertiary)]">
          0&ndash;48, on top of the tier&rsquo;s islands &mdash; capped at{" "}
          {ISLAND_CAP} held at once
        </span>
      </div>

      {/* Year closes — pace, the one limit between free's four and Pro's all */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          EXTRA YEAR CLOSES A DAY
        </p>
        <input
          value={yearsText}
          onChange={(ev) => setYearsText(ev.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
          inputMode="numeric"
          aria-label="Extra fiscal-year closes a day"
          className="tnum w-16 rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-center text-sm focus:border-[var(--n-11)] focus-visible:outline-none!"
        />
        <Chip
          onClick={() => onSetYearCloses(Math.min(20, Number(yearsText) || 0))}
          disabled={busy !== null}
        >
          SET
        </Chip>
        <span className="tnum text-2xs text-[var(--text-tertiary)]">
          0–20, on top of the tier&rsquo;s {paceBase} — closes {paceBase + paceGranted} a day
        </span>
      </div>

      {/* Chapter */}
      <div>
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          CHAPTER
          {activeChapter
            ? ` — ${activeChapter.seats} seats, ${activeChapter.source === "comp" ? "comped" : "paid"}${activeChapter.current_period_end ? `, until ${day(activeChapter.current_period_end)}` : ""}`
            : " — none active"}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!activeChapter &&
            CHAPTER_LICENCES.map((l) => (
              <Chip key={l.id} onClick={() => onGrantChapter(l.id)} disabled={busy !== null}>
                GRANT {l.seats} SEATS
              </Chip>
            ))}
          {!activeChapter && (
            <>
              <input
                value={chapterSeatsText}
                // Five digits, because the ceiling is five digits. It was three
                // when the ceiling was 500, which would now make every chapter
                // above 999 seats untypeable in the one console that comps them.
                onChange={(ev) =>
                  setChapterSeatsText(
                    ev.target.value
                      .replace(/[^0-9]/g, "")
                      .slice(0, String(CHAPTER_CUSTOM_MAX_SEATS).length),
                  )
                }
                inputMode="numeric"
                placeholder={`${CHAPTER_CUSTOM_MIN_SEATS}–${CHAPTER_CUSTOM_MAX_SEATS}`}
                aria-label="Custom seat count"
                // w-20 fitted "10–500". The placeholder is now "10–10000" and
                // the value can be five digits, so the box grows with them.
                className="tnum w-28 rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-center text-sm placeholder:text-[var(--n-6)] focus:border-[var(--n-11)] focus-visible:outline-none!"
              />
              <Chip
                onClick={() => onGrantChapter("chapter_custom", Number(chapterSeatsText))}
                disabled={busy !== null || !isCustomSeatCount(Number(chapterSeatsText))}
              >
                GRANT CUSTOM
              </Chip>
            </>
          )}
          {activeChapter && activeChapter.source === "comp" && (
            <Chip onClick={() => onRevokeChapter(activeChapter.id)} disabled={busy !== null} danger>
              REVOKE CHAPTER
            </Chip>
          )}
          {activeChapter && activeChapter.source === "stripe" && (
            <span className="text-2xs text-[var(--text-tertiary)]">
              paid licence — it lapses through Stripe, not from here
            </span>
          )}
        </div>
        {!activeChapter && (
          <p className="mt-1.5 text-2xs leading-relaxed text-[var(--text-tertiary)]">
            A granted chapter puts the seat console at /chapter on THEIR account —
            they invite or register students exactly as a paying school would.
          </p>
        )}
      </div>

      {/* Role — the one grant that is not content or pace, but this console */}
      <div className="rounded-[var(--radius-row)] border border-[var(--hairline)] p-3">
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          ROLE — {isAdmin ? "ADMIN" : "PLAYER"}
        </p>
        {self ? (
          <p className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
            Your own account. An admin cannot change their own role here &mdash; a
            self-demotion would close this door from the inside, and the way
            back in is the Supabase dashboard. Ask another admin, or use the
            dashboard.
          </p>
        ) : isAdmin ? (
          <>
            <p className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
              A full operator: this console, every account on it, and their own
              game unlocked. Demoting is one cell back and total &mdash; an
              admin&rsquo;s access is derived, never stored, so there is nothing
              left behind to chase down.
            </p>
            <div className="mt-2">
              <Chip onClick={() => onSetRole("player")} disabled={busy !== null} danger>
                {busy === "role" ? "DEMOTING…" : "DEMOTE TO PLAYER"}
              </Chip>
            </div>
          </>
        ) : detail.user.anonymous || !detail.user.email ? (
          <p className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
            {detail.user.anonymous
              ? "An anonymous account cannot be made an admin: it signs in with a device and no credential."
              : "An account with no email cannot be made an admin — the audit log would have nobody to name."}
          </p>
        ) : (
          <>
            <p className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
              Makes this account a full operator: this console, every account
              and gift on it, their own game unlocked &mdash; and the power to
              promote others. Type{" "}
              <span className="tnum font-bold">{detail.user.email}</span> to arm
              the button.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={promoteText}
                onChange={(ev) => setPromoteText(ev.target.value)}
                spellCheck={false}
                placeholder={detail.user.email}
                aria-label="Type the email to arm the promotion"
                className="tnum min-w-0 flex-1 rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-3 py-2 text-sm placeholder:text-[var(--n-6)] focus:border-[var(--n-11)] focus-visible:outline-none!"
              />
              <button
                type="button"
                onClick={() => onSetRole("admin")}
                disabled={busy !== null || promoteText !== detail.user.email}
                className="rounded-full px-4 py-2 text-2xs font-bold tracking-[0.08em] nv-gc text-[var(--text-secondary)] disabled:opacity-35"
              >
                {busy === "role" ? "PROMOTING…" : "MAKE ADMIN"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Danger */}
      {!isAdmin ? (
        <div className="rounded-[var(--radius-row)] border border-[var(--alert)]/40 p-3">
          <p className="text-2xs font-bold tracking-[0.1em] text-[var(--alert)]">DELETE THIS ACCOUNT</p>
          <p className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
            Gone means gone: saves, entitlements, seats, board entries — the lot,
            by cascade. Type <span className="tnum font-bold">{confirmNeeded}</span> to arm the button.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={confirmText}
              onChange={(ev) => setConfirmText(ev.target.value)}
              spellCheck={false}
              placeholder={confirmNeeded}
              className="tnum min-w-0 flex-1 rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-3 py-2 text-sm placeholder:text-[var(--n-6)] focus:border-[var(--n-11)] focus-visible:outline-none!"
            />
            <button
              type="button"
              onClick={onDelete}
              disabled={busy !== null || confirmText !== confirmNeeded}
              className="rounded-full border border-[var(--alert)] px-4 py-2 text-2xs font-bold tracking-[0.08em] text-[var(--alert)] disabled:opacity-35"
            >
              {busy === "delete" ? "DELETING…" : "DELETE"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-2xs text-[var(--text-tertiary)]">
          An admin account — demote it above before anything drastic.
        </p>
      )}
    </div>
  );
}

function Chip({
  children,
  onClick,
  disabled,
  active,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.08em] disabled:opacity-35 ${
        danger
          ? "border border-[var(--alert)] text-[var(--alert)]"
          : active
            ? "bg-[var(--text-primary)] text-[var(--n-1)]"
            : "nv-gc text-[var(--text-secondary)]"
      }`}
    >
      {children}
    </button>
  );
}
