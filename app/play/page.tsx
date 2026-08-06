"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
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
import { usePlayChrome, type NativeControlId } from "@/components/native/usePlayChrome";
import { useNativeSheet } from "@/components/native/useNativeSheet";
import { useNativeTermCoach } from "@/components/native/useNativeTermCoach";
import { useBackHandler } from "@/lib/native/back";
import { WorkspaceSlot } from "@/components/screens/Workspace";
import { useNativeCoachRect } from "@/lib/native/chrome";
import { consumeOutsideOpen, subscribeOutsideOpen } from "@/lib/outside/links";
import { Coachmarks, firstRunSteps } from "@/components/Coachmarks";
import { NextStep } from "@/components/NextStep";
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
 * The options object below is repeated at every call site rather than shared.
 * That is not a style choice: next/dynamic is compiled by a SWC transform that
 * reads its second argument statically, and it rejects anything that is not an
 * object literal — "next/dynamic options must be an object literal."
 */

const PerformScreen = dynamic(
  () => import("@/components/PerformScreen").then((m) => m.PerformScreen),
  {
    ssr: false,
    loading: () => (
      <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-[var(--bg)] px-6">
        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
          THE YEAR CLOSES
        </p>
        <p className="text-sm text-[var(--text-secondary)]">Setting up the room…</p>
      </main>
    ),
  },
);

