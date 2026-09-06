"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { identity } from "@/lib/cloud/auth";
import { resolveEquippedSkin, subscribeWardrobe } from "@/lib/engine/wardrobe";
import { RARITY_COLORS, TIER_RARITY } from "@/lib/rewards/tables";
import {
  loadWornRewardSkin,
  rewardSkinSrc,
  subscribeWorn,
  takeOffRewardSkin,
  type WornRewardSkin,
} from "@/lib/rewards/wear";
import { play } from "@/lib/sound";

/**
 * The briefcase loop, seen from inside the Closet.
 *
 * ── Why it lives here and not only on /rewards ──────────────────────────────
 *
 * A collection screen a player has to remember to visit is a screen they
 * visit twice. The Closet is where they already go to look at themselves, so
 * the sealed cases announce themselves on the way past, and whatever reward
 * skin is on the founder's back is named here — with the way to take it off —
 * next to the wardrobe track that competes with it for the same body.
 *
 * ── Why the grid left ───────────────────────────────────────────────────────
 *
 * The first version embedded the whole MY SKINS collection under the band:
 * every one of the 101 catalog cells, on a hard-coded near-black ground, with
 * the locked silhouettes at 13% opacity and a dozen renders not yet on disk.
 * The owner's report was exact — "like 100 black squares" — and the Closet is
 * the wrong room for a hundred-cell collection anyway: it is the longest
 * scroll in the app already, and the collection has its own tab on /rewards
 * where it can be grouped, filtered and previewed on either founder. So the
 * band links there, and the grid is gone from here. What stays is one line
 * about the skin actually being worn.
 *
 * ── What renders for whom ───────────────────────────────────────────────────
 *
 * /api/rewards/vault answers 200 for any signed-in account, 404 for a
 * signed-out visitor, and 404 or worse on a server whose database predates
 * the rewards schema. Three outcomes:
 *
 *   · 200 — the BRIEFCASES band: "N sealed cases waiting → OPEN", or
 *     "Today's missions → VIEW". Both go to /rewards.
 *   · not OK, and `identity()` says the server is configured but nobody is
 *     signed in — a quiet band saying briefcases need an account, pointing
 *     at Settings, which is where sign-in lives inside the game. Plain text,
 *     not a link: there is no route to send them to that Settings does not
 *     already own.
 *   · not OK otherwise — nothing at all. No Supabase configured means the
 *     loop does not exist on this deploy; signed in and refused means the
 *     schema is missing, and neither is the player's problem to read about.
 *
 * The WEARING row below the band is independent of all three: it reads the
 * device-local record (lib/rewards/wear.ts) and shows whenever a reward skin
 * is on, whichever way the band went — with one exception. On the founder a
 * Closet fit outranks a reward skin (FounderAvatar's rule), and the record
 * can hold a skin while a fit is worn: equip the skin on another device and
 * the next inventory sync writes it here, under a fit this device never took
 * off. The row follows the portrait, not the record: while a fit is over the
 * skin the row is withheld, so it never names as WEARING a thing the picture
 * above it is not showing. Take the fit off and both come back together.
 */

/** The fit as a snapshot key ("" for none) — a primitive, so the store hook
 *  sees the same value twice in a row and does not re-render on every read. */
const fitKey = () => resolveEquippedSkin() ?? "";
const noFitOnServer = () => "";

type Band =
  | { kind: "pending" }
  | { kind: "cases"; sealed: number }
  | { kind: "needs-account" }
  | { kind: "none" };

