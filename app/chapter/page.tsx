"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
import { useNativeOverlay, useNativeOverlayOwned } from "@/components/native/useNativeOverlay";
import { useResolvedTheme } from "@/lib/native/theme";
import { openBillingPortal } from "@/lib/cloud/billing";
import { CHAPTER_LICENCES, formatPrice, perSeatCents } from "@/lib/monetization";
import { play } from "@/lib/sound";

/**
 * /chapter — the seat console. Where a licence becomes a classroom.
 *
 * One page, owner-only, reached from the pricing section and from the
 * checkout success redirect. Everything here talks to app/api/chapter/*;
 * nothing here holds a privilege beyond the owner's own session cookie.
 *
 * ── The two ways to fill a seat, side by side ──────────────────────────────
 *
 * INVITE takes addresses (one per line, optionally `email, name`) and sends
 * each new account the app's existing set-password email. REGISTER takes
 * `email, password` rows — typed or pasted from a spreadsheet — and creates
 * the accounts on the spot, for classes where the teacher hands out printed
 * logins and no student mailbox exists. Both report per row, in order, so a
 * 40-row paste with one typo lands 39 seats and names the one that failed.
 *
 * ── The race this page knows about ─────────────────────────────────────────
 *
 * Arriving with `?purchase=ok` means Stripe redirected here while its webhook
 * — the only thing that creates the chapter — may still be in flight. So "no
 * chapter yet" right after a purchase is polled, not believed, on the same
 * backoff thinking as lib/cloud/billing.ts's awaitPurchase.
 */

interface ChapterInfo {
  id: string;
  licence: "chapter_35" | "chapter_100";
  seats: number;
  status: "active" | "lapsed";
  currentPeriodEnd: string | null;
  seatsUsed: number;
}

interface Member {
  email: string;
  name: string | null;
  origin: "registered" | "invited";
  inviteSentAt: string | null;
  claimedAt: string | null;
  createdAt: string;
}

interface RowResult {
  email: string;
  ok: boolean;
  action?: "invited" | "granted" | "resent";
  error?: string;
  warning?: string;
}

type Phase =
  | "loading"
  | "unconfigured"
  | "signed-out"
  | "no-chapter"
  | "waiting" // just paid; webhook not landed yet
  | "ready";

const POLL_MS = [800, 1200, 2000, 3000, 4000, 6000] as const;

/** `email, name` / `email<TAB>password<TAB>name` / plain address — one per
 *  line. Tabs win over commas so a paste straight out of a spreadsheet works
 *  even when a name cell contains a comma. */
function parseLines(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.includes("\t") ? line.split("\t") : line.split(",");
      return parts.map((p) => p.trim().replace(/^"(.*)"$/, "$1"));
    });
}

const RESULT_LINE: Record<NonNullable<RowResult["action"]>, string> = {
  invited: "invited — the claim email is on its way",
  granted: "already had an account — seat granted, no email needed",
  resent: "email sent again",
};

