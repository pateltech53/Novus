"use client";

import { useEffect, useMemo, useState } from "react";

import { RARITY_COLORS, TIER_NAMES, TIER_RARITY, type Tier } from "@/lib/rewards/tables";
import { play } from "@/lib/sound";

/**
 * BETA — the tester's workbench.
 *
 * Everything here skips the earning so the thing being tested can be reached
 * in seconds. A Gold case is a 2.5% roll on the hardest daily; verifying the
 * Legendary reveal by playing honestly would take a fortnight and luck.
 *
 * Every action operates on the CALLER'S OWN account (see the route) — this
 * panel cannot touch anybody else's wardrobe, which is what makes it safe to
 * put in front of a tester who is not an operator.
 *
 * It only exists for accounts an operator has switched into the beta; the
 * route 404s for everyone else, so there is nothing to hide here beyond not
 * rendering it.
 */

interface Skin { id: string; name: string; tier: number; collection: string }
interface DailySlot { slot: number; text: string; band: string; done: boolean; claimed: boolean }

export default function BetaPanel({ onOpenCase }: { onOpenCase?: (id: string) => void }) {
  const [slots, setSlots] = useState<DailySlot[]>([]);
  const [skins, setSkins] = useState<Skin[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    const [daily, inv] = await Promise.all([
      fetch("/api/rewards/daily", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/rewards/inventory", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (daily?.slots) setSlots(daily.slots);
    if (inv?.catalog) setSkins(inv.catalog);
  };
  useEffect(() => { void load(); }, []);

  const sim = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setNote(null);
    const res = await fetch("/api/rewards/sim", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      play("success");
      setNote(data.briefcaseId ? "Case added to the Vault." : "Done.");
      if (data.briefcaseId && onOpenCase) onOpenCase(data.briefcaseId);
      void load();
    } else {
      play("error");
      setNote(data.error ?? "That did not work.");
    }
  };

  // The catalog is 101 rows; a search box is the difference between "unlock
  // any skin" being usable and being a scroll.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skins.slice(0, 8);
    return skins
      .filter((s) => s.name.toLowerCase().includes(q) || s.id.includes(q))
      .slice(0, 20);
  }, [skins, query]);

  return (
    <div className="flex flex-col gap-5 p-4 pb-24 sm:p-6">
      <header>
        <h2 className="text-base font-bold tracking-tight">Beta tools</h2>
        <p className="mt-0.5 text-2xs leading-relaxed text-[var(--text-tertiary)]">
          Shortcuts for testing the reward loop. Everything here affects only your
          own account, and none of it is reachable once the beta flag is off.
        </p>
      </header>

      {note && (
        <p className="rounded-[var(--radius-row)] border border-[var(--hairline)] px-3 py-2 text-2xs">
          {note}
        </p>
      )}

      {/* Cases — the fastest route to the ceremony at a chosen tier. */}
      <section>
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          GRANT A CASE — opens the ceremony at that tier
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {([1, 2, 3, 4, 5] as Tier[]).map((tier) => (
            <button
              key={tier}
              disabled={busy !== null}
              onClick={() => sim({ action: "grant-case", tier }, `case-${tier}`)}
              className="rounded-[var(--radius-row)] border px-3 py-1.5 text-2xs font-bold"
              style={{ borderColor: RARITY_COLORS[TIER_RARITY[tier]], color: RARITY_COLORS[TIER_RARITY[tier]] }}
            >
              {TIER_NAMES[tier].toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      {/* Dailies — completes the slot, then the REAL claim path runs. */}
      <section>
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          TODAY&rsquo;S MISSIONS — mark one done, then claim it for real
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {slots.map((slot) => (
            <div
              key={slot.slot}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-row)] border border-[var(--hairline)] px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-2xs">
                <b className="tracking-[0.06em]">{slot.band.toUpperCase()}</b> · {slot.text}
              </span>
              {slot.claimed ? (
                <span className="shrink-0 text-2xs text-[var(--text-tertiary)]">claimed</span>
              ) : (
                <button
                  disabled={busy !== null}
                  onClick={() => sim({ action: "complete-daily", slot: slot.slot }, `daily-${slot.slot}`)}
                  className="shrink-0 rounded-[var(--radius-row)] border border-[var(--hairline)] px-2 py-1 text-2xs font-bold"
                >
                  {slot.done ? "DONE ✓" : "COMPLETE"}
                </button>
              )}
            </div>
          ))}
          <button
            disabled={busy !== null}
            onClick={() => sim({ action: "reset-day" }, "reset")}
            className="mt-1 self-start rounded-[var(--radius-row)] border border-[var(--hairline)] px-2 py-1 text-2xs text-[var(--text-tertiary)]"
          >
            RESET TODAY
          </button>
        </div>
      </section>

      {/* Skins — searchable, because the catalog is 101 long. */}
      <section>
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          UNLOCK A SKIN
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 101 skins…"
          spellCheck={false}
          className="mt-2 w-full rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-3 py-2 text-sm placeholder:text-[var(--n-6)] focus:border-[var(--n-11)] focus-visible:outline-none!"
        />
        <div className="mt-2 flex flex-col gap-1">
          {matches.map((skin) => (
            <button
              key={skin.id}
              disabled={busy !== null}
              onClick={() => sim({ action: "unlock-skin", skinId: skin.id }, `skin-${skin.id}`)}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-row)] border border-[var(--hairline)] px-3 py-2 text-left text-2xs"
            >
              <span className="truncate">
                <span className="tnum text-[var(--text-tertiary)]">{skin.id}</span> {skin.name}
              </span>
              <span
                className="shrink-0 font-bold"
                style={{ color: RARITY_COLORS[TIER_RARITY[skin.tier as Tier]] }}
              >
                T{skin.tier}
              </span>
            </button>
          ))}
          {query && matches.length === 0 && (
            <p className="text-2xs text-[var(--text-tertiary)]">Nothing matches “{query}”.</p>
          )}
        </div>
      </section>

      {/* Tokens — so the shop is reachable without opening forty cases. */}
      <section>
        <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">SHARK TOKENS</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[100, 1000, 6000].map((amount) => (
            <button
              key={amount}
              disabled={busy !== null}
              onClick={() => sim({ action: "add-tokens", amount }, `tokens-${amount}`)}
              className="rounded-[var(--radius-row)] border border-[var(--hairline)] px-3 py-1.5 text-2xs font-bold"
            >
              +{amount.toLocaleString()}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