export default function ClosetRewards({ base = "novus" }: { base?: "novus" | "nova" }) {
  const [band, setBand] = useState<Band>({ kind: "pending" });
  const [worn, setWorn] = useState<WornRewardSkin | null>(null);
  const [busy, setBusy] = useState(false);
  const [thumbMissing, setThumbMissing] = useState(false);
  /** A Closet fit is over the reward skin — see the header. */
  const fitOn = useSyncExternalStore(subscribeWardrobe, fitKey, noFitOnServer) !== "";

  useEffect(() => {
    let live = true;
    void fetch("/api/rewards/vault", { credentials: "same-origin" })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (!live) return;
          setBand({ kind: "cases", sealed: Array.isArray(data?.cases) ? data.cases.length : 0 });
          return;
        }
        const who = await identity();
        if (!live) return;
        setBand(who.configured && !who.signedIn ? { kind: "needs-account" } : { kind: "none" });
      })
      .catch(() => { if (live) setBand({ kind: "none" }); });
    return () => { live = false; };
  }, []);

  // The record is read after mount, not in the initialiser: this screen only
  // ever mounts client-side, but the read is a storage access all the same,
  // and the subscription is what keeps the row honest when the collection tab
  // in another tab, or the ceremony, changes the outfit.
  useEffect(() => {
    setWorn(loadWornRewardSkin());
    return subscribeWorn(() => setWorn(loadWornRewardSkin()));
  }, []);

  const takeOff = async () => {
    if (busy) return;
    setBusy(true);
    play("click");
    try {
      const res = await fetch("/api/rewards/equip", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: null }),
      });
      if (res.ok) takeOffRewardSkin();
      else play("error");
    } catch {
      play("error");
    } finally {
      setBusy(false);
    }
  };

  const wornColor = worn ? RARITY_COLORS[TIER_RARITY[worn.tier]] : undefined;

  return (
    <>
      {band.kind === "cases" && (
        <>
          <h2 className="mt-7 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
            BRIEFCASES
          </h2>
          <a
            href="/rewards"
            data-sfx="tab"
            className="nv-gc mt-2 flex items-center justify-between gap-3 rounded-[var(--radius-card)] p-4"
          >
            <span className="min-w-0">
              <span className="block text-sm font-bold">
                {band.sealed > 0
                  ? `${band.sealed} sealed ${band.sealed === 1 ? "case" : "cases"} waiting`
                  : "Today's missions"}
              </span>
              <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-tertiary)]">
                {band.sealed > 0
                  ? "Open them for a skin, tokens or a trial."
                  : "Five missions a day. Finish one and a case is yours."}
              </span>
            </span>
            <span
              className={`shrink-0 text-2xs font-bold tracking-[0.1em] ${
                band.sealed > 0 ? "text-[var(--action)]" : "text-[var(--text-tertiary)]"
              }`}
            >
              {band.sealed > 0 ? "OPEN →" : "VIEW →"}
            </span>
          </a>
        </>
      )}

      {band.kind === "needs-account" && (
        <>
          <h2 className="mt-7 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
            BRIEFCASES
          </h2>
          <div className="mt-2 rounded-[var(--radius-card)] bg-[var(--surface)] p-4">
            <p className="text-sm font-bold">Briefcases need an account</p>
            <p className="mt-0.5 text-2xs leading-snug text-[var(--text-tertiary)]">
              Sign in from Settings and today&rsquo;s five missions are waiting.
            </p>
          </div>
        </>
      )}

      {worn && !fitOn && (
        <div className="mt-2 flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--surface)] p-3">
          {/*
           * The design itself, small, so the row is not just a name at the
           * bottom of a long scroll. Same render the big portrait draws; if
           * it has not shipped, the row keeps its words and drops the picture.
           */}
          {!thumbMissing && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={rewardSkinSrc(worn.id, worn.tier, base === "nova" ? "female" : "male")}
              alt=""
              aria-hidden
              width={40}
              height={40}
              onError={() => setThumbMissing(true)}
              className="h-10 w-10 shrink-0 select-none object-contain"
              draggable={false}
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: wornColor }}
                aria-hidden
              />
              WEARING
            </span>
            <span className="block truncate text-sm font-extrabold">{worn.name}</span>
          </span>
          <button
            type="button"
            onClick={() => void takeOff()}
            disabled={busy}
            aria-label={`Take off ${worn.name}`}
            className="nv-gc shrink-0 rounded-[var(--radius-pill)] px-3 py-2 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
          >
            TAKE OFF
          </button>
        </div>
      )}
    </>
  );
}
