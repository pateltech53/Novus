"use client";

import { useCallback, useEffect, useState } from "react";

import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
import { restorePurchases } from "@/lib/cloud/billing";
import { INDUSTRIES } from "@/lib/engine/constants";
import { CHAPTER_LICENCES } from "@/lib/monetization";
import { play } from "@/lib/sound";

/**
 * /admin — the operator's console.
 *
 * Reached by URL, linked from nowhere: the role is a cell in the database
 * (profiles.role, flipped in the Supabase dashboard — docs/ADMIN.md), and to
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
  role: string;
  anonymous: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  pro: boolean;
  compPro: boolean;
  compUntil: string | null;
  compNote: string | null;
  chapter: string | null;
  extraRunSlots: number;
  industryPacks: string[];
  subscriptionStatus: string | null;
  plan: string | null;
  ownsChapter: { id: string; status: string | null; source: string | null; licence: string | null } | null;
  seatChapterId: string | null;
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
    extra_run_slots: number;
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
  saves: Array<{
    slot: number;
    company_name: string;
    industry: string;
    year: number;
    stage: number;
    alive: boolean;
    ended_by: string | null;
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
  activeWeek?: number;
  activeMonth?: number;
  proPaid?: number;
  proComp?: number;
  chapterSeats?: number;
  chaptersActive?: number;
  chaptersComp?: number;
  savesAlive?: number;
  boardListed?: number;
  boardQueue?: number;
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

// ── Plumbing ────────────────────────────────────────────────────────────────

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

const INDUSTRY_CODES = INDUSTRIES.map((i) => i.code);

// ── The page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<View>("all");
  const [email, setEmail] = useState<string | null>(null);

  const [stats, setStats] = useState<Stats>({});
  const [auditTail, setAuditTail] = useState<AuditRow[]>([]);

  const [q, setQ] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // ── Loads ─────────────────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    const body = await call<{ stats: Stats; audit: AuditRow[] }>("/api/admin/stats");
    if (body) {
      setStats(body.stats);
      setAuditTail(body.audit);
    }
  }, []);

  const loadUsers = useCallback(async (needle: string) => {
    const body = await call<{ users: UserRow[]; total: number }>(
      `/api/admin/users?q=${encodeURIComponent(needle)}&limit=50`,
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
        const me = await call<{ ok: boolean; view: View; email: string | null }>("/api/admin/me");
        if (!alive) return;
        if (!me?.ok) {
          setPhase("denied");
          return;
        }
        setView(me.view);
        setEmail(me.email);
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

  const setSlots = (id: string, slots: number) =>
    act(
      "slots",
      () =>
        call("/api/admin/slots", {
          method: "POST",
          body: JSON.stringify({ profileId: id, slots }),
        }),
      [refreshOpen],
    );

  const grantChapter = (id: string, licence: string) =>
    act(
      `chapter:${licence}`,
      () =>
        call("/api/admin/chapters", {
          method: "POST",
          body: JSON.stringify({ ownerProfileId: id, licence }),
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

  // ── Screens ───────────────────────────────────────────────────────────────

  if (phase !== "ready") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center px-6 pb-16 pt-[max(4rem,env(safe-area-inset-top))]">
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
              href="/"
              className="nv-gc mt-6 flex h-14 w-full items-center justify-center rounded-[var(--radius-pill)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
            >
              BACK TO NOVUS
            </a>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pb-24 pt-[max(2.5rem,env(safe-area-inset-top))]">
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
        <a
          href="/"
          className="nv-gc rounded-full px-4 py-2 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]"
        >
          BACK TO NOVUS
        </a>
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
                    ? "bg-[var(--n-12)] text-[var(--n-1)]"
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
          <Stat label="ACTIVE · 7 DAYS" value={stats.activeWeek} />
          <Stat label="ACTIVE · 30 DAYS" value={stats.activeMonth} />
          <Stat label="PRO · PAID" value={stats.proPaid} />
          <Stat label="PRO · GIFTED" value={stats.proComp} />
          <Stat label="CHAPTERS" value={stats.chaptersActive} sub={stats.chaptersComp ? `${stats.chaptersComp} comped` : undefined} />
          <Stat label="SEATS FILLED" value={stats.chapterSeats} />
          <Stat label="LIVE COMPANIES" value={stats.savesAlive} />
          <Stat label="BOARD · LISTED" value={stats.boardListed} />
          <Stat label="BOARD · QUEUE" value={stats.boardQueue} />
          <Stat label="ADMINS" value={stats.admins} />
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

      {/* ── Accounts ────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em]">ACCOUNTS</h2>
          <p className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
            {users.length < total ? `SHOWING ${users.length} OF ${total}` : `${total} FOUND`}
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

        <ul className="mt-3">
          {users.map((u) => (
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
                    joined {day(u.createdAt)} · seen {day(u.lastSignInAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {u.role === "admin" && <Badge tone="prestige">ADMIN</Badge>}
                  {u.pro && <Badge tone="good">PRO</Badge>}
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
                      onGiftPro={(until) => void giftPro(u.id, until)}
                      onRevokePro={() => void revokePro(u.id)}
                      onTogglePack={(code, grant) => void togglePack(u.id, code, grant)}
                      onSetSlots={(n) => void setSlots(u.id, n)}
                      onGrantChapter={(licence) => void grantChapter(u.id, licence)}
                      onRevokeChapter={(cid) => void revokeChapter(cid)}
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

function Stat({ label, value, sub }: { label: string; value: number | undefined; sub?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--n-3)] px-4 py-3 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
      <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">{label}</p>
      <p className="tnum mt-1 text-xl font-extrabold">{value ?? "—"}</p>
      {sub && <p className="text-2xs text-[var(--text-tertiary)]">{sub}</p>}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "good" | "prestige" }) {
  const colour =
    tone === "good"
      ? "text-[var(--solvency)]"
      : tone === "prestige"
        ? "text-[var(--color-prestige)]"
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
  onGiftPro,
  onRevokePro,
  onTogglePack,
  onSetSlots,
  onGrantChapter,
  onRevokeChapter,
  onDelete,
}: {
  detail: Detail;
  busy: string | null;
  onGiftPro: (untilISO: string | null) => void;
  onRevokePro: () => void;
  onTogglePack: (code: string, grant: boolean) => void;
  onSetSlots: (n: number) => void;
  onGrantChapter: (licence: string) => void;
  onRevokeChapter: (chapterId: string) => void;
  onDelete: () => void;
}) {
  const [slotsText, setSlotsText] = useState(String(detail.entitlements?.extra_run_slots ?? 0));
  const [confirmText, setConfirmText] = useState("");

  const e = detail.entitlements;
  const compActive = !!e?.comp_pro && (!e.comp_until || new Date(e.comp_until) > new Date());
  const activeChapter = detail.ownedChapters.find((c) => c.status === "active") ?? null;
  const confirmNeeded = detail.user.email ?? "delete";

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

      {detail.saves.length > 0 && (
        <div>
          <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">COMPANIES</p>
          <ul className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
            {detail.saves.map((s) => (
              <li key={s.slot} className="tnum">
                {s.company_name} · {s.industry} · year {s.year}, stage {s.stage} ·{" "}
                {s.alive ? "alive" : (s.ended_by ?? "ended")} · saved {day(s.updated_at)}
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

      {/* Slots */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">EXTRA RUN SLOTS</p>
        <input
          value={slotsText}
          onChange={(ev) => setSlotsText(ev.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
          inputMode="numeric"
          className="tnum w-16 rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-center text-sm focus:border-[var(--n-11)] focus-visible:outline-none!"
        />
        <Chip
          onClick={() => onSetSlots(Math.min(20, Number(slotsText) || 0))}
          disabled={busy !== null}
        >
          SET
        </Chip>
        <span className="text-2xs text-[var(--text-tertiary)]">0–20, on top of the tier&rsquo;s runs</span>
      </div>

      {/* Chapter */}
      <div>
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          CHAPTER
          {activeChapter
            ? ` — ${activeChapter.seats} seats, ${activeChapter.source === "comp" ? "comped" : "paid"}${activeChapter.current_period_end ? `, until ${day(activeChapter.current_period_end)}` : ""}`
            : " — none active"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {!activeChapter &&
            CHAPTER_LICENCES.map((l) => (
              <Chip key={l.id} onClick={() => onGrantChapter(l.id)} disabled={busy !== null}>
                GRANT {l.seats} SEATS
              </Chip>
            ))}
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

      {/* Danger */}
      {detail.user.role !== "admin" ? (
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
          An admin account — demote it in the Supabase dashboard before anything
          drastic.
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
            ? "bg-[var(--n-12)] text-[var(--n-1)]"
            : "nv-gc text-[var(--text-secondary)]"
      }`}
    >
      {children}
    </button>
  );
}
