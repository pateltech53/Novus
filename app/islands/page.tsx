"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import { Boat } from "@/components/Boat";
import { GlassButton } from "@/components/ui/Glass";
import { ISLAND_ASPECT, IslandGlyph } from "@/components/IslandGlyph";
import {
  useNativeOverlay,
  useNativeOverlayOwned,
} from "@/components/native/useNativeOverlay";
import {
  SEA_POSITIONS,
  Sea,
  seaFieldWidth,
  seaPosition,
} from "@/components/Sea";
import { ENTER, SETTLE_SPRING, STAGGER, SWAP } from "@/components/ui/Motion";
import { UPGRADE_WARM, useUpgrade } from "@/components/upgrade/UpgradeProvider";
import { loadAccount, type Account } from "@/lib/account";
import { signOut } from "@/lib/cloud/auth";
import { entryRoute } from "@/lib/entry";
import { storefront } from "@/lib/commerce";
import { appPath } from "@/lib/native/href";
import type { NativeOverlayState } from "@/lib/native/glass";
import { useResolvedTheme } from "@/lib/native/theme";
import { INDUSTRIES, STAGE_NAME } from "@/lib/engine/constants";
import { fmtMoney } from "@/lib/engine/format";
import type { IslandSummary } from "@/lib/engine/save";
import type { StageNum } from "@/lib/engine/types";
import {
  ISLAND_CAP,
  PRO_LIMITS,
  islandCapFor,
  isPro,
  loadEntitlements,
  onEntitlementsChange,
  runsRemainingToday,
} from "@/lib/monetization";
import { useNavigating } from "@/lib/navigating";
import { usePrefetch } from "@/lib/prefetch";
import { introSeen } from "@/lib/rewards/intro";
import { useWarm, warm } from "@/lib/warm";
import { play } from "@/lib/sound";
import { GameProvider, useGame } from "@/lib/state/GameProvider";

/*
 * The one-time "Introducing Briefcases" card, split out for the same reason
 * app/play/page.tsx splits it: most players see it once and new players never
 * (components/rewards/BriefcaseIntro.tsx). It is mounted here as well as on
 * the board because a returning player whose last company ended lands on
 * this screen, not on /play, and would otherwise be introduced only on the
 * day they founded again.
 */
const BriefcaseIntro = warm(() =>
  import("@/components/rewards/BriefcaseIntro").then((m) => m.BriefcaseIntro),
);

/** The sea gets its entrance to itself first — the islands stagger in over
 *  roughly half a second, and the card should arrive after the water has
 *  settled rather than through it. */
const BRIEFCASE_INTRO_DELAY_MS = 1100;

export default function IslandsPageWrapper() {
  return (
    <GameProvider>
      <IslandsPage />
    </GameProvider>
  );
}

/**
 * The archipelago — every company this player has, on one screen.
 *
 * ── Why this screen exists ─────────────────────────────────────────────────
 *
 * Until islands, "which company am I playing" was not a question the app could
 * ask, because the answer could only ever be "the one". `/found` carried the
 * whole burden instead: it was the new-company form, the resume card, the
 * replace confirmation AND the paywall, and founding a second company meant
 * destroying the first one behind a two-tap confirm.
 *
 * So this is the front door now, and `/found` goes back to being one thing.
 *
 * ── Two views, and why it is not one ───────────────────────────────────────
 *
 * **The sea** answers "what have I got?" — every island on the water at once,
 * where their number, their size and their state are the whole message and no
 * figure is worth the space it would take.
 *
 * **The gallery** answers "how is this one doing?" — one island, large, its
 * books beside it, and ‹ › to walk the row.
 *
 * A single view has to choose, and every version that chose lost something. A
 * grid of full cards buries the archipelago in numbers by the fourth company;
 * a map with the numbers on it IS that grid. So: two views, one tap apart,
 * with the sea as the door — because "what have I got" is the question a
 * player arrives with.
 *
 * ── The four states of an island ───────────────────────────────────────────
 *
 *   · **Open** — a company still going. Tap it and play.
 *   · **Headstone** — Chapter 7, acquired, or listed. It keeps its island and
 *     its books stay readable, and it does NOT spend the allowance. A free
 *     tier whose two islands fill with two graves is a game that politely
 *     stops, which is a limit designed to sell something rather than to mean
 *     something. `slotForNewCompany` and 0013's `enforce_island_cap` both
 *     count the living only.
 *   · **Empty** — room under the allowance. Founds a company.
 *   · **Locked** — beyond the allowance. Says what would open it, once.
 *
 * Every figure is read from `IslandSummary`, which mirrors what `saves`'
 * listing cache holds server-side — so ten companies cost an index read rather
 * than ten RunState parses.
 */
