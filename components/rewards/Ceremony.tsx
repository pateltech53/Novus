"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CASE_SPRING, EASE_OUT, STAMP_SPRING } from "@/components/ui/Motion";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sound";
import {
  RARITY_COLORS, TIER_NAMES, UPGRADE_TAPS, type Rarity, type Tier,
} from "@/lib/rewards/tables";

/*
 * The 3-D case is the heaviest thing on this screen and it is not needed until
 * the overlay is actually open, so it loads on demand. The 2-D fallback below
 * is what low-end devices and `ceremony_2d` get.
 */
const CaseCanvas = dynamic(() => import("./CaseCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full" />,
});

export interface RevealItem {
  grantId: string;
  itemId: string;
  kind: string;
  name: string;
  rarity: Rarity;
  wasDupe: boolean;
  tokens: number;
}

export interface RevealPayload {
  briefcaseId: string;
  tier: Tier;
  tierName: string;
  preset: "full" | "prize" | "short";
  upgradePath: number[];
  items: RevealItem[];
  best: Rarity;
}

/**
 * The unlock ceremony.
 *
 * Two references, doing two different jobs:
 *
 * ── Duolingo's chest: the taps ──────────────────────────────────────────────
 *
 * Three taps, each of which MIGHT bump the case a tier. The important thing is
 * that this is not a second roll — the server decided the tier at claim and
 * sent the path down with the payload, so the taps reveal it one step at a
 * time. A flat "here is your Canvas Case" is one moment of mild disappointment;
 * the same case behind three taps is three moments of live hope, and the rare
 * upgrade genuinely jolts. The ground colour tracks the tier, so an upgrade
 * repaints the whole screen — which is what makes it feel like something
 * happened rather than a label changing.
 *
 * ── MadFut's pack: the reveal ───────────────────────────────────────────────
 *
 * The item does not simply appear. It arrives as a SILHOUETTE, the camera
 * pulls back, the rarity announces itself in its own colour, then the name,
 * then a rising wave hands over the card itself. Each stage answers one
 * question the player is already asking, in the order they ask it: is it good?
 * how good? what is it? The alternative — everything at once — is the same
 * information with none of the tension.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 *
 * Any decision. This component receives a payload that is already committed to
 * the database and animates it. If the browser dies at any beat, the item is
 * already owned; reopening replays the identical reveal.
 */

type Stage = "rise" | "taps" | "opening" | "reveal" | "summary";

/** The MadFut sub-beats, in order. */
type RevealBeat = "silhouette" | "rarity" | "name" | "card";

const TIER_GROUND: Record<Tier, string> = {
  1: "#F3EEE6", // canvas cream
  2: "#3B2416", // cognac
  3: "#12304A", // titanium blue
  4: "#140C08", // obsidian
  5: "#3D2C00", // gold
};

const TIER_INK: Record<Tier, string> = {
  1: "#8A5A22", 2: "#F0C070", 3: "#7FD4FF", 4: "#FF6B00", 5: "#F5C518",
};

const RARITY_LABEL: Record<Rarity, string> = {
  common: "COMMON", uncommon: "UNCOMMON", rare: "RARE",
  epic: "EPIC", legendary: "LEGENDARY",
};

/** How long a rarity is allowed to hold the screen. Legendary earns 1.6×. */
const REVEAL_MS: Record<Rarity, number> = {
  common: 620, uncommon: 700, rare: 820, epic: 980, legendary: 1400,
};

