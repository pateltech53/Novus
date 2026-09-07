"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Ceremony, { type RevealPayload } from "./Ceremony";
import MySkins from "./MySkins";
import BetaPanel from "./BetaPanel";
import TokenShop from "./TokenShop";
import { RARITY_COLORS, TIER_ODDS, type Band, type Tier } from "@/lib/rewards/tables";
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
 */

type Tab = "today" | "vault" | "skins" | "shop" | "beta";

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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [daily, vault] = await Promise.all([
      fetch("/api/rewards/daily", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/rewards/vault", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (daily?.slots) setSlots(daily.slots);
    if (vault?.cases) setCases(vault.cases);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  /*
   * Career milestones are derived from the synced save, so they are checked on
   * every visit rather than pushed at the moment they happen. A player who
   * passed one offline, or before the beta reached them, collects it here.
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

  return (
    <main className="mx-auto min-h-dvh max-w-2xl">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] px-4 pb-3 pt-5 sm:px-6">
        <h1 className="text-lg font-bold tracking-tight">Briefcases</h1>
        <ResetPill />
      </header>

      {/* Solid, not blurred. The CSS material is retired app-wide — the gate in
          globals.css keys every backdrop-filter off `[data-css-glass]`, which
          nothing writes — but that gate is written against this app's own class
          names and cannot see a raw Tailwind `backdrop-blur`. This was the last
          live one: a per-frame full-surface blur pass, over a scrolling list,
          on the one screen that also runs a canvas. */}
      <nav className="sticky top-0 z-10 flex gap-1 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 py-2 sm:px-6">
        {([
          ["today", "TODAY"],
          ["vault", unopened ? `VAULT · ${unopened}` : "VAULT"],
          ["skins", "MY SKINS"],
          ["shop", "SHOP"],
          ["beta", "BETA"],
        ] as [Tab, string][]).map(([id, label]) => (
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
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#FF6B00]" aria-hidden />
            )}
          </button>
        ))}
      </nav>

      {loading && <p className="p-6 text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">LOADING…</p>}

      {!loading && tab === "today" && (
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
                    className="shrink-0 animate-pulse rounded-[var(--radius-row)] bg-[#FF6B00] px-3 py-1.5 text-2xs font-bold text-white"
                  >
                    UNLOCK REWARD
                  </button>
                ) : null}
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                <div
                  className="h-full rounded-full bg-[#FF6B00] transition-[width] duration-500"
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

      {!loading && tab === "vault" && (
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
              <span className="shrink-0 text-2xs font-bold text-[#FF6B00]">OPEN</span>
            </button>
          ))}
          {!cases.length && (
            <p className="text-2xs text-[var(--text-tertiary)]">
              Nothing sealed. Finish a mission and it lands here.
            </p>
          )}
        </section>
      )}

      {!loading && tab === "skins" && <MySkins />}
      {!loading && tab === "shop" && <TokenShop onBought={(id) => void open(id)} />}
      {!loading && tab === "beta" && <BetaPanel onOpenCase={(id) => void open(id)} />}

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
      style={{ color: urgent ? "#FF6B00" : "var(--text-tertiary)" }}
      title="Missions and the board reset at 09:00 UTC"
    >
      RESETS IN {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}
