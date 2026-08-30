"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useState,
  useMemo,
} from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useGame } from "@/lib/state/GameProvider";
import { HomeStage } from "@/components/HomeStage";
import { PlaySkeleton } from "@/components/PlaySkeleton";
import { TheBooks } from "@/components/TheBooks";
import { LifeLog } from "@/components/LifeLog";
import { LogButton, LogSheet } from "@/components/screens/LogSheet";
import { AdvanceButton } from "@/components/AdvanceButton";
import { STANCE_CHOICE_ORDER } from "@/lib/engine/positioning";
import { ActivityBar, type ActivityTab } from "@/components/ActivityBar";
import { TermCoach } from "@/components/TermCoach";
import { ImpactProvider, useImpact } from "@/components/ImpactLayer";
import type { PhoneApp } from "@/components/phone/Phone";
import { deriveRunwayMonths } from "@/lib/engine/sim";
import { fmtMonths } from "@/lib/engine/format";
import {
  usePlayChrome,
  type NativeControlId,
} from "@/components/native/usePlayChrome";
import { useNativeSheet } from "@/components/native/useNativeSheet";
import { useNativeTermCoach } from "@/components/native/useNativeTermCoach";
import { useBackHandler } from "@/lib/native/back";
import { WorkspaceSlot } from "@/components/screens/Workspace";
import { useNativeCoachRect } from "@/lib/native/chrome";
import { consumeOutsideOpen, subscribeOutsideOpen } from "@/lib/outside/links";
import { Coachmarks, firstRunSteps } from "@/components/Coachmarks";
import { NextStep, useNudge } from "@/components/NextStep";
import { useWarm, warm, type Preloadable } from "@/lib/warm";
import { UPGRADE_WARM } from "@/components/upgrade/UpgradeProvider";
import { appPath } from "@/lib/native/href";
import { storefront } from "@/lib/commerce";

/*
 * ── Everything below renders behind a flag, so none of it belongs in the
 *    chunk that draws month one ──────────────────────────────────────────────
 *
 * This file had 41 static imports and zero dynamic ones, which put every
 * screen the game can reach into `/play`'s first load: the pitch and its whole
 * Tank chain, five activity screens, the in-game phone and its three apps, the
 * settings sheet, the leaderboard, the year-end statement, Chapter 7. A player
 * on month one had downloaded all of it, and a player who never survives to
 * year one downloads it and never opens it.
 *
 * `PerformScreen` is the big one. The early return further down is a clean cut
 * point, and behind it sits SharkStage, SharkCanvas, PitchScore, SharkPanel,
 * PitchNotes, CompanyDossier and TankDebrief — plus three.js, which was
 * already lazy but was being anchored into this chunk by the import chain
 * above it.
 *
 * `ssr: false` throughout: none of these can render on the server anyway (the
 * page is a client component reading a localStorage run), and every one is
 * closed on first paint.
 *
 * `loading: () => null` is right for the overlays — they animate in over the
 * board, and a spinner between the tap and the sheet is worse than the sheet
 * arriving. `PerformScreen` gets a real holding screen instead, because it
 * REPLACES the board rather than covering it, and batch B's rule applies: the
 * year gate must never open onto nothing.
 */
/*
 * ── Why the overlays are `warm()` and the pitch is still `dynamic()` ────────
 *
 * Both split the same way — `import()` is what makes webpack emit a chunk, and
 * it is still the loader in both. What differs is what happens between the tap
 * and the first frame.
 *
 * `dynamic(…, { loading: () => null })` is `React.lazy` in a `Suspense`. The
 * first render of one commits a fallback, and React then throttles replacing a
 * committed fallback by ~300ms so that a boundary resolving a few frames later
 * does not flash. Measured on the built export, tap to the sheet existing in
 * the DOM: 315ms unthrottled, 343ms at CPU ×6 — a cost that does not move with
 * the CPU, because it is a timer rather than work. That was most of "the tabs
 * stutter, then the screen comes out". `warm()` renders null until its module
 * is in hand and the screen immediately after, which is the same visible
 * contract without a boundary to throttle. See lib/warm.tsx.
 *
 * `PerformScreen` keeps `dynamic()`, because the thing that makes the throttle
 * hurt is exactly what it does not do: it REPLACES the board rather than
 * covering it, so it wants a real holding screen rather than `null` — batch B's
 * rule that the year gate must never open onto nothing — and against a screen
 * that takes a second to assemble, 300ms is not what anybody notices.
 *
 * The options object is written out at that one call site rather than shared:
 * next/dynamic is compiled by a SWC transform that reads its second argument
 * statically and rejects anything that is not an object literal.
 */

/*
 * The beta tank autopilot, which almost nobody loads.
 *
 * Behind `dynamic` AND behind the URL flag, so a normal session never fetches
 * the chunk — /play is the heaviest route in the app and has a first-load
 * budget to match.
 */
const BetaAutopilot = dynamic(() => import("@/components/rewards/BetaAutopilot"), {
  ssr: false,
});

const loadPerformScreen = () => import("@/components/PerformScreen");
const PerformScreen = dynamic(
  () => loadPerformScreen().then((m) => m.PerformScreen),
  {
    ssr: false,
    loading: () => (
      <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-[var(--bg)] px-6">
        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
          THE YEAR CLOSES
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          Setting up the room…
        </p>
      </main>
    ),
  },
);

