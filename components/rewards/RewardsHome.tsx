"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Ceremony, { type RevealPayload } from "./Ceremony";
import MySkins from "./MySkins";
import BetaPanel from "./BetaPanel";
import TokenShop from "./TokenShop";
import { identity } from "@/lib/cloud/auth";
import { entryRoute } from "@/lib/entry";
import { appPath } from "@/lib/native/href";
import { TIER_ODDS, type Band, type Tier } from "@/lib/rewards/tables";
import { play } from "@/lib/sound";
import { startPlayHeartbeat } from "@/lib/rewards/report";

/**
 * The reward screen: today, the vault, the wardrobe.
 *
 * Four tabs rather than four routes, because the whole point of the loop is
 * that these are the same visit — finish a mission, claim it, open it, wear
 * it. A route change between each would put a page load inside the one moment
 * this system exists to make feel good.
 *
 * The ceremony is mounted over the top rather than navigated to, for the same
 * reason and one more: the grant is already committed server-side when it
 * opens, so an overlay that is dismissed mid-animation loses nothing.
 *
 * ── Who sees what, now that the loop is launched ────────────────────────────
 *
 * Every /api/rewards route used to 404 for any account without a per-account
 * beta flag, and this screen answered a 404 with empty lists — "No missions
 * yet" — which was the correct face for a feature that did not officially
 * exist. It is the wrong face now that briefcases are for every signed-in
 * account, because a 404 has exactly two honest meanings and both deserve a
 * sentence rather than a blank:
 *
 *   signed out     — the rolls happen on the server and the inventory lives
 *                    there; there is nothing to show a device with no session.
 *                    The screen says so and points at Settings, where sign-in
 *                    lives inside the game.
 *   unavailable    — a real account, and the server still refused. That is a
 *                    deployment whose database never had migration 0017
 *                    applied (the owner's own first report of "beta mode not
 *                    working" was this). The words on screen name the check
 *                    an operator can paste (supabase/CHECK-SCHEMA.sql) because
 *                    a blank screen was what cost the last person a day.
 *
 * Telling the two apart is /api/auth/me's job, not the status code's: the gate
 * deliberately answers 404 to both (lib/rewards/gate.ts).
 *
 * ── The BETA tab ────────────────────────────────────────────────────────────
 *
 * The tester workbench (BetaPanel) is the one part of this screen the old flag
 * still gates. It is drawn only when /api/rewards/daily says `beta: true` for
 * this account — the tab used to be in the bar for everyone and the panel
 * behind it simply failed, which is the "secret menu is not showing" report
 * in another form: a tab you can see and cannot use is a bug, not a secret.
 */

type Tab = "today" | "vault" | "skins" | "shop" | "beta";

/** What this device is allowed to see. Decided once per visit, from the first
 *  fetch and — only if that refused — one question to /api/auth/me. */
type Access = "loading" | "ok" | "signed-out" | "unavailable";

interface DailySlotView {
  slot: number;
  band: Band;
  text: string;
  progress: number;
  target: number;
  done: boolean;
  claimed: boolean;
  odds: Record<Tier, number>;
}

interface VaultCase {
  id: string;
  source: string;
  granted_at: string;
}