const CompanyScreen = dynamic(
  () => import("@/components/screens/CompanyScreen").then((m) => m.CompanyScreen),
  { ssr: false, loading: () => null },
);
const ProductScreen = dynamic(
  () => import("@/components/screens/ProductScreen").then((m) => m.ProductScreen),
  { ssr: false, loading: () => null },
);
const TeamScreen = dynamic(
  () => import("@/components/screens/TeamScreen").then((m) => m.TeamScreen),
  { ssr: false, loading: () => null },
);
const AssetsScreen = dynamic(
  () => import("@/components/screens/AssetsScreen").then((m) => m.AssetsScreen),
  { ssr: false, loading: () => null },
);
const ClosetScreen = dynamic(
  () => import("@/components/screens/ClosetScreen").then((m) => m.ClosetScreen),
  { ssr: false, loading: () => null },
);
const SettingsScreen = dynamic(
  () => import("@/components/screens/SettingsScreen").then((m) => m.SettingsScreen),
  { ssr: false, loading: () => null },
);
const StillStandingScreen = dynamic(
  () => import("@/components/screens/StillStandingScreen").then((m) => m.StillStandingScreen),
  { ssr: false, loading: () => null },
);
const StageGuide = dynamic(
  () => import("@/components/StageGuide").then((m) => m.StageGuide),
  { ssr: false, loading: () => null },
);
const KeyTermsSheet = dynamic(
  () => import("@/components/KeyTermsSheet").then((m) => m.KeyTermsSheet),
  { ssr: false, loading: () => null },
);
const ProSheet = dynamic(() => import("@/components/ProSheet").then((m) => m.ProSheet), { ssr: false, loading: () => null });
const ChapterSeven = dynamic(
  () => import("@/components/ChapterSeven").then((m) => m.ChapterSeven),
  { ssr: false, loading: () => null },
);
const YearEndStatement = dynamic(
  () => import("@/components/YearEndStatement").then((m) => m.YearEndStatement),
  { ssr: false, loading: () => null },
);
const TierUnlock = dynamic(
  () => import("@/components/TierUnlock").then((m) => m.TierUnlock),
  { ssr: false, loading: () => null },
);
const Phone = dynamic(() => import("@/components/phone/Phone").then((m) => m.Phone), { ssr: false, loading: () => null });
const RobinGhood = dynamic(
  () => import("@/components/phone/RobinGhood").then((m) => m.RobinGhood),
  { ssr: false, loading: () => null },
);
const LinkedOut = dynamic(
  () => import("@/components/phone/LinkedOut").then((m) => m.LinkedOut),
  { ssr: false, loading: () => null },
);
const PositioningSheet = dynamic(
  () => import("@/components/PositioningSheet").then((m) => m.PositioningSheet),
  { ssr: false, loading: () => null },
);
const DecisionSheet = dynamic(
  () => import("@/components/DecisionSheet").then((m) => m.DecisionSheet),
  { ssr: false, loading: () => null },
);

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
    run, profile, current, currentIsMarket, atGate, yearEnd, autopsy, perform, lastDeltas,
  } = game;
  const impact = useImpact();

  const [activity, setActivity] = useState<ActivityTab | null>(null);
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
  const [showPro, setShowPro] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [dossier, setDossier] = useState(false);
  const [stageGuide, setStageGuide] = useState(false);
  /** The book page: every key term, searchable, with the Rookie switch on it. */
  const [keyTerms, setKeyTerms] = useState(false);
  /** The phone's log sheet. Desktop keeps the log inline and never sets this. */
  const [logOpen, setLogOpen] = useState(false);
  const [term, setTerm] = useState<{ term: string; detail?: string } | null>(null);

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
   * for the flag, opens the phone on The Room, and clears it.
   */
  useEffect(() => {
    if (!game.run?.flags.open_the_room) return;
    game.clearFlag("open_the_room");
    setActivity(null);
    setPhoneApp("coldcall");
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

  const coachTarget = coaching ? coachSteps[coachIndex]?.native ?? "" : null;

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
      setActivity(tab);
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
   * which is a whole screen's worth of reading before the tap, and
   * `dynamic().preload()` fetches without rendering.
   *
   * Idle rather than immediate, and a timeout underneath it, for the same
   * reason lib/prefetch.ts is written that way: the screen the player is
   * actually looking at gets the main thread first, and a slow phone that
   * never goes idle must still end up with the chunk.
   */
  useEffect(() => {
    if (!atGate) return;
    const warm = () => void (PerformScreen as { preload?: () => void }).preload?.();
    const idle = window.requestIdleCallback;
    if (idle) {
      const id = idle(warm, { timeout: 1500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 400);
    return () => window.clearTimeout(id);
  }, [atGate]);

  const nativeChromeOwned = usePlayChrome({
    visible: !!run && !overlay,
    coach: coachTarget,
    month: run?.month ?? 1,
    year: run?.year ?? 1,
    atGate,
    canAdvance: !!run?.alive && !current,
    pro: !!run?.pro,
    activeTab: activity,
    onTab: onNativeTab,
    onAdvance: onNativeAdvance,
    onOpenGate: game.openYearGate,
    onControl: onNativeControl,
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
    explain: !!run?.tutorial && run?.year === 1 && !run?.seenTerms.includes("choices"),
    onChoose: (i) => {
      if (run?.tutorial && !run.seenTerms.includes("choices")) game.markTermSeen("choices");
      game.choose(i);
    },
    onDismiss: game.dismissCard,
  });

  const domDecisionSheet = !nativeSheetOwned || isStanceQuestion;

  /* Term-on-first-use becomes a glass note floated from the top. The DOM
     version docks above the advance bar so it cannot cover the number it is
     quoting; the native one arrives from the opposite edge for the same
     reason, because that number now lives in a UIKit deck. */
  useNativeTermCoach(domChrome ? null : (term?.term ?? null), term?.detail, () => setTerm(null));

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
          <div className="hidden min-h-0 flex-1 overflow-y-auto lg:block" data-coach="tabs">
            <div className="px-4 pt-3 pb-1 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              ACTIVITIES
            </div>
            <ActivityBar active={activity} onOpen={setActivity} layout="rail" />
          </div>
        ) : null}
      </div>

      {/* The working column on desktop; the rest of the page on phone. */}
      <div className="flex min-h-0 flex-col lg:h-[calc(100dvh-2.5rem)] lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:bg-[var(--surface)] lg:shadow-[var(--e2)]">
        <div data-coach="books">
          <TheBooks run={run} onTermTap={(t) => setTerm({ term: t })} />
        </div>

        {/*
          One thing worth doing, when there is one — nothing on the shelf,
          nobody employed, or room the team has already paid for. Directly
          under the Books because it is about what the Books are saying, and
          above the feed because a nudge below the fold is a nudge nobody
          reads. It renders nothing at all when the company is not missing
          anything, which is most of a healthy run.
        */}
        <NextStep run={run} onOpen={(tab) => setActivity(tab)} />

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
        <div
          className="px-3 pt-3 lg:hidden"
          // The native deck floats over the page's end; on a short phone the
          // row is the page's end, so it reserves the deck's measured height.
          style={domChrome ? undefined : { paddingBottom: "var(--nv-chrome-bottom, 0px)" }}
        >
          <LogButton month={run.month} year={run.year} onOpen={() => setLogOpen(true)} />
        </div>
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
        <div ref={setWorkspaceEl} className="hidden min-h-0 flex-1 lg:flex lg:flex-col">
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
            {/* The height the fixed bar takes, given back to the flow. */}
            <div
              aria-hidden="true"
              className="shrink-0 lg:hidden"
              style={{ height: footerHeight }}
            />
            <div
              ref={setFooterEl}
              className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--hairline)] bg-[var(--bg)] pt-2 lg:static lg:bg-[var(--surface)]"
            >
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
                <ActivityBar active={activity} onOpen={setActivity} />
              </div>
            </div>
          </>
        ) : null}
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
          onChoose={(stance) => game.choose(STANCE_CHOICE_ORDER.indexOf(stance))}
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
            explain={run.tutorial && run.year === 1 && !run.seenTerms.includes("choices")}
            onChoose={(i) => {
              if (run.tutorial && !run.seenTerms.includes("choices")) game.markTermSeen("choices");
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
      {activity === "company" && <CompanyScreen key="company" onClose={() => setActivity(null)} />}
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
      {activity === "product" && <ProductScreen key="product" onClose={() => setActivity(null)} />}
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
        <ClosetScreen key="closet" onClose={() => setActivity(null)} onChange={game.setAvatar} />
      )}

      {phoneApp && activity !== "market" && phoneNode(phoneApp)}

      {stageGuide && <StageGuide key="stage-guide" run={run} onClose={() => setStageGuide(false)} />}
      {keyTerms && <KeyTermsSheet key="key-terms" onClose={() => setKeyTerms(false)} />}

      {showPro && <ProSheet key="pro" onClose={() => setShowPro(false)} />}
      {showSettings && <SettingsScreen key="settings" onClose={() => setShowSettings(false)} />}
      {showBoard && <StillStandingScreen key="board" onClose={() => setShowBoard(false)} />}
      {logOpen && <LogSheet key="log" run={run} onClose={() => setLogOpen(false)} />}
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