export default function Ceremony({
  payload,
  achievement,
  onEquip,
  onClose,
}: {
  payload: RevealPayload;
  /** The thing that earned this — etched in during the rise. */
  achievement?: string;
  onEquip?: (itemId: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const short = payload.preset === "short";

  const [stage, setStage] = useState<Stage>("rise");
  const [tapsUsed, setTapsUsed] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [lastUpgraded, setLastUpgraded] = useState(false);
  const [itemIndex, setItemIndex] = useState(0);
  const [beat, setBeat] = useState<RevealBeat>("silhouette");
  const [equipped, setEquipped] = useState<string | null>(null);

  /*
   * The tier the player can currently SEE.
   *
   * Before all three taps are spent this is the path's value; after, it is the
   * real tier. They agree by construction — the path's last entry IS the tier
   * — but reading from the path while tapping is what lets the case sit at a
   * lower tier until the tap that earns it.
   */
  const shownTier = (
    short || payload.preset === "prize"
      ? payload.tier
      : (payload.upgradePath[tapsUsed] ?? payload.tier)
  ) as Tier;

  const tapsLeft = UPGRADE_TAPS - tapsUsed;
  const item = payload.items[itemIndex];
  const isLast = itemIndex >= payload.items.length - 1;

  // ── beat 1: the rise ──────────────────────────────────────────────────────
  useEffect(() => {
    if (stage !== "rise") return;
    play("activity");
    const ms = reduced ? 220 : 900;
    const timer = setTimeout(() => {
      haptic("dealSigned");
      // A guaranteed prize has nothing to gamble on and a shop purchase was
      // chosen on purpose — faking suspense on either reads as patronising, so
      // both skip straight to the opening.
      setStage(short || payload.preset === "prize" ? "opening" : "taps");
    }, ms);
    return () => clearTimeout(timer);
  }, [stage, reduced, short, payload.preset]);

  // ── beat 3: the lid ───────────────────────────────────────────────────────
  useEffect(() => {
    if (stage !== "opening") return;
    play("unlock");
    haptic("dealSigned");
    const timer = setTimeout(() => setStage("reveal"), reduced ? 200 : 700);
    return () => clearTimeout(timer);
  }, [stage, reduced]);

  // ── beat 4: the MadFut ladder, per item ──────────────────────────────────
  useEffect(() => {
    if (stage !== "reveal") return;
    setBeat("silhouette");
    const hold = reduced ? 120 : 1;
    const t1 = setTimeout(() => { setBeat("rarity"); play(rarityCue(item.rarity)); }, 520 * hold);
    const t2 = setTimeout(() => setBeat("name"), 1120 * hold);
    const t3 = setTimeout(() => {
      setBeat("card");
      haptic(item.rarity === "legendary" ? "chapterSeven" : "choice");
    }, 1520 * hold + (reduced ? 0 : REVEAL_MS[item.rarity] - 620));
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [stage, itemIndex, item, reduced]);

  const tap = useCallback(() => {
    if (stage !== "taps" || tapsUsed >= UPGRADE_TAPS) return;
    const next = tapsUsed + 1;
    const before = (payload.upgradePath[tapsUsed] ?? payload.tier) as Tier;
    const after = (payload.upgradePath[next] ?? payload.tier) as Tier;
    setLastUpgraded(after > before);
    setTapsUsed(next);
    setPulse((p) => p + 1);
    play(after > before ? "bonus" : "click");
    haptic(after > before ? "dealSigned" : "choice");

    if (next >= UPGRADE_TAPS) {
      setTimeout(() => setStage("opening"), reduced ? 200 : 900);
    }
  }, [stage, tapsUsed, payload.upgradePath, reduced]);

  const nextItem = useCallback(() => {
    if (!isLast) { setItemIndex((i) => i + 1); return; }
    setStage("summary");
  }, [isLast]);

  const ground = TIER_GROUND[shownTier];
  const ink = TIER_INK[shownTier];

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden"
      // The ground is the tier. An upgrade repaints the entire screen, which is
      // the cheapest way to make three taps feel like three different places.
      animate={{ backgroundColor: stage === "reveal" || stage === "summary" ? "#080C14" : ground }}
      transition={{ duration: reduced ? 0.15 : 0.5 }}
      initial={{ backgroundColor: ground }}
      role="dialog"
      aria-modal="true"
      aria-label="Opening a briefcase"
    >
      <AnimatePresence mode="wait">
        {stage === "rise" && (
          <RiseBeat key="rise" achievement={achievement} reduced={reduced} ink={ink} />
        )}

        {stage === "taps" && (
          <TapBeat
            key="taps"
            tier={shownTier}
            ink={ink}
            tapsUsed={tapsUsed}
            tapsLeft={tapsLeft}
            pulse={pulse}
            upgraded={lastUpgraded}
            reduced={reduced}
            onTap={tap}
          />
        )}

        {stage === "opening" && (
          <OpeningBeat key="opening" tier={shownTier} best={payload.best} reduced={reduced} />
        )}

        {stage === "reveal" && (
          <RevealBeatView
            key={`reveal-${itemIndex}`}
            item={item}
            beat={beat}
            reduced={reduced}
            index={itemIndex}
            total={payload.items.length}
            equipped={equipped === item.itemId}
            onCollect={nextItem}
            onCollectEquip={async () => {
              setEquipped(item.itemId);
              await onEquip?.(item.itemId);
              nextItem();
            }}
          />
        )}

        {stage === "summary" && (
          <SummaryBeat key="summary" payload={payload} onClose={onClose} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── beats ───────────────────────────────────────────────────────────────────

function RiseBeat({ achievement, reduced, ink }: { achievement?: string; reduced: boolean; ink: string }) {
  return (
    <motion.div
      className="flex w-full max-w-sm flex-col items-center gap-5 px-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <p className="text-2xs font-bold tracking-[0.22em]" style={{ color: ink }}>
        {achievement ? achievement.toUpperCase() : "REWARD EARNED"}
      </p>
      {/* The meter fills bottom→top: the "level rising" beat. */}
      <div className="h-40 w-3 overflow-hidden rounded-full bg-black/15">
        <motion.div
          className="w-full origin-bottom rounded-full"
          style={{ background: ink, height: "100%" }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: reduced ? 0.2 : 0.9, ease: EASE_OUT }}
        />
      </div>
    </motion.div>
  );
}

function TapBeat({
  tier, ink, tapsUsed, tapsLeft, pulse, upgraded, reduced, onTap,
}: {
  tier: Tier; ink: string; tapsUsed: number; tapsLeft: number;
  pulse: number; upgraded: boolean; reduced: boolean; onTap: () => void;
}) {
  const copy =
    tapsUsed === 0 ? "Tap for a chance to upgrade!"
    : tapsLeft === 1 ? "1 chance left!"
    : tapsLeft === 0 ? "Opening…"
    : "Tap! Tap!";

  return (
    <motion.button
      type="button"
      onClick={onTap}
      className="flex w-full max-w-md cursor-pointer flex-col items-center gap-4 px-6 focus-visible:outline-none"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={CASE_SPRING}
      aria-label={`${TIER_NAMES[tier]}. ${copy}`}
    >
      <motion.p
        key={tier}
        className="text-xl font-black tracking-[0.14em]"
        style={{ color: ink }}
        initial={{ scale: reduced ? 1 : 1.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={STAMP_SPRING}
      >
        {TIER_NAMES[tier].toUpperCase()}
      </motion.p>

      <CaseCanvas
        tier={tier}
        pulse={pulse}
        upgraded={upgraded}
        reduced={reduced}
        className="h-64 w-full sm:h-72"
      />

      {/* The three pips. Spent ones go flat; the live one glows. */}
      <div className="flex items-center gap-3">
        {Array.from({ length: UPGRADE_TAPS }, (_, i) => {
          const spent = i < tapsUsed;
          return (
            <motion.span
              key={i}
              className="grid h-9 w-9 place-items-center rounded-full text-sm font-black"
              animate={{
                backgroundColor: spent ? "rgba(0,0,0,0.18)" : ink,
                color: spent ? "rgba(0,0,0,0.25)" : "#0B1220",
                scale: !spent && i === tapsUsed ? [1, 1.12, 1] : 1,
              }}
              transition={{ duration: reduced ? 0 : 1.1, repeat: !spent && i === tapsUsed ? Infinity : 0 }}
            >
              ↑
            </motion.span>
          );
        })}
      </div>

      <p className="text-sm font-bold" style={{ color: ink }}>{copy}</p>
    </motion.button>
  );
}

function OpeningBeat({ tier, best, reduced }: { tier: Tier; best: Rarity; reduced: boolean }) {
  return (
    <motion.div
      className="flex flex-col items-center gap-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.15 }}
    >
      {/* The interior glow is the BEST rarity in the case — players learn to
          read it, and it is the second jackpot moment. */}
      <motion.div
        className="h-64 w-64 rounded-full"
        style={{ background: `radial-gradient(circle, ${RARITY_COLORS[best]}cc 0%, transparent 68%)` }}
        initial={{ scale: 0.2, opacity: 0 }}
        animate={{ scale: reduced ? 1 : [0.2, 1.35, 1], opacity: [0, 1, 0.9] }}
        transition={{ duration: reduced ? 0.2 : 0.7 }}
      />
      <p className="text-2xs font-bold tracking-[0.2em] text-white/70">
        {TIER_NAMES[tier].toUpperCase()}
      </p>
    </motion.div>
  );
}

function RevealBeatView({
  item, beat, reduced, index, total, equipped, onCollect, onCollectEquip,
}: {
  item: RevealItem; beat: RevealBeat; reduced: boolean;
  index: number; total: number; equipped: boolean;
  onCollect: () => void; onCollectEquip: () => void;
}) {
  const color = RARITY_COLORS[item.rarity];
  const isSkin = item.kind === "skin";

  return (
    <motion.div
      className="flex w-full max-w-sm flex-col items-center gap-5 px-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      {total > 1 && (
        <p className="text-2xs tracking-[0.18em] text-white/40">{index + 1} / {total}</p>
      )}

      {/* The card. It starts as a black silhouette and the camera pulls back —
          the rarity wash arrives before anything is legible. */}
      <motion.div
        className="relative grid aspect-[3/4] w-56 place-items-center overflow-hidden rounded-2xl border"
        style={{ borderColor: beat === "silhouette" ? "#1b2436" : color }}
        initial={{ scale: reduced ? 1 : 1.45, opacity: 0 }}
        animate={{
          scale: beat === "silhouette" ? (reduced ? 1 : 1.2) : 1,
          opacity: 1,
          boxShadow: beat === "silhouette" ? "0 0 0 rgba(0,0,0,0)" : `0 0 60px ${color}55`,
        }}
        transition={{ duration: reduced ? 0.15 : 0.75, ease: EASE_OUT }}
      >
        <motion.div
          className="absolute inset-0"
          animate={{ background: beat === "silhouette" ? "#0B1220" : `linear-gradient(160deg, ${color}33, #0B1220 70%)` }}
          transition={{ duration: reduced ? 0.15 : 0.5 }}
        />
        {/* The rising wave that hands over the card. */}
        {beat === "card" && !reduced && (
          <motion.div
            className="absolute inset-x-0 bottom-0 h-full origin-bottom"
            style={{ background: `linear-gradient(to top, ${color}, transparent)` }}
            initial={{ scaleY: 0, opacity: 0.9 }}
            animate={{ scaleY: 1.3, opacity: 0 }}
            transition={{ duration: 0.85, ease: EASE_OUT }}
          />
        )}
        <div className="relative z-10 flex flex-col items-center gap-2 px-4 text-center">
          {beat !== "silhouette" && (
            <motion.p
              className="text-sm font-black tracking-[0.18em]"
              style={{ color }}
              initial={{ y: reduced ? 0 : 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
            >
              {RARITY_LABEL[item.rarity]}
            </motion.p>
          )}
          {(beat === "name" || beat === "card") && (
            <motion.p
              className="text-base font-bold text-white"
              initial={{ y: reduced ? 0 : 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
            >
              {item.name}
            </motion.p>
          )}
          {beat === "card" && item.wasDupe && (
            <motion.p
              className="text-2xs text-white/60"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            >
              Already owned → +{item.tokens} tokens
            </motion.p>
          )}
        </div>
      </motion.div>

      {beat === "card" && (
        <motion.div
          className="flex w-full flex-col gap-2"
          initial={{ y: reduced ? 0 : 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          {isSkin && !item.wasDupe && (
            <button
              type="button"
              onClick={onCollectEquip}
              className="rounded-[var(--radius-row)] py-3 text-sm font-bold text-[#0B1220]"
              style={{ background: color }}
            >
              {equipped ? "EQUIPPED" : "COLLECT & EQUIP"}
            </button>
          )}
          <button
            type="button"
            onClick={onCollect}
            className="rounded-[var(--radius-row)] border border-white/20 py-3 text-sm font-bold text-white"
          >
            COLLECT
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}

function SummaryBeat({ payload, onClose }: { payload: RevealPayload; onClose: () => void }) {
  const tokens = useMemo(
    () => payload.items.reduce((sum, i) => sum + i.tokens, 0),
    [payload.items],
  );
  return (
    <motion.div
      className="flex w-full max-w-sm flex-col items-center gap-5 px-6"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    >
      <p className="text-2xs font-bold tracking-[0.2em] text-white/50">
        {payload.tierName.toUpperCase()} OPENED
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {payload.items.map((item) => (
          <div
            key={item.grantId}
            className="rounded-[var(--radius-row)] border px-3 py-2 text-2xs"
            style={{ borderColor: RARITY_COLORS[item.rarity], color: RARITY_COLORS[item.rarity] }}
          >
            {item.name}
          </div>
        ))}
      </div>
      {tokens > 0 && <p className="text-sm text-white/70">+{tokens} Shark Tokens</p>}
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-[var(--radius-row)] bg-[#FF6B00] py-3 text-sm font-bold text-white"
      >
        BACK TO CHALLENGES
      </button>
    </motion.div>
  );
}

/** Rarer pulls get a louder cue; the three-note sting is Legendary's alone. */
function rarityCue(rarity: Rarity) {
  if (rarity === "legendary") return "celebrate" as const;
  if (rarity === "epic") return "bonus" as const;
  if (rarity === "rare") return "success" as const;
  return "activity" as const;
}