export default function RewardsHome() {
  const [tab, setTab] = useState<Tab>("today");
  const [slots, setSlots] = useState<DailySlotView[]>([]);
  const [cases, setCases] = useState<VaultCase[]>([]);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [oddsFor, setOddsFor] = useState<number | null>(null);
  const [access, setAccess] = useState<Access>("loading");
  /** This account holds the tester flag: draw the BETA tab. */
  const [beta, setBeta] = useState(false);

  const load = useCallback(async () => {
    const [dailyRes, vault] = await Promise.all([
      fetch("/api/rewards/daily", { credentials: "same-origin" }).catch(() => null),
      fetch("/api/rewards/vault", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);
    const daily = dailyRes?.ok ? await dailyRes.json().catch(() => null) : null;
    if (daily?.slots) {
      setSlots(daily.slots);
      setBeta(Boolean(daily.beta));
      setAccess("ok");
    } else {
      /*
       * Refused. Signed out, or a server without the schema — the status is
       * the same for both on purpose, so ask the one route that knows. A
       * deployment with no Supabase at all (`configured: false`) is the
       * "unavailable" face too: local-only play is a supported state, and
       * this screen simply has nothing to offer it.
       */
      const who = await identity();
      setAccess(who.configured && !who.signedIn ? "signed-out" : "unavailable");
    }
    if (vault?.cases) setCases(vault.cases);
  }, []);

  useEffect(() => { void load(); }, [load]);
  /*
   * Career milestones are derived from the synced save, so they are checked on
   * every visit rather than pushed at the moment they happen. A player who
   * passed one offline, or before briefcases reached them, collects it here —
   * which is also how every existing account gets its first case the first
   * time it opens this screen after the launch.
   */
  useEffect(() => {
    void fetch("/api/rewards/milestones", { method: "POST", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.granted?.length) void load(); })
      .catch(() => {});
  }, [load]);
  // "Play for N minutes today" is measured in foreground ticks, so the clock
  // runs while this screen is open too — it is part of the session.
  useEffect(() => startPlayHeartbeat(), []);

  // A tab that is no longer drawn must not stay selected: the flag can be
  // revoked between visits and the bar would point at nothing.
  useEffect(() => {
    if (tab === "beta" && !beta) setTab("today");
  }, [tab, beta]);

  const claim = async (slot: number) => {
    setBusy(`claim-${slot}`);
    play("click");
    const res = await fetch("/api/rewards/claim", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok && data.briefcaseId) { await open(data.briefcaseId); void load(); }
    else play("error");
  };

  const open = async (briefcaseId: string) => {
    setBusy(`open-${briefcaseId}`);
    const res = await fetch("/api/rewards/open", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ briefcaseId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok && data.items) setReveal(data as RevealPayload);
    else play("error");
  };

  const equip = async (itemId: string) => {
    await fetch("/api/rewards/equip", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
  };

  const unopened = cases.length;
  const loading = access === "loading";
  const tabs = useMemo<[Tab, string][]>(() => {
    const list: [Tab, string][] = [
      ["today", "TODAY"],
      ["vault", unopened ? `VAULT · ${unopened}` : "VAULT"],
      ["skins", "MY SKINS"],
      ["shop", "SHOP"],
    ];
    if (beta) list.push(["beta", "BETA"]);
    return list;
  }, [unopened, beta]);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] px-4 pb-3 pt-5 sm:px-6">
        <div className="flex items-baseline gap-3">
          <BackToGame />
          <h1 className="text-lg font-bold tracking-tight">Briefcases</h1>
        </div>
        {access === "ok" && <ResetPill />}
      </header>

      {access === "ok" && (
        <nav className="sticky top-0 z-10 flex gap-1 border-b border-[var(--hairline)] bg-[var(--surface)]/95 px-4 py-2 backdrop-blur sm:px-6">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setTab(id); play("tab"); }}
              aria-pressed={tab === id}
              className={`rounded-[var(--radius-row)] px-3 py-1.5 text-2xs tracking-[0.08em] ${
                tab === id ? "bg-[var(--surface-elevated)] font-bold" : "text-[var(--text-tertiary)]"
              }`}
            >
              {label}
              {id === "vault" && unopened > 0 && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-action)]" aria-hidden />
              )}
            </button>
          ))}
        </nav>
      )}

      {loading && <p className="p-6 text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">LOADING…</p>}

      {access === "signed-out" && (
        <section className="flex flex-col gap-3 p-4 pb-24 sm:p-6">
          <p className="text-base font-bold tracking-tight">Briefcases need an account.</p>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Five missions a day, the same five for everyone. Finish one and a
            sealed briefcase is yours — a skin for your founder, Shark Tokens, or
            a trial of Pro. The odds are printed on every case, and nothing
            inside one touches your score.
          </p>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            The case is rolled on the server and your collection lives there, so
            it needs somewhere to live. Sign in from Settings inside your
            company, and today&rsquo;s missions are waiting.
          </p>
        </section>
      )}

      {access === "unavailable" && (
        <section className="flex flex-col gap-3 p-4 pb-24 sm:p-6">
          <p className="text-base font-bold tracking-tight">Briefcases aren&rsquo;t switched on here yet.</p>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Your account is fine — this server has not been set up for them. Nothing
            you have earned is lost; it will be counted the moment it is.
          </p>
          <p className="rounded-[var(--radius-row)] border border-[var(--hairline)] px-3 py-2 text-2xs leading-relaxed text-[var(--text-tertiary)]">
            Operator: paste <code>supabase/CHECK-SCHEMA.sql</code> into the Supabase
            SQL editor. It prints one row per migration and names the file to run —
            briefcases need <code>0017_rewards.sql</code> and <code>0018_rewards_seed.sql</code>,
            which <code>APPLY-ALL.sql</code> older than this build did not include.
          </p>
        </section>
      )}

      {access === "ok" && tab === "today" && (
        <section className="flex flex-col gap-2 p-4 pb-24 sm:p-6">
          {slots.map((slot) => (
            <article
              key={slot.slot}
              className="rounded-[var(--radius-row)] border border-[var(--hairline)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
                    {slot.band.toUpperCase()}
                    <button
                      onClick={() => setOddsFor(oddsFor === slot.slot ? null : slot.slot)}
                      className="ml-1.5 rounded-full border border-[var(--hairline)] px-1.5 text-[9px]"
                      aria-label="Show the odds for this slot"
                    >
                      i
                    </button>
                  </p>
                  <p className="mt-1 text-sm">{slot.text}</p>
                </div>
                {slot.claimed ? (
                  <span className="shrink-0 text-2xs text-[var(--text-tertiary)]">CLAIMED</span>
                ) : slot.done ? (
                  <button
                    onClick={() => void claim(slot.slot)}
                    disabled={busy !== null}
                    className="shrink-0 animate-pulse rounded-[var(--radius-row)] bg-[var(--color-action)] px-3 py-1.5 text-2xs font-bold text-white"
                  >
                    UNLOCK REWARD
                  </button>
                ) : null}
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                <div
                  className="h-full rounded-full bg-[var(--color-action)] transition-[width] duration-500"
                  style={{ width: `${Math.min(100, (slot.progress / slot.target) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-2xs tabular-nums text-[var(--text-tertiary)]">
                {Math.floor(slot.progress)} / {slot.target}
              </p>

              {/* The published odds, on the card that will roll them. */}
              {oddsFor === slot.slot && (
                <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--hairline)] pt-2 text-2xs">
                  {([1, 2, 3, 4, 5] as Tier[]).map((tier) => (
                    <div key={tier} className="flex gap-1">
                      <dt className="text-[var(--text-tertiary)]">T{tier}</dt>
                      <dd className="tabular-nums">{TIER_ODDS[slot.band][tier]}%</dd>
                    </div>
                  ))}
                  <p className="w-full pt-1 text-[var(--text-tertiary)]">
                    Never below the slot&rsquo;s base tier. Cases are earned, never sold.
                  </p>
                </dl>
              )}
            </article>
          ))}
          {!slots.length && (
            <p className="text-2xs text-[var(--text-tertiary)]">
              No missions yet — play a little and they will fill in.
            </p>
          )}
        </section>
      )}

      {access === "ok" && tab === "vault" && (
        <section className="flex flex-col gap-2 p-4 pb-24 sm:p-6">
          {cases.map((item) => (
            <button
              key={item.id}
              onClick={() => void open(item.id)}
              disabled={busy !== null}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-row)] border border-[var(--hairline)] p-3 text-left"
            >
              <span className="min-w-0">
                {/* No tier here on purpose — it is the ceremony's first
                    jackpot moment and the API does not send it. */}
                <span className="block text-sm font-bold">Sealed briefcase</span>
                <span className="block text-2xs text-[var(--text-tertiary)]">
                  {label(item.source)}
                </span>
              </span>
              <span className="shrink-0 text-2xs font-bold text-[var(--color-action)]">OPEN</span>
            </button>
          ))}
          {!cases.length && (
            <p className="text-2xs text-[var(--text-tertiary)]">
              Nothing sealed. Finish a mission and it lands here.
            </p>
          )}
        </section>
      )}

      {access === "ok" && tab === "skins" && <MySkins />}
      {access === "ok" && tab === "shop" && <TokenShop onBought={(id) => void open(id)} />}
      {access === "ok" && tab === "beta" && beta && <BetaPanel onOpenCase={(id) => void open(id)} />}

      {reveal && (
        <Ceremony
          payload={reveal}
          onEquip={equip}
          onClose={() => { setReveal(null); void load(); }}
        />
      )}
    </main>
  );
}

/**
 * The way back into the game.
 *
 * /rewards is a route of its own (see app/rewards/page.tsx for why), reached
 * from the Closet band and the introduction sheet — and it had no way out
 * except the browser's back button, which the iOS shell does not draw. Back
 * when there is history to go back to (the common case: the Closet), and
 * otherwise wherever the front door would send this device (lib/entry.ts):
 * the islands picker for a player with a company, founding for one without.
 * A document navigation rather than a router push because the destination is
 * the game's own entry logic, which reads storage synchronously; `appPath`
 * keeps it working inside an old bundled shell.
 */
function BackToGame() {
  const go = () => {
    play("tab");
    if (window.history.length > 1) window.history.back();
    else window.location.href = appPath(entryRoute());
  };
  return (
    <button
      type="button"
      onClick={go}
      className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]"
      aria-label="Back to the game"
    >
      &larr; BACK
    </button>
  );
}

/** "daily:2026-08-30:3" → "Today's mission 3". */
function label(source: string): string {
  if (source.startsWith("daily:")) return `Daily mission ${source.split(":")[2] ?? ""}`.trim();
  if (source.startsWith("milestone:")) return "Career milestone";
  if (source.startsWith("sim:")) return "Test case";
  if (source.startsWith("pitch:")) return "Pitch reward";
  return source;
}

/**
 * The countdown to 09:00 UTC.
 *
 * Rendered from the OFFSET between the server's clock and this device's, never
 * from the device clock — teen phones drift and a few are set wrong on
 * purpose, and either would show the wrong day's deadline.
 */
function ResetPill() {
  const [offset, setOffset] = useState<number | null>(null);
  const [resetAt, setResetAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    void fetch("/api/rewards/time", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!live || !data?.serverNow) return;
        setOffset(new Date(data.serverNow).getTime() - Date.now());
        setResetAt(new Date(data.nextResetAt).getTime());
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const remaining = useMemo(() => {
    if (offset === null || resetAt === null) return null;
    return Math.max(0, resetAt - (now + offset));
  }, [offset, resetAt, now]);

  if (remaining === null) return null;

  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  const urgent = remaining < 3_600_000;
  const pulsing = remaining < 300_000;

  return (
    <span
      className={`tabular-nums text-2xs font-bold tracking-[0.06em] ${pulsing ? "animate-pulse" : ""}`}
      style={{ color: urgent ? "var(--color-action)" : "var(--text-tertiary)" }}
      title="Missions and the board reset at 09:00 UTC"
    >
      RESETS IN {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}