const CompanyScreen = warm(() =>
  import("@/components/screens/CompanyScreen").then((m) => m.CompanyScreen),
);
const ProductScreen = warm(() =>
  import("@/components/screens/ProductScreen").then((m) => m.ProductScreen),
);
const TeamScreen = warm(() =>
  import("@/components/screens/TeamScreen").then((m) => m.TeamScreen),
);
const AssetsScreen = warm(() =>
  import("@/components/screens/AssetsScreen").then((m) => m.AssetsScreen),
);
const ClosetScreen = warm(() =>
  import("@/components/screens/ClosetScreen").then((m) => m.ClosetScreen),
);
const SettingsScreen = warm(() =>
  import("@/components/screens/SettingsScreen").then((m) => m.SettingsScreen),
);
const StillStandingScreen = warm(() =>
  import("@/components/screens/StillStandingScreen").then(
    (m) => m.StillStandingScreen,
  ),
);
const StageGuide = warm(() =>
  import("@/components/StageGuide").then((m) => m.StageGuide),
);
const KeyTermsSheet = warm(() =>
  import("@/components/KeyTermsSheet").then((m) => m.KeyTermsSheet),
);
const ProSheet = warm(() =>
  import("@/components/ProSheet").then((m) => m.ProSheet),
);
const ChapterSeven = warm(() =>
  import("@/components/ChapterSeven").then((m) => m.ChapterSeven),
);
const YearEndStatement = warm(() =>
  import("@/components/YearEndStatement").then((m) => m.YearEndStatement),
);
const TierUnlock = warm(() =>
  import("@/components/TierUnlock").then((m) => m.TierUnlock),
);
const Phone = warm(() =>
  import("@/components/phone/Phone").then((m) => m.Phone),
);
const RobinGhood = warm(() =>
  import("@/components/phone/RobinGhood").then((m) => m.RobinGhood),
);
const LinkedOut = warm(() =>
  import("@/components/phone/LinkedOut").then((m) => m.LinkedOut),
);
const PositioningSheet = warm(() =>
  import("@/components/PositioningSheet").then((m) => m.PositioningSheet),
);
/*
 * The height of the fade that sits ON TOP of the flow, immediately above the
 * fixed dock — `h-9` on the gradient below, kept here as a number because the
 * spacer at the end of the flow has to out-measure it.
 *
 * The gradient is drawn outside the dock's own box (`bottom-full`), so it is
 * not part of the measured footer height and it dims whatever the last 36px of
 * the document happens to be. Scrolled to the very end, the final element of
 * the flow sat under a page-coloured wash with nothing below it to justify the
 * wash — which reads as content cut in half rather than content passing under
 * a dock. The nudge card that made this visible has since floated out of the
 * document entirely; the log row it leaves behind is the last element now, and
 * it was being washed the same way for the same reason.
 */
const DOCK_FADE = 36;

/**
 * The air after the obstruction — under the flow's last row, and under the
 * floating nudge, which uses this as its own gap above the dock.
 *
 * Clearing an edge by exactly zero is correct arithmetic and still reads as
 * jammed against it. One number for both so the two never drift apart on
 * screen, where they are 12px from the same dock.
 */
const FLOW_TAIL = 12;

const DecisionSheet = warm(() =>
  import("@/components/DecisionSheet").then((m) => m.DecisionSheet),
);

/**
 * The order this screen's overlays are fetched and parsed in, before anything
 * asks for them.
 *
 * Each `warm()` component carries its own `preload`, so this list cannot name
 * a chunk that is not the one the component renders — the loader is written
 * once, above, and both the render and the warm go through it. A warm list
 * holding its own copies of the import specifiers would be two sources of
 * truth about which chunk each screen is in, and getting that wrong fails
 * silently: a warm that faithfully preloads the wrong module.
 *
 * Ordered by when a run actually reaches them, because the queue is walked one
 * per idle callback and the early entries are the ones that get there first on
 * a slow phone. `PerformScreen` is absent because it has its own warm below,
 * held until `atGate` makes it the next thing that can happen.
 */
const WARM: Preloadable[] = [
  // The tab bar's six, in the order the bar draws them. These are the ones the
  // report was about — a player opens them dozens of times in a run.
  CompanyScreen.preload,
  TeamScreen.preload,
  ProductScreen.preload,
  AssetsScreen.preload,
  StillStandingScreen.preload,
  ClosetScreen.preload,
  // The phone, and the two apps inside it. The apps are reached from the
  // phone's own home screen, so they are a second tap rather than a first.
  Phone.preload,
  RobinGhood.preload,
  LinkedOut.preload,
  // The month's decision. Not opened by a tap at all — it arrives on ADVANCE,
  // which makes it the one overlay whose wait lands in the middle of an action
  // the player has already committed to.
  DecisionSheet.preload,
  PositioningSheet.preload,
  // Everything that needs a reason to open.
  KeyTermsSheet.preload,
  StageGuide.preload,
  SettingsScreen.preload,
  ProSheet.preload,
  YearEndStatement.preload,
  TierUnlock.preload,
  ChapterSeven.preload,
  // The refusal surfaces, warmed from here rather than from the provider that
  // owns them — it is mounted by the root layout, and warming there would put
  // these back into /privacy and /terms. This screen has gates; those do not.
  ...UPGRADE_WARM,
];

export default function PlayPage() {
  return (
    <ImpactProvider>
      <PlayScreen />
    </ImpactProvider>
  );
}