function IslandsPage() {
  const router = useRouter();
  const game = useGame();
  const upgrade = useUpgrade();

  /* Entitlements are read after mount and re-read on every write. Buying an
     island happens without leaving this screen, and reading once would leave
     the player staring at the locked island they just paid to open. */
  const [cap, setCap] = useState(2);
  const [pro, setPro] = useState(false);
  const [foundingsLeft, setFoundingsLeft] = useState<number | null>(null);
  useEffect(() => {
    const sync = () => {
      const e = loadEntitlements();
      setCap(islandCapFor(e));
      setPro(isPro(e));
      setFoundingsLeft(runsRemainingToday(e));
    };
    sync();
    return onEntitlementsChange(sync);
  }, []);

  const [opening, open] = useNavigating();
  usePrefetch("/play");
  usePrefetch("/found");
  /*
   * The two routes are the navigation; this is the refusal.
   *
   * A locked industry on this screen answers with the upgrade notice, which is
   * `dynamic()` and therefore renders nothing at all on the first gate of a
   * session while its module arrives — a refusal that appears a beat after the
   * tap reads as the tap having done nothing. Warmed here rather than in the
   * provider, which the root layout mounts on pages that have no gates.
   */
  useWarm(UPGRADE_WARM);

  /*
   * The account, for the way out of it.
   *
   * Signing out lived only inside the Settings sheet, which is inside a
   * company — so a player who wanted to leave the account had to enter a
   * company first. This is the screen you arrive on and the screen the account
   * owns; the door belongs here. Null when nobody is signed in, and then
   * nothing is drawn: there is no account to leave.
   */
  const [account, setAccount] = useState<Account | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => setAccount(loadAccount()), []);

  /** Where signing out lands. Same reasoning as SettingsScreen's `leave`: the
   *  device is emptied, so it is a navigation and not a router push, and the
   *  app cannot go to "/" because that page carries prices a store build may
   *  not show (Guideline 3.1.1). */
  const leaveAccount = async () => {
    if (leaving) return;
    setLeaving(true);
    await signOut();
    const route = entryRoute();
    if (storefront() === "web") {
      window.location.href = route === "/islands" ? "/" : route;
      return;
    }
    window.location.href = appPath(route === "/islands" ? "/welcome" : route);
  };

  /** null = the sea. A slot number = that island, alone, in the gallery. */
  const [focus, setFocus] = useState<number | null>(null);
  /** Which way the last ‹ › went, so the gallery slides the right way. */
  const [dir, setDir] = useState(1);

  /*
   * ── The briefcase introduction, on the sea ────────────────────────────────
   *
   * The same card and the same rules as app/play/page.tsx, which carries the
   * long version: an onboarded profile, the seen-flag read in an effect and
   * never during render, one beat of delay, the module fetched only on the
   * visit that will show it, and offered at most once per mount so a
   * dismissal can never bring it straight back. The gallery is left alone —
   * the sea is the view every arrival opens on, and a card over a single
   * island's books would be a card over the thing being read.
   *
   * `game.profile` is null until the provider's own mount effect reads it, so
   * the gate simply waits for that to become true.
   */
  const [briefcaseIntro, setBriefcaseIntro] = useState(false);
  const introOffered = useRef(false);
  // `opening` and `leaving` are both the player already on their way
  // somewhere else — into a company, or out of the account — and a card that
  // lands on a screen being left is a card nobody reads.
  const introEligible =
    !!game.profile?.onboarded && focus === null && !opening && !leaving;

  useEffect(() => {
    if (introOffered.current || !introEligible) return;
    if (introSeen()) {
      introOffered.current = true;
      return;
    }
    void BriefcaseIntro.preload();
    const t = window.setTimeout(() => {
      introOffered.current = true;
      setBriefcaseIntro(true);
    }, BRIEFCASE_INTRO_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [introEligible]);

  // Stable: the card registers it as its Android back handler, and that
  // stack keeps the closure it was handed at registration.
  const closeBriefcaseIntro = useCallback(() => setBriefcaseIntro(false), []);

  const islands = game.islands;
  const living = islands.filter((i) => i.alive);
  const canFound = living.length < cap;

  /*
   * How many places to draw, and the three things that decide it.
   *
   * Places are POSITIONAL — place N is island N, at `seaPosition(N)` — so this
   * cannot be a count of what exists. An island in slot 5 with 0–4 empty still
   * needs six places, or it simply is not on the water.
   *
   *  1. Every occupied slot, headstones included. The allowance counts only
   *     the living, so graves are extra rather than instead — and a grave that
   *     pushed a running company off the map would be the worst version of
   *     this screen.
   *  2. At least two places while there is room, so the sea reads as an
   *     archipelago on the first visit rather than as one shape and a title.
   *  3. Exactly one more — an empty place to found on, or a locked one to say
   *     where the water ends. One: a Pro player with two companies wants their
   *     two companies, not eight dotted circles floating behind them.
   */
  const bySlot = new Map(islands.map((i) => [i.slot, i]));
  const occupiedThrough = islands.reduce((n, i) => Math.max(n, i.slot + 1), 0);
  const floor = Math.max(occupiedThrough, canFound ? 2 : 0);
  const extra = canFound ? (floor === occupiedThrough ? 1 : 0) : pro ? 0 : 1;
  const places = Math.min(ISLAND_CAP, floor + extra);

  /*
   * ── When there is more sea than screen ──────────────────────────────────
   *
   * `baseSizeFor` used to absorb every extra company by shrinking all of them,
   * which is the right answer up to a point and a bad one past it: the names
   * under the islands are a fixed 13ch column whatever the island does, so past
   * about ten the captions collide even though the islands do not. Shrinking is
   * a budget with a floor, and past that floor the only thing left to give is
   * water.
   *
   * So the water gets longer. `seaFieldWidth` measures how much of it this
   * archipelago needs — in percent of one phone, from the islands actually
   * drawn — and the picker scrolls sideways through it. Nothing changes for ten
   * islands or fewer, which is every player: one screen, the authored table,
   * exactly as before.
   */
  const field = seaFieldWidth(places);
  /* How big an island is drawn — by how many share ONE screen of water, not by
     how many exist, now that the water can be longer than the screen. */
  const islandSize = baseSizeFor(Math.min(places, SEA_POSITIONS.length));

  /*
   * The water between the title and the boat, measured rather than assumed.
   *
   * `SEA_POSITIONS` keeps two lanes clear — nothing above y=13 or below y=72 —
   * and those numbers were chosen against a title of one line. Two companies
   * make it "2 companies, all yours.", which wraps at 320px, and a wrapped
   * title reaches further down the screen than 13% of it: the island in slot 7
   * sits at y=13 and landed under the second line. Reported as islands
   * overlapping the text above them, and it is not a margin that can be tuned
   * because the thing it has to clear changes height with the sentence in it.
   *
   * So the field is inset by what the header and the boat actually measure, and
   * the band is stretched across what is left. Nothing can overlap either,
   * whatever they end up being — including a name long enough to wrap twice.
   */
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  const [boatEl, setBoatEl] = useState<HTMLDivElement | null>(null);
  const [lanes, setLanes] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    if (!headerEl && !boatEl) return;
    const measure = () =>
      setLanes({
        top: headerEl?.offsetHeight ?? 0,
        bottom: boatEl?.offsetHeight ?? 0,
      });
    measure();
    const ro = new ResizeObserver(measure);
    if (headerEl) ro.observe(headerEl);
    if (boatEl) ro.observe(boatEl);
    return () => ro.disconnect();
  }, [headerEl, boatEl]);

  /*
   * Which way there is still water. Read from the scroller itself rather than
   * derived from the screen count, because the answer depends on where the player
   * has sailed to and a hint pointing at the edge you are already standing on
   * is worse than no hint.
   */
  const seaScrollRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const onSeaScroll = useCallback(() => {
    const el = seaScrollRef.current;
    /*
     * Gated on the screen count, not on `scrollWidth`.
     *
     * A one-screen archipelago still overflows by a few pixels — island 7 sits
     * at x=87 and its caption is a 13ch column centred on it, so ~11px of the
     * name hangs past the right edge and is clipped, exactly as it always was.
     * Reading that as "there is more water over there" put the hint on screen
     * for eight islands, pointing at nothing.
     */
    if (!el || field <= 100) {
      setMore({ left: false, right: false });
      return;
    }
    const slack = el.scrollWidth - el.clientWidth;
    setMore({
      left: el.scrollLeft > 24,
      right: el.scrollLeft < slack - 24,
    });
  }, [field]);
  /* Once on arrival, and again whenever the archipelago changes size — the
     hint has to be right before the first gesture, not after it. */
  useEffect(() => {
    onSeaScroll();
  }, [onSeaScroll, places, field, focus, lanes.top, lanes.bottom]);

  const enter = useCallback(
    (slot: number) => {
      play("click");
      open(() => {
        game.switchIsland(slot);
        router.push("/play");
      });
    },
    [game, open, router],
  );

  const found = (slot: number) => {
    play("click");
    // /found reads the slot back out of the query, so a player who tapped a
    // specific empty place founds THERE rather than wherever the default lands.
    open(() => router.push(`/found?island=${slot}`));
  };

  /* ‹ › walk the islands that exist, in slot order, and wrap. Wrapping because
     the row is short and a disabled arrow at each end is two dead controls on
     a screen that only has four live ones. */
  const step = useCallback(
    (by: number) => {
      setFocus((at) => {
        if (at === null || islands.length < 2) return at;
        const i = islands.findIndex((is) => is.slot === at);
        if (i < 0) return at;
        play("click");
        setDir(by);
        return islands[(i + by + islands.length) % islands.length].slot;
      });
    },
    [islands],
  );

  /* The gallery is a view, not a route, so it answers the keyboard the way
     every other overlay in this app does. */
  useEffect(() => {
    if (focus === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(null);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, step]);

  const focused = focus === null ? null : (bySlot.get(focus) ?? null);

  /*
   * ── The gallery's chrome, in the real material ────────────────────────────
   *
   * Everything on the sea is scenery — the water, the islands, one line of
   * small print in a boat — and scenery has no chrome. The gallery does: a way
   * back, a way along the row, and the one thing this screen exists to ask.
   * Those are controls, and on iOS a control is a UIKit view or it is an
   * impression of one (components/ui/Glass.tsx: the CSS material is retired).
   *
   * So the three of them are handed over. Back rides the leading cluster with
   * its name on it, ‹ › become a merged pair of glass circles in the trailing
   * one, and CONTINUE is the prominent control in the floating dock. Which
   * moves the arrows off the island they were flanking — deliberately: a
   * toolbar pager is the iOS idiom for walking a row, and it buys the island
   * the full width of the screen to be drawn in. The DOM keeps the flanking
   * arrows for the web and Android, where there is no material to move them to.
   *
   * Declared HERE rather than inside `Gallery` so the sea has an opinion too:
   * `null` is a screen actively saying it wants no chrome, which withdraws
   * whatever the last screen left up. The hook is a stack, and a page that
   * never joins it is a page that cannot clear it.
   */
  const nativeChrome = useNativeOverlayOwned();
  const theme = useResolvedTheme();
  const many = islands.length > 1;
  const overlay = useMemo<NativeOverlayState | null>(() => {
    if (!focused) {
      /*
       * ── The sea has one control after all ────────────────────────────────
       *
       * It declared `null` — no chrome, because everything on the water is
       * scenery. That was right until the account's own door landed here, and
       * a DOM pill was the only place to put it.
       *
       * Which is why it did not read as Liquid Glass, and could not: `.nv-gc`
       * blurs what is behind it, and behind it is open water — a near-flat
       * field with a few hairline crests. Blurring almost nothing produces
       * almost nothing, and under a 70% tint what is left is a dark pill.
       * No tone fixes that; the material was working and had nothing to work
       * with.
       *
       * On iOS the answer is not a better impression. It is the system's own
       * `UIGlassEffect` — which is the rule the rest of this app already
       * follows (components/ui/Glass.tsx, and the play screen's whole chrome).
       * So the sea declares a toolbar with exactly one button in it, and the
       * DOM pill is not rendered at all where UIKit has drawn one.
       */
      if (!account?.email) return null;
      // Withdrawn while the briefcase card is up, for the reason every DOM
      // overlay in the app withdraws the chrome: a UIKit button composites
      // above the webview, and a sign-out floating over an announcement is a
      // control the card cannot cover and did not ask for.
      if (briefcaseIntro) return null;
      return {
        mode: "shown",
        theme,
        // No title plate: "YOUR ISLANDS" is already set on the water 40pt
        // below this, and a second copy would be the same words twice.
        title: null,
        leading: [],
        trailing: [
          {
            id: "signout",
            symbol: "rectangle.portrait.and.arrow.right",
            label: `Sign out of ${account.email}`,
            style: "plain",
            enabled: !leaving,
          },
        ],
        actions: [],
      };
    }
    return {
      mode: "shown",
      theme,
      // No title plate: the company's name is already set 26px high in the
      // middle of the screen, and a second copy 60pt above it is the same
      // words twice.
      title: null,
      leading: [
        {
          id: "back",
          symbol: "chevron.backward",
          title: "All islands",
          label: "Back to all your islands",
          style: "plain",
        },
      ],
      trailing: many
        ? [
            {
              id: "prev",
              symbol: "chevron.left",
              label: "Previous island",
              style: "plain",
            },
            {
              id: "next",
              symbol: "chevron.right",
              label: "Next island",
              style: "plain",
            },
          ]
        : [],
      actions: [
        {
          id: "enter",
          title: opening
            ? "OPENING…"
            : focused.alive
              ? "CONTINUE"
              : "READ THE BOOKS",
          label: focused.alive
            ? `Open ${focused.companyName}`
            : `Read the books for ${focused.companyName}`,
          style: "prominent",
          enabled: !opening,
        },
      ],
    };
  }, [focused, theme, many, opening, account?.email, leaving, briefcaseIntro]);

  useNativeOverlay(overlay, {
    onAction: (id) => {
      if (id === "back") setFocus(null);
      else if (id === "prev") step(-1);
      else if (id === "next") step(1);
      else if (id === "signout") void leaveAccount();
      else if (id === "enter" && focus !== null) enter(focus);
    },
  });

  return (
    /*
     * The water is the page, edge to edge — no column, no panel, no corners.
     * `overflow-hidden` because an island near the margin hangs its label past
     * the safe area on a narrow phone, and a horizontal scrollbar on the front
     * door is the least forgivable place to have one.
     */
    <main className="relative min-h-dvh w-full overflow-hidden">
      <Sea className="pointer-events-none absolute inset-0 h-full w-full" />

      <AnimatePresence mode="wait" initial={false}>
        {focused ? (
          <Gallery
            key="gallery"
            island={focused}
            dir={dir}
            index={islands.findIndex((i) => i.slot === focused.slot)}
            total={islands.length}
            busy={opening}
            native={nativeChrome}
            onStep={step}
            onBack={() => setFocus(null)}
            onEnter={() => enter(focused.slot)}
          />
        ) : (
          <motion.div
            key="sea"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SWAP}
            className="absolute inset-0"
          >
            {/*
              The title, ON the water rather than above it. `pointer-events-
              none` so it never swallows a tap meant for an island drifting
              underneath it — nothing here is tappable.
            */}
            {/*
              A whole extra rem on top of `--nv-safe-top`, which already clears
              the island. This is a title on open water with nothing above it,
              and the gap is composition rather than clearance — the eyebrow
              wants to read as floating on the sea, not as pinned to the top of
              the phone.
            */}
            <header
              ref={setHeaderEl}
              /* `--nv-overlay-top` is what UIKit measured its toolbar to be,
                 and 0 on the web and Android where there is not one. The sea
                 declares a toolbar now (the sign-out), so the title has to
                 clear it for the same reason the gallery's column does. */
              className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-3 px-6 pt-[max(2.5rem,calc(var(--nv-safe-top)+1rem),calc(var(--nv-overlay-top)+0.75rem))] pb-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
                  YOUR ISLANDS
                </p>
                <h1 className="mt-1 max-w-[15ch] text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em] sm:max-w-none">
                  {living.length === 0
                    ? "Nothing running yet."
                    : living.length === 1
                      ? "One company on the water."
                      : `${living.length} companies, all yours.`}
                </h1>
              </div>

              {/* The one control on the water, and it is `pointer-events-auto`
                  against a header that is not — the title must never swallow a
                  tap meant for an island drifting under it. Quiet glass, not
                  action: leaving is not what this screen is asking you to do. */}
              {/* Not rendered rather than hidden, which is the rule every
                  native-chrome caller in this app follows: a hidden button
                  still takes a tap on iOS if the native view above it passes
                  the touch through, and the player gets a dead zone nobody can
                  see. */}
              {nativeChrome || !account?.email ? null : (
                <GlassButton
                  /*
                   * The full material, not `quiet`.
                   *
                   * `quiet` thins the tint to 55%, the ring to 70% and drops
                   * the shadow entirely — which is right for a cancel sitting
                   * beside a confirm, and wrong for the only control on an
                   * open ocean. With nothing around it to be quiet next to it
                   * read as a flat grey pill rather than a lens over water,
                   * which is what it was reported as. Neutral keeps the ring,
                   * the specular edge and the drop, so it is glass with the
                   * sea visibly behind it.
                   */
                  shape="pill"
                  onClick={() => void leaveAccount()}
                  disabled={leaving}
                  aria-label={`Sign out of ${account.email}`}
                  /*
                   * A thinner tint than the default, for this control only.
                   *
                   * The material reads as glass by showing you something
                   * through it. Everywhere else in this app there is a board,
                   * a ledger or a photograph behind a control; here there is
                   * open water — near-flat, with a few hairline crests — and
                   * at the standard 70% tint the crests do not come through at
                   * all. Half of it, and the swell passes behind the pill,
                   * which is the whole difference between a lens and a chip.
                   */
                  style={
                    {
                      "--gc-tint":
                        "color-mix(in oklch, var(--glass-tint) 50%, transparent)",
                    } as CSSProperties
                  }
                  className="pointer-events-auto shrink-0 text-2xs tracking-[0.12em] disabled:opacity-50"
                >
                  {leaving ? "SIGNING OUT…" : "SIGN OUT"}
                </GlassButton>
              )}
            </header>

            {/*
              ── The islands ─────────────────────────────────────────────────
              Positioned in PERCENTAGES of the whole screen, inside a column
              that is capped on a desktop. Uncapped, ten islands on a 2560px
              monitor would be ten specks against a mile of empty water; capped,
              the archipelago stays an archipelago and the extra width is the
              ocean it is in, which is the point.
            */}
            <div
              ref={seaScrollRef}
              onScroll={onSeaScroll}
              /* `overscroll-x-contain` so sailing to the end of the archipelago
                 does not hand the gesture to the browser and trigger a back
                 swipe on the front door. The scrollbar is hidden because this
                 is water, not a list — the hint below is what says there is
                 more, and it says it in words. */
              className={`nv-noscrollbar absolute inset-x-0 overscroll-x-contain ${
                field > 100 ? "overflow-x-auto" : "overflow-x-hidden"
              }`}
              style={{ top: lanes.top, bottom: lanes.bottom }}
            >
              {/* `max-w-3xl` PER SCREEN, not for the whole field. The cap is
                  there so ten islands on a 2560px monitor are an archipelago
                  rather than ten specks a mile apart; multiplying it by the
                  field width keeps that density and still lets the water be
                  longer than the window. */}
              <div
                className="relative mx-auto h-full"
                style={{
                  width: `${field}%`,
                  maxWidth: `calc(48rem * ${field / 100})`,
                }}
              >
                {Array.from({ length: places }, (_, slot) => {
                  /* `seaPosition`, not `SEA_POSITIONS[slot]`. The table stops at
                   the authored ten and the cap is fifty — indexing it returned
                   undefined for island 10 and threw on the next line. */
                  const spot = seaPosition(slot);
                  const island = bySlot.get(slot);
                  return (
                    <motion.div
                      key={slot}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...ENTER, delay: slot * STAGGER }}
                      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                      /* `x` is a percent of its OWN screen, and the field is
                       `field`% of one screen wide — so the screen offset and
                       the position within it are rescaled together. */
                      style={{
                        left: `${((spot.screen * 100 + spot.x) / field) * 100}%`,
                        top: `${bandY(spot.y)}%`,
                      }}
                    >
                      {island ? (
                        <SeaIsland
                          island={island}
                          depth={spot.depth}
                          base={islandSize}
                          current={slot === game.island}
                          onOpen={() => {
                            play("click");
                            setDir(1);
                            setFocus(slot);
                          }}
                        />
                      ) : canFound ? (
                        <SeaEmpty
                          slot={slot}
                          depth={spot.depth}
                          base={islandSize}
                          busy={opening}
                          onFound={() => found(slot)}
                        />
                      ) : (
                        <SeaLocked
                          depth={spot.depth}
                          base={islandSize}
                          onAsk={() => upgrade.open("islands")}
                        />
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/*
              ── There is more over there ─────────────────────────────────────

              Only when there genuinely is, and only on the side it is on. A
              permanent arrow is decoration; one that disappears when you reach
              the end is the sea telling you where you are.

              It sits in the strip between the bottom of the island band and the
              boat — `bandY` stops at 85% of the field on purpose, and this is
              what that last 15% is for. Floated in the middle of the water it
              landed on whichever island happened to be under it, which is a
              hint that creates the problem it is describing.
            */}
            <AnimatePresence>
              {more.right && (
                <motion.div
                  key="more-right"
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 6 }}
                  transition={SWAP}
                  className="pointer-events-none absolute right-4 z-10"
                  style={{ bottom: lanes.bottom }}
                >
                  <span className="nv-gc flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]">
                    MORE OVER THERE
                    <span aria-hidden>▸</span>
                  </span>
                </motion.div>
              )}
              {more.left && (
                <motion.div
                  key="more-left"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={SWAP}
                  className="pointer-events-none absolute left-4 z-10"
                  style={{ bottom: lanes.bottom }}
                >
                  <span className="nv-gc flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]">
                    <span aria-hidden>◂</span>
                    BACK THAT WAY
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/*
              ── The small print, in a boat ──────────────────────────────────
              Everything on this screen that is not an island lives here. Two
              sentences at most, and the second only when a limit is actually
              in the way: the island cap and the daily founding ration are
              DIFFERENT limits answered by different things — Pro or burying
              one, versus tomorrow — and a screen that says "you have hit the
              limit" without saying which is how a player buys the wrong fix.
            */}
            <div
              ref={setBoatEl}
              className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-6 pt-4 pb-[max(1.75rem,var(--nv-safe-bottom))]"
            >
              <Boat className="nv-bob pointer-events-auto max-w-[22rem]">
                {/* This account's OWN number, not the tier's brochure one.
                    It used to read "Up to 50 at once" for any Pro player,
                    which was true only while the ceiling and Pro's allowance
                    were the same ten — since 0015 they are not, and `cap` is
                    the only figure that stays right for a free player, a Pro
                    player, and either of them after buying an island. */}
                <p className="text-2xs leading-relaxed text-[var(--text-secondary)]">
                  {cap} at once{pro ? "" : " on free"}. Each island keeps its
                  own year and its own books.
                </p>
                {canFound && foundingsLeft === 0 && (
                  <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
                    Room for another, but that is one founding a day on free and
                    today&rsquo;s is spent.
                  </p>
                )}
                {!canFound && !pro && (
                  <button
                    type="button"
                    onClick={() => upgrade.open("islands")}
                    className="mt-1 block w-full text-2xs leading-snug"
                  >
                    <span className="whitespace-nowrap font-bold text-[var(--color-prestige)] underline underline-offset-4">
                      See what Pro adds
                    </span>
                  </button>
                )}
              </Boat>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Once, for a player onboarded before briefcases reached everyone —
          over the sea only; the gate above never fires in the gallery. The
          card writes its own seen-flag on every way out. */}
      {briefcaseIntro && <BriefcaseIntro onClose={closeBriefcaseIntro} />}
    </main>
  );
}

// ── On the water ─────────────────────────────────────────────────────────────

/**
 * The label under an island.
 *
 * Absolutely positioned and centred, so a long company name grows in both
 * directions from the island rather than shoving it sideways — every island on
 * this scene is placed by its centre and the name must not move it.
 */
function Label({
  title,
  sub,
  muted,
  dot,
}: {
  title: string;
  sub: string;
  muted?: boolean;
  dot?: boolean;
}) {
  return (
    <span className="absolute top-full left-1/2 flex w-[13ch] -translate-x-1/2 flex-col items-center pt-0.5">
      <span
        className={`max-w-full truncate text-xs font-extrabold leading-tight tracking-[-0.01em] ${
          muted ? "text-[var(--text-secondary)]" : ""
        }`}
      >
        {title}
      </span>
      <span className="flex items-center gap-1 text-[0.5rem] font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
        {dot && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-[var(--radius-pill)] bg-[var(--action)]"
          />
        )}
        {sub}
      </span>
    </span>
  );
}

/**
 * The near island's width in px, before `depth` scales it back for the ones
 * further out — and it depends on how many islands there are.
 *
 * A fixed size has to be the size that survives the WORST case, which is ten
 * islands on a 390px phone. Everyone then pays for that: the player with one
 * company, which is most of them on most days, gets a lone island drawn at the
 * size that keeps ten from colliding, adrift in an ocean with nothing else in
 * it. The screen is emptiest exactly when the islands could afford to be
 * biggest.
 *
 * So the scene breathes. Two companies get a big, close archipelago; ten get a
 * wider, smaller one, which is what an archipelago of ten looks like anyway.
 *
 * Linear rather than anything cleverer, because the constraint it is dodging
 * is linear: the names sit in a fixed 13ch column under each island, and what
 * runs out is the horizontal gap between two captions. The bounds are measured
 * — 185 is where two islands stop being comfortable at 390px, 113 is where ten
 * stop overlapping — so both are numbers to re-measure if SEA_POSITIONS moves,
 * not constants to taste.
 */
const baseSizeFor = (places: number): number =>
  Math.round(ART_SCALE * Math.min(185, Math.max(113, 185 - (places - 2) * 9)));

/**
 * The measured bounds above are in DRAWN-GLYPH widths, and the artwork is not
 * drawn to the same proportions.
 *
 * The old glyph's box was mostly margin: its sand ellipse was 64 units of a
 * 120-unit viewBox, so 53% of the width it claimed. The keyed artwork fills
 * 80% of its own frame. Handed the same number, every island would come out
 * half again as wide, and the ten hand-placed positions — spaced by what a
 * 13-character caption needs, not by what an island needs — would start
 * colliding at the counts the layout probe covers.
 *
 * 0.53 ÷ 0.80. The number is a ratio between two drawings rather than a taste,
 * which is why it is written as one: re-crop the art and this is the thing to
 * re-measure, not the bounds above it.
 */
const ART_SCALE = 0.53 / 0.8;

/**
 * `SEA_POSITIONS`' y, mapped onto the water that is actually left.
 *
 * The table reserves y=0..13 for the title and y=72..100 for the boat. The
 * field is now inset by what those two MEASURE, so those lanes are already
 * gone and reserving them twice would squeeze every island into the middle
 * three-fifths of the screen. This stretches the authored band across the
 * water instead, keeping 10% at the top and 15% at the bottom — an island is
 * placed by its centre and its name hangs underneath it, so the bottom margin
 * is the larger of the two.
 */
const BAND_TOP = 13;
const BAND_BOTTOM = 72;

/**
 * Where the archipelago starts, as a percentage of the field.
 *
 * It was 10%, which was right while the sea was a rectangle of one colour: any
 * height was water. The ocean picture has a HORIZON in it, and an island above
 * the horizon is an island in the sky.
 *
 * `Sea.HORIZON_PCT` is the fraction of the VIEWPORT the sky takes; this band is
 * a fraction of the FIELD, which starts below the header and ends above the
 * boat. So the conversion is not a constant, and rather than thread the
 * measured lanes through here the margin is simply generous: the sky is 24% of
 * the viewport, the field starts around 11% of it, and 30% of the remaining
 * ~79% puts the topmost island's centre near 35% — comfortably below the water
 * line, with room for the half of the glyph that sits above its own centre.
 *
 * The bottom moved with it. 88% rather than 85%, so losing 20 points at the top
 * costs the scene 17 rather than 20 — the archipelago is tighter than it was
 * and it is on the water, which is the trade.
 */
const BAND_START = 30;
const BAND_SPAN = 58;

const bandY = (y: number): number =>
  Math.round(
    (BAND_START + ((y - BAND_TOP) / (BAND_BOTTOM - BAND_TOP)) * BAND_SPAN) * 10,
  ) / 10;

function SeaIsland({
  island,
  depth,
  base,
  current,
  onOpen,
}: {
  island: IslandSummary;
  depth: number;
  /** The near-island size for THIS archipelago — see `baseSizeFor`. */
  base: number;
  current: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="nv-press nv-isle relative flex flex-col items-center"
      /* The whole island is the target and it is bigger than 44px at every
         depth on this scene, so no minimum is forced — forcing one would put an
         invisible rectangle over the water beside the small far islands.

         `nv-isle` is the pointer answer — a lift and a wake, both defined in
         globals.css and both switched off on touch, where `nv-press` already
         says the same thing with a scale. */
    >
      {/*
        The wake. Positioned against the button rather than inside the bobbing
        wrapper on purpose: foam sits on the WATER, and a wake that rode up and
        down with the island would read as a shadow glued to its hull.

        Sized off the island's own width so it stays in proportion at every
        depth, and CENTRED at 86% of the box rather than hung below it: the
        label starts at 100%, and the first version of this reached past the
        bottom edge and washed out the year under every hovered island.
      */}
      {(() => {
        const w = Math.round(base * depth);
        const wake = Math.round(w * 0.2);
        return (
          <span
            aria-hidden
            className="nv-isle-wake pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[50%]"
            style={{
              width: Math.round(w * 1.15),
              height: wake,
              top: Math.round(w * ISLAND_ASPECT * 0.86 - wake / 2),
            }}
          />
        );
      })()}
      {/*
        The bob lives on a WRAPPER, never on the glyph and never on the
        positioned parent: Framer owns the transform on the entrance, CSS owns
        it here, and an element with both loses whichever wrote it first.

        Phase and period are derived from the island itself. Ten islands on one
        4.5s cycle is a raft, and a raft is the one thing an archipelago must
        not look like. The far ones ride shallower for the same reason they are
        drawn smaller.
      */}
      <span
        className="nv-bob block"
        style={
          {
            "--nv-bob-rise": `${(2.5 * depth).toFixed(2)}px`,
            "--nv-bob-dur": `${(4.2 + (island.slot % 4) * 0.55).toFixed(2)}s`,
            "--nv-bob-delay": `${(island.slot % 5) * 320}ms`,
          } as CSSProperties
        }
      >
        <IslandGlyph
          alive={island.alive}
          seed={island.seed}
          size={Math.round(base * depth)}
        />
      </span>
      <Label
        title={island.companyName}
        muted={!island.alive}
        sub={
          island.alive
            ? current
              ? "OPEN NOW"
              : `YEAR ${island.year}`
            : "ENDED"
        }
        /* The one spot of colour on the whole scene, and it marks exactly one
           thing: where you left off. A bar under the island read as a
           highlighter pen; a dot beside the word it qualifies reads as a
           status light, which is what it is. */
        dot={current && island.alive}
      />
    </button>
  );
}

function SeaEmpty({
  slot,
  depth,
  base,
  busy,
  onFound,
}: {
  slot: number;
  depth: number;
  base: number;
  busy: boolean;
  onFound: () => void;
}) {
  const size = Math.round(base * depth);
  return (
    <button
      type="button"
      onClick={onFound}
      disabled={busy}
      /* The same pointer answer as a real island. An empty place that stayed
         dead under the cursor while its neighbours lifted would read as the one
         thing on the scene you cannot press, which is the opposite of true. */
      className="nv-press nv-isle relative flex flex-col items-center disabled:opacity-60"
    >
      {/* The same footprint an island would take, so founding one does not
          shuffle the scene — the shape changes, the composition does not. */}
      <span
        aria-hidden
        className="flex items-end justify-center pb-[10%]"
        style={{ width: size, height: size * ISLAND_ASPECT }}
      >
        <span
          className="flex items-center justify-center rounded-[var(--radius-pill)] border border-dashed border-[var(--n-6)] leading-none text-[var(--text-tertiary)]"
          style={{
            width: size * 0.36,
            height: size * 0.36,
            fontSize: size * 0.18,
          }}
        >
          +
        </span>
      </span>
      <Label title="Found one" sub={`ISLAND ${slot + 1}`} />
    </button>
  );
}

function SeaLocked({
  depth,
  base,
  onAsk,
}: {
  depth: number;
  base: number;
  onAsk: () => void;
}) {
  const size = Math.round(base * depth);
  return (
    <button
      type="button"
      onClick={onAsk}
      className="nv-press nv-isle relative flex flex-col items-center opacity-70"
    >
      <span
        aria-hidden
        className="flex items-end justify-center pb-[10%]"
        style={{ width: size, height: size * ISLAND_ASPECT }}
      >
        <span
          className="flex items-center justify-center rounded-[var(--radius-pill)] border border-[var(--n-6)] text-[var(--text-tertiary)]"
          style={{ width: size * 0.36, height: size * 0.36 }}
        >
          <LockGlyph />
        </span>
      </span>
      {/* PRO_LIMITS, not ISLAND_CAP. This is the locked place a FREE player
          taps to hear what Pro adds, so it has to name Pro's own allowance —
          the two were the same number until 0015, and printing the ceiling
          here would now promise a subscription fifty islands it does not
          include. */}
      <Label title="Another island" sub={`PRO RUNS ${PRO_LIMITS.islands}`} />
    </button>
  );
}

// ── The gallery ──────────────────────────────────────────────────────────────

function Gallery({
  island,
  dir,
  index,
  total,
  busy,
  native,
  onStep,
  onBack,
  onEnter,
}: {
  island: IslandSummary;
  dir: number;
  index: number;
  total: number;
  busy: boolean;
  /**
   * UIKit is drawing this screen's controls, so React must not draw them too.
   *
   * Not rendered rather than hidden, which is the rule every native-chrome
   * caller in this app follows: a hidden button still takes a tap on iOS if
   * the native view above it lets the touch through, and the player gets a
   * dead zone nobody can see.
   */
  native: boolean;
  onStep: (by: number) => void;
  onBack: () => void;
  onEnter: () => void;
}) {
  const ending = island.alive
    ? null
    : (ENDING[island.endedBy ?? "chapter7"] ?? ENDING.chapter7);
  const many = total > 1;

  return (
    /*
     * Same water as the map — the sea behind this is the page's, not the
     * gallery's, so moving between the two views never swaps the ocean out.
     * A column here rather than edge to edge because this view is reading
     * matter: a books panel the width of a desktop is a spreadsheet.
     */
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SWAP}
      /* The pads clear whatever chrome is actually there: the safe area plus a
         gap on the web, and the measured height of the UIKit toolbar and dock
         where UIKit drew them. `--nv-overlay-*` is 0 everywhere else. */
      className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pt-[max(1.5rem,var(--nv-safe-top),calc(var(--nv-overlay-top)+0.75rem))] pb-[max(1.5rem,var(--nv-safe-bottom),calc(var(--nv-overlay-bottom)+0.75rem))]"
    >
      {/* UIKit carries this in the leading cluster when it owns the screen. */}
      {native ? null : (
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex min-h-11 items-center gap-1.5 self-start text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)]"
        >
          <span aria-hidden>◂</span> ALL ISLANDS
        </button>
      )}

      {/* ── The island, arrows either side ──────────────────────────────── */}
      {/* Except on iOS, where ‹ › are a merged pair of glass circles in the
          toolbar and the island gets the whole width to be drawn in. */}
      <div
        className={`relative h-56 w-full sm:h-64 ${native ? "mt-0" : "mt-1"}`}
      >
        <div className="absolute inset-0 flex items-center justify-between gap-1">
          {native ? null : many ? (
            <Arrow dir={-1} onClick={() => onStep(-1)} />
          ) : (
            <span className="w-11" />
          )}

          {/*
            No `mode="wait"`: the island is the thing being looked at, and
            blanking it for the length of an exit before the next one arrives
            reads as a reload. They cross past each other, which is what a
            gallery does.
          */}
          <div className="relative h-full flex-1 overflow-hidden">
            <AnimatePresence initial={false}>
              {/*
                It drifts in rather than cutting across. A spring rather than a
                duration because an island arriving on water should overshoot a
                little and settle, and `x` alone reads as a slide — the small
                `y` is what turns it into something floating.
              */}
              <motion.div
                key={island.slot}
                initial={{ opacity: 0, x: dir * 110, y: 10 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, x: dir * -110, y: 10 }}
                transition={SETTLE_SPRING}
                className="absolute inset-0 flex items-center justify-center"
              >
                <span
                  className="nv-bob block"
                  style={
                    {
                      "--nv-bob-rise": "5px",
                      "--nv-bob-dur": "5s",
                    } as CSSProperties
                  }
                >
                  <IslandGlyph
                              alive={island.alive}
                    seed={island.seed}
                    size={236}
                  />
                </span>
              </motion.div>
            </AnimatePresence>
          </div>

          {native ? null : many ? (
            <Arrow dir={1} onClick={() => onStep(1)} />
          ) : (
            <span className="w-11" />
          )}
        </div>
      </div>

      {/* Which of them this is. Dots rather than "3 of 5": at ten islands the
          count is the same size as the words, and dots also say WHERE. */}
      {many && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-[var(--radius-pill)] ${
                i === index
                  ? "w-4 bg-[var(--text-primary)]"
                  : "w-1.5 bg-[var(--n-6)]"
              }`}
            />
          ))}
        </div>
      )}

      <div className="mt-5 text-center">
        <p
          className="text-2xs font-bold tracking-[0.14em]"
          style={{ color: ending ? ending.tone : "var(--text-tertiary)" }}
        >
          {ending ? ending.label : "RUNNING"}
        </p>
        <h1 className="mt-1 truncate text-[1.625rem] font-extrabold leading-tight tracking-[-0.02em]">
          {island.companyName}
        </h1>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          {industryName(island.industry)} ·{" "}
          {STAGE_NAME[clampStage(island.stage)]} ·{" "}
          {island.alive
            ? `Year ${island.year}, ${MONTHS[clampMonth(island.month) - 1]}`
            : `${island.year} ${island.year === 1 ? "year" : "years"} survived`}
        </p>
      </div>

      {/*
        The books. Content, so an opaque shadowed panel and never glass, and
        every figure at full ink — design.md's "money is read at full strength"
        is a legibility floor rather than a taste setting.
        
        Deliberately NOT a boat. The small print on the map is one line and can
        afford to be scenery; this is six figures a player is reading, and a
        curved hull under a number column would cost legibility to make a joke.
        It floats by sitting HIGHER instead: `--e3` rather than `--e1`, which
        is the shadow the app gives a sheet, so the panel reads as an object
        resting above the water rather than a section painted onto it. Still,
        while the island above it bobs — a table of numbers that moves is a
        table you read twice.
      */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 rounded-[var(--radius-sheet)] bg-[var(--surface)] p-5 shadow-[var(--e3)]">
        <Figure
          label={island.alive ? "VALUATION" : "PEAK VALUATION"}
          value={fmtMoney(
            island.alive ? island.valuation : island.peakValuation,
          )}
          strong
        />
        <Figure
          label={island.alive ? "PEAK" : "AT THE END"}
          value={fmtMoney(
            island.alive ? island.peakValuation : island.valuation,
          )}
          strong
        />
        <Figure label="CASH" value={fmtMoney(island.cash)} />
        <Figure label="REVENUE / YEAR" value={fmtMoney(island.revenueAnnual)} />
        <Figure label="TEAM" value={`${island.employees}`} />
        <Figure label="LAST PLAYED" value={lastPlayed(island.savedAt) || "—"} />
      </dl>

      {/* The screen's one ask. UIKit floats it in the glass dock where it owns
          the chrome; everywhere else it is the last thing in the column. */}
      {/*
        The material component rather than a hand-written class string.

        `nv-gc nv-t-action` resolves to the same tokens, but only the tokens —
        `GlassButton` is what carries the rest of the lens: the press that
        deforms and brightens rather than only scaling, the specular edge, and
        the `solid` fallback the `@supports` block needs where no browser can
        blur. A control that has to read as Liquid Glass has to go through the
        thing that draws Liquid Glass, or it is an impression of one, which is
        the exact comparison design.md §0 says an approximation cannot win.

        `h-14` over the preset's `h-12`: this is the screen's one ask and it
        sat at py-4 before, and shrinking a CTA is not what "make it glass"
        asked for.
      */}
      {native ? null : (
        <div className="mt-auto w-full pt-6">
          <GlassButton
            tone="action"
            onClick={onEnter}
            disabled={busy}
            className="h-14 truncate text-base font-extrabold tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy
              ? "OPENING…"
              : island.alive
                ? "CONTINUE ▸"
                : "READ THE BOOKS ▸"}
          </GlassButton>
        </div>
      )}
    </motion.div>
  );
}

function Arrow({ dir, onClick }: { dir: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir < 0 ? "Previous island" : "Next island"}
      /* A control, so it IS the material — design.md's controls row. 44px,
         which is the tap target the rest of the app holds to. */
      className="nv-gc nv-press z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-lg font-bold text-[var(--text-primary)]"
    >
      <span aria-hidden className="-mt-0.5">
        {dir < 0 ? "‹" : "›"}
      </span>
    </button>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.5625rem] font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
        {label}
      </dt>
      <dd
        className={`tnum truncate text-[var(--text-primary)] ${
          strong ? "text-[1.0625rem] font-extrabold" : "text-sm font-bold"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="3.25"
        y="7"
        width="9.5"
        height="6.75"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

const industryName = (code: IslandSummary["industry"]): string =>
  INDUSTRIES.find((i) => i.code === code)?.name ?? code;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** What ended it, in the words the rest of the app uses for each. */
const ENDING: Record<string, { label: string; tone: string }> = {
  chapter7: { label: "CHAPTER SEVEN", tone: "var(--color-alert)" },
  acquired: { label: "ACQUIRED", tone: "var(--color-prestige)" },
  ipo: { label: "WENT PUBLIC", tone: "var(--color-prestige)" },
};

const clampStage = (n: number): StageNum =>
  Math.min(5, Math.max(1, Math.trunc(n) || 1)) as StageNum;

const clampMonth = (n: number): number =>
  Math.min(12, Math.max(1, Math.trunc(n) || 1));

/**
 * "Last played", from the device clock.
 *
 * Deliberately coarse. `savedAt` comes from the run's own `lastPlayedISO`
 * where it has one — whatever the machine that wrote it thought the day was,
 * and two devices disagree — so this says "yesterday" rather than a timestamp
 * anybody could hold it to. It is never used to decide which copy of a company
 * wins; that is what the per-island rule in lib/cloud/sync.ts is for.
 */
function lastPlayed(savedAt: number): string {
  if (!Number.isFinite(savedAt) || savedAt <= 0) return "";
  const days = Math.floor((Date.now() - savedAt) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return "A while ago";
}