export default function ChapterPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [chapter, setChapter] = useState<ChapterInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteText, setInviteText] = useState("");
  const [inviteResults, setInviteResults] = useState<RowResult[] | null>(null);
  const [registerText, setRegisterText] = useState("");
  const [registerResults, setRegisterResults] = useState<RowResult[] | null>(null);
  const [rowNote, setRowNote] = useState<{ email: string; note: string } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<"ready" | "no-chapter" | Phase> => {
    try {
      const res = await fetch(apiUrl("/api/chapter"), { credentials: API_CREDENTIALS });
      const body = (await res.json()) as {
        configured?: boolean;
        signedIn?: boolean;
        chapter?: ChapterInfo | null;
        members?: Member[];
      };
      if (body.configured === false) return "unconfigured";
      if (body.signedIn === false) return "signed-out";
      if (!body.chapter) return "no-chapter";
      setChapter(body.chapter);
      setMembers(body.members ?? []);
      return "ready";
    } catch {
      return "unconfigured";
    }
  }, []);

  // First load. `?purchase=ok` turns "no chapter" into a poll against the
  // webhook race; anything else shows what it finds.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const fresh = new URLSearchParams(window.location.search).get("purchase") === "ok";
      const first = await load();
      if (!alive) return;
      if (first !== "no-chapter" || !fresh) {
        setPhase(first);
        return;
      }
      setPhase("waiting");
      for (const wait of POLL_MS) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        if (!alive) return;
        const again = await load();
        if (again === "ready") {
          if (alive) setPhase("ready");
          return;
        }
      }
      if (alive) setPhase("no-chapter");
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const next = await load();
    setPhase(next);
  }, [load]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const sendInvites = async () => {
    if (busy) return;
    const rows = parseLines(inviteText).map(([email, name]) => ({ email, name }));
    if (rows.length === 0) return;
    setBusy("invite");
    setInviteResults(null);
    try {
      const res = await fetch(apiUrl("/api/chapter/invites"), {
        method: "POST",
        credentials: API_CREDENTIALS,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invites: rows }),
      });
      const body = (await res.json()) as { results?: RowResult[]; error?: string };
      if (!res.ok || !body.results) {
        setInviteResults([{ email: "—", ok: false, error: body.error ?? `HTTP ${res.status}` }]);
      } else {
        setInviteResults(body.results);
        if (body.results.some((r) => r.ok)) {
          play("success");
          setInviteText("");
        }
        await refresh();
      }
    } catch {
      setInviteResults([{ email: "—", ok: false, error: "Could not reach the server." }]);
    }
    setBusy(null);
  };

  const registerRows = async () => {
    if (busy) return;
    const rows = parseLines(registerText).map(([email, password, name]) => ({ email, password, name }));
    if (rows.length === 0) return;
    setBusy("register");
    setRegisterResults(null);
    try {
      const res = await fetch(apiUrl("/api/chapter/members"), {
        method: "POST",
        credentials: API_CREDENTIALS,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const body = (await res.json()) as { results?: RowResult[]; error?: string };
      if (!res.ok || !body.results) {
        setRegisterResults([{ email: "—", ok: false, error: body.error ?? `HTTP ${res.status}` }]);
      } else {
        setRegisterResults(body.results);
        if (body.results.some((r) => r.ok)) {
          play("success");
          setRegisterText("");
        }
        await refresh();
      }
    } catch {
      setRegisterResults([{ email: "—", ok: false, error: "Could not reach the server." }]);
    }
    setBusy(null);
  };

  const resend = async (email: string) => {
    if (busy) return;
    setBusy(`resend:${email}`);
    setRowNote(null);
    try {
      const res = await fetch(apiUrl("/api/chapter/invites"), {
        method: "POST",
        credentials: API_CREDENTIALS,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invites: [{ email }] }),
      });
      const body = (await res.json()) as { results?: RowResult[]; error?: string };
      const row = body.results?.[0];
      setRowNote({
        email,
        note: row?.ok
          ? "Set-password email sent."
          : (row?.error ?? body.error ?? "Could not send it. Try again in a minute."),
      });
      await refresh();
    } catch {
      setRowNote({ email, note: "Could not reach the server." });
    }
    setBusy(null);
  };

  const remove = async (email: string) => {
    if (busy) return;
    setBusy(`remove:${email}`);
    setRowNote(null);
    try {
      const res = await fetch(apiUrl("/api/chapter/members"), {
        method: "DELETE",
        credentials: API_CREDENTIALS,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setRowNote({ email, note: body.error ?? "Could not remove the seat." });
      }
      await refresh();
    } catch {
      setRowNote({ email, note: "Could not reach the server." });
    }
    setBusy(null);
  };

  const importFile = (file: File | undefined) => {
    if (!file) return;
    void file.text().then((text) => {
      setRegisterText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text.trim()}` : text.trim()));
    });
  };

  /*
   * The console's chrome, drawn by UIKit — the Settings pattern: a full page
   * with its own ground, a floating glass toolbar the whole page scrolls
   * under. The title rides the plate, the way back is a glass circle on the
   * left, and the two page-level verbs — billing, refresh — are circles on
   * the right once there is a chapter to act on. The forms and the roster
   * stay DOM on every platform: they are content, and half of them carry
   * addresses the way The Books carry figures.
   */
  const native = useNativeOverlayOwned();
  const resolvedTheme = useResolvedTheme();
  useNativeOverlay(
    useMemo(
      () => ({
        mode: "shown" as const,
        theme: resolvedTheme,
        title: "Chapter",
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
                  label: "Refresh the roster",
                  style: "plain" as const,
                  enabled: busy === null,
                },
                {
                  id: "billing",
                  symbol: "creditcard",
                  label: "Manage billing",
                  style: "plain" as const,
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
          else window.location.assign("/");
        } else if (id === "billing") void openBillingPortal();
        else if (id === "refresh") void refresh();
      },
    },
  );

  // ── Screens ───────────────────────────────────────────────────────────────

  if (phase !== "ready") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center px-6 pb-16 pt-[max(4rem,env(safe-area-inset-top),calc(var(--nv-overlay-top)+1rem))]">
        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">
          NOVUS CHAPTER
        </p>
        {phase === "loading" && <Blurb title="One moment.">Reading your chapter…</Blurb>}
        {phase === "waiting" && (
          <Blurb title="Setting up your chapter.">
            The payment went through and the seats are being switched on — this
            page refreshes itself. If it has not appeared in a minute, reload;
            the purchase is safe either way.
          </Blurb>
        )}
        {phase === "unconfigured" && (
          <Blurb title="No chapters on this build.">
            This deploy has no account system behind it, so there are no seats
            to manage here.
          </Blurb>
        )}
        {phase === "signed-out" && (
          <>
            <Blurb title="Sign in first.">
              The chapter console belongs to the account that bought the
              licence. Sign in on the front page, then come back here.
            </Blurb>
            <a
              href="/"
              className="nv-gc mt-6 flex h-14 w-full items-center justify-center rounded-[var(--radius-pill)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
            >
              GO TO SIGN IN
            </a>
          </>
        )}
        {phase === "no-chapter" && (
          <>
            <Blurb title="No chapter on this account.">
              A chapter is 35 or 100 seats for a classroom or club —{" "}
              {formatPrice(CHAPTER_LICENCES[0].priceCents)} or{" "}
              {formatPrice(CHAPTER_LICENCES[1].priceCents)} a year, about{" "}
              {formatPrice(perSeatCents(CHAPTER_LICENCES[1]))}–
              {formatPrice(perSeatCents(CHAPTER_LICENCES[0]))} a seat. Buy one
              from the pricing section and this page becomes its console.
            </Blurb>
            <a
              href="/#pro"
              className="nv-gc mt-6 flex h-14 w-full items-center justify-center rounded-[var(--radius-pill)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
            >
              SEE THE LICENCES
            </a>
          </>
        )}
      </main>
    );
  }

  const seatsLeft = chapter ? chapter.seats - chapter.seatsUsed : 0;
  const renews = chapter?.currentPeriodEnd
    ? new Date(chapter.currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-[max(6rem,calc(var(--nv-overlay-bottom)+2rem))] pt-[max(2.5rem,env(safe-area-inset-top),calc(var(--nv-overlay-top)+0.75rem))]">
      {/* ── Masthead ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">
            NOVUS CHAPTER
          </p>
          <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
            {chapter?.seats}-seat licence
          </h1>
          <p className="tnum mt-1 text-sm text-[var(--text-secondary)]">
            {chapter?.seatsUsed} of {chapter?.seats} seats filled
            {renews && chapter?.status === "active" ? ` · renews ${renews}` : ""}
            {chapter?.status === "lapsed" ? " · licence lapsed" : ""}
          </p>
        </div>
        {/* On iOS these two are glass circles in the toolbar (and the way
            back is the leading chevron) — the DOM chips are not rendered at
            all rather than hidden, so no invisible control can take a tap. */}
        {native ? null : (
          <div className="flex gap-2">
            <a
              href="/"
              className="nv-gc rounded-full px-4 py-2 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]"
            >
              BACK TO NOVUS
            </a>
            <button
              type="button"
              onClick={() => void openBillingPortal()}
              className="nv-gc rounded-full px-4 py-2 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]"
            >
              MANAGE BILLING
            </button>
          </div>
        )}
      </div>

      {chapter?.status === "lapsed" && (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-card)] bg-[var(--alert)]/10 px-4 py-3 text-sm leading-relaxed text-[var(--text-primary)]"
        >
          The licence behind this chapter has lapsed, so every seat is off until
          it renews. The roster is kept — renewing lights the same seats back
          up. MANAGE BILLING opens the subscription.
        </p>
      )}

      {/* ── The two ways in ─────────────────────────────────────────────── */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        {/* Invite by email */}
        <section className="rounded-[var(--radius-card)] bg-[var(--n-3)] p-5 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
          <h2 className="text-sm font-extrabold tracking-[0.08em]">INVITE BY EMAIL</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
            One address per line — add a name with a comma. Each new address
            gets an invite email with a claim link: they confirm their email
            and name, choose a password, and they are in. An address that
            already plays Novus just gets the seat, no email. Pasting an
            address again resends its email.
          </p>
          <textarea
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={"sam@school.org\nriley@school.org, Riley Ng"}
            className="tnum mt-3 block w-full rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-3 py-2.5 text-sm leading-relaxed placeholder:text-[var(--n-6)] focus:border-[var(--n-11)] focus-visible:outline-none!"
          />
          <button
            type="button"
            onClick={() => void sendInvites()}
            disabled={busy !== null || parseLines(inviteText).length === 0}
            className="nv-gc mt-3 h-12 w-full rounded-[var(--radius-pill)] nv-t-action text-sm font-extrabold tracking-[0.04em] shadow-[var(--e2)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy === "invite" ? "SENDING…" : "SEND INVITES"}
          </button>
          <Results rows={inviteResults} />
        </section>

        {/* Register directly */}
        <section className="rounded-[var(--radius-card)] bg-[var(--n-3)] p-5 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
          <h2 className="text-sm font-extrabold tracking-[0.08em]">REGISTER WITH PASSWORDS</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
            <span className="tnum">email, password, name</span> — one per line,
            typed or imported from a CSV. The accounts work immediately with the
            passwords you set; no email is sent. For addresses that already
            have an account, use INVITE instead — registering never touches an
            existing password.
          </p>
          <textarea
            value={registerText}
            onChange={(e) => setRegisterText(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={"sam@school.org, seahorse-battery-41\nriley@school.org, plum-ladder-90, Riley Ng"}
            className="tnum mt-3 block w-full rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-3 py-2.5 text-sm leading-relaxed placeholder:text-[var(--n-6)] focus:border-[var(--n-11)] focus-visible:outline-none!"
          />
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={() => void registerRows()}
              disabled={busy !== null || parseLines(registerText).length === 0}
              className="nv-gc h-12 rounded-[var(--radius-pill)] nv-t-action text-sm font-extrabold tracking-[0.04em] shadow-[var(--e2)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {busy === "register" ? "CREATING…" : "REGISTER SEATS"}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="nv-gc h-12 rounded-[var(--radius-pill)] px-4 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]"
            >
              IMPORT CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <Results rows={registerResults} />
        </section>
      </div>

      {/* ── The roster ──────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-extrabold tracking-[0.08em]">THE ROSTER</h2>
          <p className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
            {seatsLeft} {seatsLeft === 1 ? "SEAT" : "SEATS"} LEFT
          </p>
        </div>

        {members.length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-card)] bg-[var(--n-2)] px-4 py-6 text-sm leading-relaxed text-[var(--text-secondary)]">
            No seats handed out yet. Invite by email, or register the whole
            class from a list — the roster fills in here.
          </p>
        ) : (
          <ul className="mt-3">
            {members.map((m) => (
              <li
                key={m.email}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--hairline)] py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="tnum truncate text-sm font-extrabold">{m.email}</p>
                  <p className="text-2xs text-[var(--text-tertiary)]">
                    {m.name ? `${m.name} · ` : ""}
                    {m.origin === "invited"
                      ? m.claimedAt
                        ? "invited · claimed"
                        : "invited · not claimed yet"
                      : "registered"}
                    {m.inviteSentAt
                      ? ` · email sent ${new Date(m.inviteSentAt).toLocaleDateString()}`
                      : ""}
                  </p>
                  {rowNote?.email === m.email && (
                    <p role="status" className="mt-0.5 text-2xs text-[var(--text-secondary)]">
                      {rowNote.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void resend(m.email)}
                    disabled={busy !== null}
                    className="nv-gc rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] disabled:opacity-35"
                  >
                    {busy === `resend:${m.email}` ? "SENDING…" : "RESEND LINK"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(m.email)}
                    disabled={busy !== null}
                    className="rounded-full border border-[var(--hairline)] px-3 py-1.5 text-2xs font-bold tracking-[0.08em] text-[var(--alert)] disabled:opacity-35"
                  >
                    {busy === `remove:${m.email}` ? "REMOVING…" : "REMOVE"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-2xs leading-relaxed text-[var(--text-tertiary)]">
          A seat is Pro for the licence year — industries, The Room, three runs
          a day. It never buys a score, a survival, a revive, or a place on
          Still Standing. Removing a seat keeps the player&rsquo;s account and
          their saves; only the seat comes back.
        </p>
      </section>
    </main>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function Blurb({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{children}</p>
    </>
  );
}

/** Per-row outcomes, in the order the rows went in. */
function Results({ rows }: { rows: RowResult[] | null }) {
  if (!rows || rows.length === 0) return null;
  const granted = rows.filter((r) => r.ok).length;
  return (
    <div className="mt-3 rounded-[var(--radius-row)] bg-[var(--n-2)] px-3 py-2.5">
      <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        {granted} OF {rows.length} LANDED
      </p>
      <ul className="mt-1 space-y-1">
        {rows.map((r, i) => (
          <li key={`${r.email}-${i}`} className="text-2xs leading-relaxed">
            <span className="tnum font-bold">{r.email}</span>{" "}
            <span
              className={r.ok ? "text-[var(--text-secondary)]" : "text-[var(--alert)]"}
              role={r.ok ? undefined : "alert"}
            >
              {r.ok
                ? (r.warning ?? (r.action ? RESULT_LINE[r.action] : "done"))
                : r.error}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