function PlayScreen() {
  const router = useRouter();
  const game = useGame();
  const {
    run,
    profile,
    current,
    currentIsMarket,
    atGate,
    yearEnd,
    autopsy,
    perform,
    lastDeltas,
  } = game;
  const impact = useImpact();

  const [activity, setActivity] = useState<ActivityTab | null>(null);

  /**
   * OPENING A TAB IS A TRANSITION, and that is worth ~300ms of the tap.
   *
   * Reported as: the six tabs stutter in the app, then the screen comes out.
   * The chunk was one cause and is warmed above. This is the other, and it was
   * the larger one — measured on the built export, tap to the sheet existing in
   * the DOM:
   *
   *     unthrottled  307ms      CPU ×4  335ms      CPU ×6  343ms
   *
   * A cost that does not move when the CPU gets six times slower is not work,
   * it is a timer. A CPU profile over the same window agreed: no JS ran in it.
   *
   * The timer is React's. Every screen here is `dynamic(…, { loading: () =>
   * null })`, so the first render of one suspends and commits a fallback —
   * `null`, but a fallback. React then THROTTLES replacing a fallback with the
   * real content, deliberately, so that a boundary which resolves a few frames
   * later does not flash. That throttle is about 300ms, and it is charged in
   * full even when the module was already in memory, because the fallback was
   * still committed.
   *
   * A transition never shows the fallback. React keeps the current screen up,
   * resolves the lazy component off to the side, and commits when it is ready —
   * so with the module already warm, "when it is ready" is the next frame.
   *
   * Nothing is lost on the path where the module ISN'T warm: `loading` renders
   * null, so a fallback and no fallback look identical, and the difference is
   * that the play screen behind stays interactive instead of being a blank.
   *
   * Closing is not routed through this. An unmount cannot suspend, so there is
   * nothing to gain, and a transition on the way out would let React defer the
   * dismissal behind whatever else it had queued.
   */
  const openActivity = useCallback((tab: ActivityTab) => {
    startTransition(() => setActivity(tab));
  }, []);
  // The centre column's working area, handed to the activity screens so they
  // can render into it instead of over the page. A state node rather than a
  // ref: the portal has to re-render once the div exists, and a ref does not
  // tell React that it now does.
  const [workspaceEl, setWorkspaceEl] = useState<HTMLDivElement | null>(null);

  /**
   * "home" means "the phone is open with no destination" — it unlocks to the
   * home screen. A concrete app id here is a deep link from a notification or a
   * hire flow, and it is honoured after the unlock rather than instead of it.
   */
  const [phoneApp, setPhoneApp] = useState<PhoneApp | "home" | null>(null);
  /*
   * `?beta=tank` — the beta panel's shortcut to the year-end pitch.
   *
   * Read in an effect rather than from `useSearchParams`, which would opt this
   * route into a Suspense boundary for a flag almost nobody sets. False on the
   * server render, so the autopilot's chunk is never in the initial payload.
   */
  const [autopilot, setAutopilot] = useState(false);
  useEffect(() => {
    setAutopilot(new URLSearchParams(window.location.search).get("beta") === "tank");
  }, []);

  const [showPro, setShowPro] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [dossier, setDossier] = useState(false);
  const [stageGuide, setStageGuide] = useState(false);
  /** The book page: every key term, searchable, with the Rookie switch on it. */
  const [keyTerms, setKeyTerms] = useState(false);
  /** The phone's log sheet. Desktop keeps the log inline and never sets this. */
  const [logOpen, setLogOpen] = useState(false);
  const [term, setTerm] = useState<{ term: string; detail?: string } | null>(
    null,
  );

  /*
   * ── Why the bar is fixed and not sticky ───────────────────────────────────
   *
   * It was `sticky bottom-0` inside the right rail, and a sticky element can
   * never leave its containing block. The rail starts below the masthead — 386
   * points down on a 320×568 screen — so the best sticky could do was pin the
   * bar to the rail's own top edge, which on a short phone left the ADVANCE
   * MONTH button 151 points below the fold on first paint. The one control
   * that moves time was off screen until you scrolled.
   *
   * Fixed to the viewport instead, with a spacer of exactly its measured
   * height left behind in the flow so the last line of the log still ends
   * above it. Measured rather than assumed, because the bar changes height:
   * two rows of tabs under 360px, and again whenever the term coach appears.
   *
   * Desktop is untouched — `lg:static` puts it back as the last item of a
   * column that is already viewport-height, where it was never the problem.
   */
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);

  useEffect(() => {
    if (!footerEl) {
      setFooterHeight(0);
      return;
    }
    const sync = () => setFooterHeight(footerEl.offsetHeight);
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(footerEl);
    return () => observer.disconnect();
  }, [footerEl]);
  /*
   * The `cold-call` activity cannot open the phone itself — activities are pure
   * engine functions and know nothing about React. It sets a flag; this watches
   * for the flag, opens the phone, and clears it.
   *
   * On The INDEX rather than The Room. A call now starts by finding out who to
   * call: the dialler opens on an empty field, and landing there first would be
   * handing somebody a keypad and no number. The Index has a door through to
   * the keypad on it, which is the order the mechanic is meant to be learned
   * in.
   */
  useEffect(() => {
    if (!game.run?.flags.open_the_room) return;
    game.clearFlag("open_the_room");
    setActivity(null);
    setPhoneApp("index");
  }, [game]);

  const [checked, setChecked] = useState(false);
  const [coachIndex, setCoachIndex] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setChecked(true), 60);
    return () => clearTimeout(t);
  }, []);

  /*
   * Nothing to play. Where that sends the player is not "the founding form".
   *
   * The islands the device holds are the first question, exactly as
   * `entryRoute()` asks it (lib/entry.ts). A player can arrive here with no run
   * and companies in storage — a pointer left behind by a buried island, a
   * bookmark, a slot that has not finished restoring — and sending them to
   * /found in that state offers a NEW company as the only way out of a screen
   * their existing ones are one tap from. That is how a founding lands on top
   * of something: the form is reached by accident, and founding is what it does.
   *
   * `game.islands` rather than a fresh read: it is the same list the picker
   * draws and it is refreshed on every change, including a cloud restore that
   * lands after this screen mounted.
   */
  useEffect(() => {
    if (!checked || run) return;
    if (game.islands.length > 0) {
      router.replace("/islands");
      return;
    }
    router.replace(profile?.onboarded ? "/found" : "/welcome");
  }, [checked, run, game.islands, profile, router]);

  // Every resolution floats its consequences, so a choice is never silent.
  useEffect(() => {
    if (lastDeltas.length > 0) impact.push(lastDeltas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDeltas]);

  // Term-on-first-use: runway is the word the game teaches by watching it fall.
  useEffect(() => {
    if (!run || !run.rookieMode) return;
    if (run.seenTerms.includes("runway")) return;
    const months = deriveRunwayMonths(run);
    if (months < 24 && run.month >= 2) {
      setTerm({
        term: "runway",
        detail: `Runway is how many months your cash lasts at this burn. Yours is ${fmtMonths(months).replace("mo", "")}.`,
      });
      game.markTermSeen("runway");
    }
  }, [run, game]);

  const finishCoaching = useCallback(() => game.advanceTutorial(0), [game]);

  /*
   * ── The chrome handoff ────────────────────────────────────────────────────
   *
   * On iOS the tab bar, the advance button and the masthead controls are real
   * UIKit Liquid Glass views. Three facts drive everything below.
   *
   * A native view always composites above the webview. So the moment anything
   * is drawn over the play screen — a card, a screen, the phone, the year-end
   * statement — every piece of native chrome has to go, or it sits on top of
   * that thing. `overlay` is that single question, asked once.
   *
   * The guided first play does NOT withdraw the chrome, and used to. It dims
   * the screen and cuts a hole around a DOM element, which cannot work on a
   * UIKit view — native composites above the webview, so a web scrim cannot
   * dim it and a web hole cannot expose it. The old answer was to hand the
   * chrome back to the DOM for the duration, and the cost was one nobody sees
   * by reading it: the guided run is a new player's entire first session, so
   * the app's first impression contained no Liquid Glass at all.
   *
   * The chrome now dims itself instead, lights the one surface being taught,
   * and reports where that surface is so the coachmark card can sit beside it.
   * `coachTarget` is the whole of the web side's half.
   *
   * And the space the native chrome occupies is never guessed. UIKit measures
   * itself after layout and reports back; the numbers arrive as
   * --nv-chrome-top / --nv-chrome-bottom and the layout reserves exactly them.
   */
  const coaching =
    !!run &&
    run.tutorial &&
    run.tutorialStep > 0 &&
    !current &&
    !yearEnd &&
    !activity &&
    !phoneApp &&
    !showPro &&
    !showSettings &&
    !showBoard &&
    !dossier &&
    !stageGuide &&
    !keyTerms &&
    !logOpen &&
    run.alive;

  const overlay =
    !!current ||
    !!activity ||
    !!phoneApp ||
    showPro ||
    showSettings ||
    showBoard ||
    dossier ||
    stageGuide ||
    keyTerms ||
    logOpen ||
    !!yearEnd ||
    !!autopsy ||
    !!game.tierUnlock ||
    !!perform;

  /**
   * Which native surface the current tutorial step is teaching.
   *
   * null when the tutorial is not running; "" when the step teaches something
   * the web layer drew, which still dims the chrome but lights nothing. The
   * step declares its own native surface, so this file never carries a second
   * copy of the mapping.
   */
  /**
   * The script this player is being taught.
   *
   * Computed ONCE and read by everything below. The native-chrome mapping and
   * the end-of-script check index into it, so a second call to firstRunSteps()
   * would be a different array the moment Rookie Mode adds its step — lighting
   * the wrong control, or ending the tutorial a step early.
   */
  const coachSteps = useMemo(
    () => firstRunSteps(!!run?.rookieMode),
    [run?.rookieMode],
  );

  const coachTarget = coaching ? (coachSteps[coachIndex]?.native ?? "") : null;

  /**
   * A native control that is being taught completes its step when it fires.
   *
   * The tap lands on a UIKit view, so the coachmark overlay never sees it —
   * there is no click for it to catch and no element for it to activate. The
   * control's own callback is the only signal that the player did the thing,
   * which makes it the thing that advances the script.
   */
  const completeCoachStep = useCallback(
    (surface: string) => {
      if (!coaching || coachTarget !== surface) return;
      if (coachIndex >= coachSteps.length - 1) finishCoaching();
      else setCoachIndex((i) => i + 1);
    },
    [coaching, coachTarget, coachIndex, coachSteps.length, finishCoaching],
  );

  const onNativeControl = useCallback(
    (id: NativeControlId) => {
      completeCoachStep(id);
      if (id === "pro") setShowPro(true);
      else if (id === "dossier") setDossier(true);
      else if (id === "settings") setShowSettings(true);
      else if (id === "board") setShowBoard(true);
      else if (id === "phone") setPhoneApp("home");
      else if (id === "keyterms") setKeyTerms(true);
    },
    [completeCoachStep],
  );

  const onNativeTab = useCallback(
    (tab: ActivityTab) => {
      completeCoachStep("tabs");
      openActivity(tab);
    },
    [completeCoachStep],
  );

  const onNativeAdvance = useCallback(() => {
    completeCoachStep("advance");
    game.advance();
  }, [completeCoachStep, game]);

  /*
   * Warm the pitch chunk the moment the year gate is reachable.
   *
   * Splitting PerformScreen out is only free if the code is already there when
   * the player presses CLOSE THE YEAR — otherwise the split has moved the wait
   * to the worst possible moment in the game. `atGate` goes true at month 12,
   * which is a whole screen's worth of reading before the tap.
   *
   * ── This called `preload()` and preloaded nothing ──────────────────────────
   *
   * It used to read `(PerformScreen as { preload?: () => void }).preload?.()`.
   * `preload()` is a react-loadable method from the PAGES router; App Router
   * `next/dynamic` is a wrapper over `React.lazy` and puts no such method on
   * what it returns, so the `?.` was guarding a property that has never
   * existed. The warm compiled, ran on schedule, and did nothing, for as long
   * as this comment has claimed otherwise — found by measuring the chunk still
   * being fetched after the tap it was supposed to have preloaded.
   *
   * Calling the loader is what fetches and evaluates the module; webpack caches
   * the chunk promise, so `dynamic`'s own loader then resolves from cache.
   *
   * Idle rather than immediate, and a timeout underneath it, for the same
   * reason lib/prefetch.ts is written that way: the screen the player is
   * actually looking at gets the main thread first, and a slow phone that
   * never goes idle must still end up with the chunk.
   */
  useEffect(() => {
    if (!atGate) return;
    const warm = () => void loadPerformScreen();
    const idle = window.requestIdleCallback;
    if (idle) {
      const id = idle(warm, { timeout: 1500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 400);
    return () => window.clearTimeout(id);
  }, [atGate]);

  /*
   * Every other overlay on this screen, warmed the same way — see WARM below
   * for the queue and lib/warm.tsx for why it is walked one entry at a time.
   * Gated on the run having loaded, so it never competes with the mount that
   * puts this screen on screen in the first place.
   */
  useWarm(WARM, !!run);

  /*
   * The one thing worth doing, and who is drawing it.
   *
   * Held here rather than inside the card because there are two cards: this
   * screen's DOM one, and a UIKit panel above the native deck. Both read this
   * hook, so a nudge dismissed in either is dismissed in both — which matters
   * on every path where the chrome hands back to the DOM mid-run (no plugin,
   * an OS older than 26, a native throw).
   */
  const { nudge, dismiss: dismissNudge } = useNudge(run);

  /** The same card, as the four strings UIKit needs. `tab` stays on this side:
   *  native answers with an id and the tab it opens is this screen's business. */
  const nativeNudge = useMemo(
    () =>
      nudge
        ? {
            id: nudge.id,
            title: nudge.title,
            body: nudge.body,
            action: nudge.action,
          }
        : null,
    [nudge],
  );

  const nativeChromeOwned = usePlayChrome({
    visible: !!run && !overlay,
    coach: coachTarget,
    month: run?.month ?? 1,
    year: run?.year ?? 1,
    atGate,
    canAdvance: !!run?.alive && !current,
    pro: !!run?.pro,
    activeTab: activity,
    nudge: nativeNudge,
    onTab: onNativeTab,
    onAdvance: onNativeAdvance,
    onOpenGate: game.openYearGate,
    onControl: onNativeControl,
    // The id comes back rather than the tab, so this is where it becomes one.
    onNudgeAction: () => {
      if (nudge) openActivity(nudge.tab);
    },
    onNudgeDismiss: dismissNudge,
  });

  /** True when React still renders the tab bar and the advance button. */
  const domChrome = !nativeChromeOwned;

  const nativeCoachRect = useNativeCoachRect();

  /*
   * The month's decision goes to UIKit as well.
   *
   * Not for the sheet — for the scrim behind it. design.md allows modal scrims
   * to be glass, and a `backdrop-filter` inside the webview can only blur other
   * web content, never the game the sheet is covering. Presented natively, the
   * board frosts over behind the card with the system's own material.
   *
   * The stance question keeps its DOM sheet. It is the one decision in the game
   * that is an identity rather than a tradeoff, and it is drawn as one.
   */
  const isStanceQuestion = !!current?.id.startsWith("E-POS-ASK");
  const currentChoices = current ? game.choicesFor(current) : [];

  const nativeSheetOwned = useNativeSheet({
    event: isStanceQuestion ? null : current,
    choices: currentChoices,
    industry: run?.industry ?? "FOOD",
    rookieMode: !!run?.rookieMode,
    isMarket: currentIsMarket,
    explain:
      !!run?.tutorial && run?.year === 1 && !run?.seenTerms.includes("choices"),
    onChoose: (i) => {
      if (run?.tutorial && !run.seenTerms.includes("choices"))
        game.markTermSeen("choices");
      game.choose(i);
    },
    onDismiss: game.dismissCard,
  });

  const domDecisionSheet = !nativeSheetOwned || isStanceQuestion;

  /* Term-on-first-use becomes a glass note floated from the top. The DOM
     version docks above the advance bar so it cannot cover the number it is
     quoting; the native one arrives from the opposite edge for the same
     reason, because that number now lives in a UIKit deck. */
  useNativeTermCoach(
    domChrome ? null : (term?.term ?? null),
    term?.detail,
    () => setTerm(null),
  );

  /*
   * Android's back button, and nothing else on this screen claims it. The
   * order is the order these things stack on screen, so back always peels the
   * top layer rather than the one that happens to be listed first.
   */
  /*
   * `novus://market` — a tap on the RobinGhood Live Activity.
   *
   * Two arrivals to cover, and they are genuinely different: the link may have
   * navigated the document to get here, in which case the intent was written
   * to session storage before the old page died and is read once on mount; or
   * the board was already on screen, in which case nothing navigated and the
   * subscription is the only signal there is. Reading consumes, so a remount
   * never re-opens a phone the player just put down.
   */
  useEffect(() => {
    const open = () => {
      if (consumeOutsideOpen() === "market") setPhoneApp("robinghood");
    };
    open();
    return subscribeOutsideOpen(open);
  }, []);

  useBackHandler(!!current, game.dismissCard);
  useBackHandler(!!activity, () => setActivity(null));
  useBackHandler(!!phoneApp, () => setPhoneApp(null));
  useBackHandler(showPro, () => setShowPro(false));
  useBackHandler(showSettings, () => setShowSettings(false));
  useBackHandler(showBoard, () => setShowBoard(false));
  useBackHandler(dossier, () => setDossier(false));
  useBackHandler(stageGuide, () => setStageGuide(false));
  useBackHandler(keyTerms, () => setKeyTerms(false));
  useBackHandler(logOpen, () => setLogOpen(false));

  if (!run) return <PlaySkeleton />;

  if (perform) return <PerformScreen />;

  const phoneNode = (app: PhoneApp | "home") => (
    <Phone
      /* One key for the phone regardless of which app it opens on: switching
         apps happens INSIDE the device, so a per-app key would tear the phone
         down and rebuild it every time the player tapped a different icon. */
      key="phone"
      open
      initialApp={app === "home" ? undefined : app}
      onClose={() => {
        setPhoneApp(null);
        setActivity(null);
      }}
      robinghood={
        <RobinGhood
          onBuy={game.buyStock}
          onSell={game.sellStock}
          onTransfer={game.transferToBrokerage}
        />
      }
      linkedout={<LinkedOut onHire={game.hire} />}
    />
  );

  return (
    /*
     * Two compositions, not one stretched.
     *
     * Under 1024px this is the phone: stage, Books, log, then a sticky footer.
     *
     * At 1024px and up it becomes a centred two-column desk. The mascot is
     * promoted to a persistent left column — it stops being a banner you
     * scroll past and becomes something present in the room. The Books dock to
     * the top of the right rail where the reading actually happens, and the
     * log takes the height it was always short of. Same components throughout;
     * only the composition changes.
     *
     * The previous behaviour was neither: it went full-bleed, so The Books
     * became a 1280px band of 8px labels and the CTA an ~800px slab.
     *
     * The phone is a SCROLLING document with a fixed footer, on purpose and
     * for the second time. A fixed-height no-scroll column was tried here and
     * reverted within a day: on real phones the leftover space after the
     * masthead squeezed The Books into a clipped strip — cash, burn, runway
     * and valuation are the four numbers the whole game runs on, and a layout
     * that crops them to avoid a scroll is the wrong trade. The masthead
     * shrink tiers in globals.css (which stayed) do the fitting instead, and
     * the measured spacer keeps the flow's end above the fixed bar.
     */
    /*
     * Desktop is a three-column workspace, not a stretched phone.
     *
     *   18rem  the company — masthead, abilities, and the activities as a LIST
     *   1fr    the working column — The Books, the month's decision, ADVANCE
     *   21rem  the life log, which used to be a drawer you had to open
     *
     * The activities moved out of a bottom bar because a bottom bar is where a
     * thumb is, and there is no thumb here: it was spending the full width of
     * the working column on six words while the left column sat half empty.
     */
    <main className="min-h-dvh bg-[var(--bg)] lg:mx-auto lg:grid lg:min-h-dvh lg:max-w-[88rem] lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,21rem)] lg:gap-5 lg:px-5 lg:py-5">
      {/*
        Arrives from the beta panel's "jump to the tank". Drives only the two
        controls a player has — ADVANCE, and the first choice on a blocking
        card — so the tape it writes is one the leaderboard verifier accepts.
      */}
      {autopilot && <BetaAutopilot />}

      {/* Left column on desktop; masthead on phone. */}
      <div className="lg:sticky lg:top-5 lg:flex lg:h-[calc(100dvh-2.5rem)] lg:flex-col lg:self-start lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:bg-[var(--surface)] lg:shadow-[var(--e2)]">
        <HomeStage
          run={run}
          founderName={profile?.founderName ?? run.founderName}
          onOpenPhone={() => setPhoneApp("home")}
          onOpenPro={() => setShowPro(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenBoard={() => setShowBoard(true)}
          onOpenStageGuide={() => setStageGuide(true)}
          onOpenKeyTerms={() => setKeyTerms(true)}
          /*
           * The way out, from the company's own name. A full navigation
           * rather than a router push for the same reason the Settings sheet
           * does it: /islands re-reads the archipelago from storage on mount,
           * and the run being left has to have flushed first.
           */
          onOpenIslands={() => {
            window.location.href =
              storefront() === "web" ? "/islands" : appPath("/islands");
          }}
          dossierOpen={dossier}
          onDossier={setDossier}
          nativeControls={!domChrome}
        />
        {/*
          The activities, as a list, desktop only. The phone keeps its bottom
          bar at the foot of the centre column below.

          `data-coach="tabs"` is on BOTH copies, and the tutorial points at
          whichever one is visible — see `coachTarget` in
          components/Coachmarks.tsx. Before that, only the phone's bottom bar
          carried the attribute, and on a desktop that element is `lg:hidden`:
          still in the document, so `querySelector` found it, and 0×0 at 0,0
          once measured. Three steps — the bar, PRODUCT and CLOSET — cut a
          zero-size hole in the top corner of an empty screen while the six
          tabs they describe sat unhighlighted in this rail.
        */}
        {domChrome ? (
          <div
            className="hidden min-h-0 flex-1 overflow-y-auto lg:block"
            data-coach="tabs"
          >
            <div className="px-4 pt-3 pb-1 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              ACTIVITIES
            </div>
            <ActivityBar
              active={activity}
              onOpen={openActivity}
              layout="rail"
            />
          </div>
        ) : null}
      </div>

      {/* The working column on desktop; the rest of the page on phone. */}
      <div className="flex min-h-0 flex-col lg:h-[calc(100dvh-2.5rem)] lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:bg-[var(--surface)] lg:shadow-[var(--e2)]">
        <div data-coach="books">
          <TheBooks run={run} onTermTap={(t) => setTerm({ term: t })} />
        </div>

        {/*
          One log, two presentations.

          On the phone the feed is compressed into a single glass row — the
          latest line, truncated — and the full story opens as a sheet. The
          feed used to be the whole lower half of the screen, which buried the
          ledger under a wall of prose; the row gives the numbers the room and
          keeps the story one tap away.

          Desktop keeps the inline feed: the right rail is the reading column
          the log was always short of, so there is nothing to compress. Same
          `lg:` seam as the rest of this file's two compositions.
        */}
        {/*
          The bottom reservation used to live here, as this row's padding, on
          the reading that "on a short phone the row is the page's end". It is
          not: <NextStep/> renders BELOW it and is the page's end whenever the
          company is missing something. So the padding reserved the deck's
          height in the wrong place — above the only element that needed it —
          and the nudge card was laid out into the space the native dock
          occupies and composited under it. The reservation now sits after
          everything, next to the web one, where the flow actually ends.
        */}
        <div className="px-3 pt-3 lg:hidden">
          <LogButton
            month={run.month}
            year={run.year}
            onOpen={() => setLogOpen(true)}
          />
        </div>

        {/*
          One thing worth doing, when there is one — nothing on the shelf,
          nobody employed, or room the team has already paid for. It renders
          nothing at all when the company is not missing anything, which is
          most of a healthy run.

          ── Why neither order worked, and why it now has no order ───────────

          It sat directly under The Books once, on "a nudge below the fold is a
          nudge nobody reads", and that pushed the one permanent row on this
          screen 131px further down — which is what "the story so far needs
          scrolling" turned out to be. It was moved below the log row, and the
          comment here reasoned that the fixture should win: the log row is
          always there and is 48px, the nudge is conditional and dismissible.

          Both readings shared an assumption, and it was the wrong one. The
          flow above this point — masthead, The Books, log row — is already
          taller than an iPhone 15 Pro, so there is no position in this document
          from which BOTH are on screen, and the loser is not merely lower, it
          is off the bottom of the phone. Reported as: it is down there and I
          cannot tap it. Ordering could never have fixed that.

          So it left the document. On the phone the card pins itself above the
          dock this screen measured. Desktop keeps it in the flow, where the
          column is a thousand pixels and none of this was ever a problem.

          ── And on iOS it is not this component at all ──────────────────────

          `domChrome` gates it for the same reason it gates the tab bar and the
          advance button: native views composite above the webview, so a DOM
          card left rendered under a UIKit one is a card sitting behind glass,
          and hiding it is not good enough — a hidden element still takes a tap
          on iOS if the native view above it lets the touch through. The app
          draws this as a real `UIGlassEffect` panel over the deck instead
          (GlassChromeController.buildNudge), pushed through `usePlayChrome`
          with the same four strings and answering with the same two taps.
        */}
        {domChrome ? (
          <NextStep
            nudge={nudge}
            onOpen={openActivity}
            onDismiss={dismissNudge}
            bottom={`${footerHeight + FLOW_TAIL}px`}
          />
        ) : null}
        {/*
          The centre column's own slack, so the decision and ADVANCE sit where
          they always did rather than floating at the top.

          On the phone that slack is a few pixels. On desktop it is most of a
          1000px column, and this is what fills it: the workspace. Clicking a
          row in the left rail opens that activity here, between the books and
          the clock, instead of throwing a modal over the layout the rail lives
          in — see components/screens/Workspace.tsx.

          With nothing open it states its own condition rather than sitting
          blank, since an empty column this size reads as a screen that failed
          to load. It says nothing at all while a decision is up, because the
          sheet is then the thing being read.
        */}
        <div
          ref={setWorkspaceEl}
          className="hidden min-h-0 flex-1 lg:flex lg:flex-col"
        >
          {!activity && !current && run.alive ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="max-w-[24rem] text-center">
                <div className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                  {atGate ? "THE YEAR IS UP" : "NOTHING ON THE TABLE"}
                </div>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {atGate
                    ? "Twelve months, banked. Close the year and see what they bought you."
                    : "Nobody needs you this minute. Advance the month and that will change."}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {domChrome ? (
          <>
            {/*
              The height the fixed bar takes, given back to the flow — plus the
              fade that hangs above it, so that scrolling to the very end lands
              the last card clear of BOTH. Without the extra 36px the end of the
              document is the bottom of the fade, and the final element is
              always partly washed out however far you scroll.
            */}
            <div
              aria-hidden="true"
              className="shrink-0 lg:hidden"
              style={{ height: footerHeight + DOCK_FADE + FLOW_TAIL }}
            />
            <div
              ref={setFooterEl}
              className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--hairline)] bg-[var(--bg)] pt-2 lg:static lg:bg-[var(--surface)]"
            >
              {/*
                ── Content dissolves under this dock; it does not get sliced ──

                Reported as "what is this?" — a card whose top 25px showed
                above the dock's hard border and whose remainder was gone. The
                page is taller than any phone once a nudge is up, so something
                IS under here; the question was only whether that reads as
                "there is more below" or as a rendering fault.

                A border with a fade above it says the first. Phone only: on
                desktop this block is `lg:static` at the foot of a column with
                nothing passing beneath it.
              */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-full h-9 bg-gradient-to-t from-[var(--bg)] to-transparent lg:hidden"
              />
              <TermCoach
                term={term?.term ?? null}
                detail={term?.detail}
                onDismiss={() => setTerm(null)}
              />
              <div data-coach="advance">
                <AdvanceButton
                  month={run.month}
                  year={run.year}
                  atGate={atGate}
                  disabled={!!current || !run.alive}
                  onAdvance={game.advance}
                  onOpenGate={game.openYearGate}
                />
              </div>
              {/* Phone only: on desktop these six live in the left rail. */}
              <div className="mt-1.5 lg:hidden" data-coach="tabs">
                <ActivityBar active={activity} onOpen={openActivity} />
              </div>
            </div>
          </>
        ) : (
          /*
            The same reservation, for the deck UIKit draws instead. It floats
            over the page rather than taking space in it, and `--nv-chrome-bottom`
            is what it measured itself to be (safe area included) — so the flow
            ends with exactly that much air plus the design's own gap, and the
            last card in it clears the glass.

            Tolerating 0 is the contract in globals.css: the variable is 0 for
            the frame between first paint and the first measurement, and on the
            web branch above this element does not exist at all.
          */
          <div
            aria-hidden="true"
            className="shrink-0 lg:hidden"
            style={{ height: "calc(var(--nv-chrome-bottom, 0px) + 0.75rem)" }}
          />
        )}
      </div>

      {/*
        THE RIGHT COLUMN — the life log, desktop only.

        It used to be a drawer you had to open, and on a 1440px screen there is
        no reason for the company's own narrative record to be behind a tap.
        The phone keeps the one-row summary and the sheet, because on a phone
        there genuinely is no room for it.
      */}
      <aside className="hidden lg:flex lg:h-[calc(100dvh-2.5rem)] lg:flex-col lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:bg-[var(--surface)] lg:shadow-[var(--e2)]">
        <div className="flex shrink-0 items-baseline gap-2 border-b border-[var(--hairline)] px-4 py-3">
          <span className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            LIFE LOG
          </span>
          <span className="tnum ml-auto text-2xs text-[var(--text-tertiary)]">
            FY{run.year} · M{String(run.month).padStart(2, "0")}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <LifeLog lines={run.log} />
        </div>
      </aside>

      {/*
        The stance question gets its own sheet. It is the one decision in the
        game that is an identity rather than a tradeoff, and rendering it as a
        generic three-choice card buried the point. Both ask events author their
        choices in STANCE_CHOICE_ORDER, so the stance maps straight back to a
        choice index and resolves through the exact same engine path.
      */}
      {isStanceQuestion ? (
        <PositioningSheet
          industry={run.industry}
          event={current}
          positioning={run.positioning ?? null}
          onChoose={(stance) =>
            game.choose(STANCE_CHOICE_ORDER.indexOf(stance))
          }
          onDismiss={game.dismissCard}
        />
      ) : (
        domDecisionSheet && (
          <DecisionSheet
            event={current}
            choices={currentChoices}
            industry={run.industry}
            rookieMode={run.rookieMode}
            isMarket={currentIsMarket}
            // Once, on the first decision of a guided run.
            explain={
              run.tutorial &&
              run.year === 1 &&
              !run.seenTerms.includes("choices")
            }
            onChoose={(i) => {
              if (run.tutorial && !run.seenTerms.includes("choices"))
                game.markTermSeen("choices");
              game.choose(i);
            }}
            onDismiss={game.dismissCard}
          />
        )
      )}

      {/*
        ── Every overlay on this screen, inside one AnimatePresence ──────────
        │
        │ Measured before this: eighteen overlays on /play and ZERO exits. This
        │ file had no framer-motion import at all, so nothing was mounted that
        │ could run an exit animation — which is why seven components already
        │ shipped `exit` props that had never once executed. Everything on this
        │ screen closed by vanishing between two frames, against design.md §5's
        │ "exits ~0.66× entrances" and the §9 gate that checks it.
        │
        │ ── The failure this has to avoid ───────────────────────────────────
        │
        │ app/welcome/page.tsx:137 records what happened last time someone
        │ reached for AnimatePresence here: "its exit never resolves when the
        │ direct child is a component rather than a motion element, which
        │ strands the whole flow on step one." That is the real trap — Framer
        │ holds an exiting child mounted until something calls safeToRemove,
        │ and only a `motion` element with an `exit` prop ever does. A child
        │ with no exit anywhere in it is a child that never leaves, and the
        │ overlay stays on screen forever.
        │
        │ So each of these is safe for one specific reason: the root of every
        │ component below is a motion element that now carries an `exit`, and
        │ each gets a stable `key` here. That is verified, not assumed —
        │ scripts/exit-audit.mjs drives a real browser, opens each overlay,
        │ closes it, and fails if the node is still in the DOM afterwards.
        │
        │ `mode` is deliberately NOT "wait": these are independent overlays,
        │ not steps in a flow, and mode="wait" would make closing one delay
        │ opening the next.
        */}
      <WorkspaceSlot.Provider value={workspaceEl}>
        <AnimatePresence>
          {/* ── Each tab is a full screen now, not a list of options ─────────── */}
          {activity === "company" && (
            <CompanyScreen key="company" onClose={() => setActivity(null)} />
          )}
          {activity === "team" && (
            <TeamScreen
              key="team"
              onClose={() => setActivity(null)}
              onFire={game.fire}
              onOpenPhone={() => {
                setActivity(null);
                setPhoneApp("linkedout");
              }}
            />
          )}
          {activity === "product" && (
            <ProductScreen key="product" onClose={() => setActivity(null)} />
          )}
          {activity === "assets" && (
            <AssetsScreen
              key="assets"
              onClose={() => setActivity(null)}
              onBuy={game.buyHolding}
              onSell={game.sellHolding}
            />
          )}
          {activity === "market" && phoneNode("robinghood")}
          {activity === "closet" && (
            <ClosetScreen
              key="closet"
              onClose={() => setActivity(null)}
              onChange={game.setAvatar}
            />
          )}

          {phoneApp && activity !== "market" && phoneNode(phoneApp)}

          {stageGuide && (
            <StageGuide
              key="stage-guide"
              run={run}
              onClose={() => setStageGuide(false)}
            />
          )}
          {keyTerms && (
            <KeyTermsSheet key="key-terms" onClose={() => setKeyTerms(false)} />
          )}

          {showPro && <ProSheet key="pro" onClose={() => setShowPro(false)} />}
          {showSettings && (
            <SettingsScreen
              key="settings"
              onClose={() => setShowSettings(false)}
            />
          )}
          {showBoard && (
            <StillStandingScreen
              key="board"
              onClose={() => setShowBoard(false)}
            />
          )}
          {logOpen && (
            <LogSheet key="log" run={run} onClose={() => setLogOpen(false)} />
          )}
        </AnimatePresence>
      </WorkspaceSlot.Provider>

      {/* Fires the moment a stage promotion opens a new tier. It sits above
          the year-end statement on purpose: the wardrobe is the reward for
          the year you just closed. */}
      {game.tierUnlock && (
        <TierUnlock
          gender={run.avatar.gender}
          tier={game.tierUnlock}
          onClose={game.dismissTierUnlock}
        />
      )}

      {yearEnd && <YearEndStatement summary={yearEnd} />}
      {autopsy && !run.alive && <ChapterSeven report={autopsy} />}

      {coaching && (
        <Coachmarks
          steps={coachSteps}
          index={coachIndex}
          onAdvance={() => setCoachIndex((i) => i + 1)}
          onBack={() => setCoachIndex((i) => Math.max(0, i - 1))}
          onFinish={finishCoaching}
          nativeChrome={nativeChromeOwned}
          nativeRect={nativeCoachRect}
        />
      )}
    </main>
  );
}
