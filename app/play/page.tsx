"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGame } from "@/lib/state/GameProvider";
import { HomeStage } from "@/components/HomeStage";
import { TheBooks } from "@/components/TheBooks";
import { LifeLog } from "@/components/LifeLog";
import { AdvanceButton } from "@/components/AdvanceButton";
import { DecisionSheet } from "@/components/DecisionSheet";
import { PositioningSheet } from "@/components/PositioningSheet";
import { STANCE_CHOICE_ORDER } from "@/lib/engine/positioning";
import { ActivityBar, type ActivityTab } from "@/components/ActivityBar";
import { TermCoach } from "@/components/TermCoach";
import { YearEndStatement } from "@/components/YearEndStatement";
import { ChapterSeven } from "@/components/ChapterSeven";
import { PerformScreen } from "@/components/PerformScreen";
import { ProSheet } from "@/components/ProSheet";
import { Coachmarks, FIRST_RUN_STEPS } from "@/components/Coachmarks";
import { ImpactProvider, useImpact } from "@/components/ImpactLayer";
import { CompanyScreen } from "@/components/screens/CompanyScreen";
import { ProductScreen } from "@/components/screens/ProductScreen";
import { TeamScreen } from "@/components/screens/TeamScreen";
import { AssetsScreen } from "@/components/screens/AssetsScreen";
import { ClosetScreen } from "@/components/screens/ClosetScreen";
import { Phone } from "@/components/phone/Phone";
import type { PhoneApp } from "@/components/phone/Phone";
import { TierUnlock } from "@/components/TierUnlock";
import { SettingsScreen } from "@/components/screens/SettingsScreen";
import { RobinGhood } from "@/components/phone/RobinGhood";
import { LinkedOut } from "@/components/phone/LinkedOut";
import { deriveRunwayMonths } from "@/lib/engine/sim";
import { fmtMonths } from "@/lib/engine/format";
import { usePlayChrome, type NativeControlId } from "@/components/native/usePlayChrome";
import { useNativeSheet } from "@/components/native/useNativeSheet";
import { useNativeTermCoach } from "@/components/native/useNativeTermCoach";
import { useBackHandler } from "@/lib/native/back";
import { useNativeCoachRect } from "@/lib/native/chrome";

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

  /**
   * "home" means "the phone is open with no destination" — it unlocks to the
   * home screen. A concrete app id here is a deep link from a notification or a
   * hire flow, and it is honoured after the unlock rather than instead of it.
   */
  const [phoneApp, setPhoneApp] = useState<PhoneApp | "home" | null>(null);
  const [showPro, setShowPro] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dossier, setDossier] = useState(false);
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

  useEffect(() => {
    if (checked && !run) {
      router.replace(profile?.onboarded ? "/found" : "/welcome");
    }
  }, [checked, run, profile, router]);

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
    !dossier &&
    run.alive;

  const overlay =
    !!current ||
    !!activity ||
    !!phoneApp ||
    showPro ||
    showSettings ||
    dossier ||
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
  const coachTarget = coaching ? FIRST_RUN_STEPS[coachIndex]?.native ?? "" : null;

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
      if (coachIndex >= FIRST_RUN_STEPS.length - 1) finishCoaching();
      else setCoachIndex((i) => i + 1);
    },
    [coaching, coachTarget, coachIndex, finishCoaching],
  );

  const onNativeControl = useCallback(
    (id: NativeControlId) => {
      completeCoachStep(id);
      if (id === "pro") setShowPro(true);
      else if (id === "dossier") setDossier(true);
      else if (id === "settings") setShowSettings(true);
      else if (id === "phone") setPhoneApp("home");
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

  const nativeChromeOwned = usePlayChrome({
    visible: !!run && !overlay,
    coach: coachTarget,
    month: run?.month ?? 1,
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
  useBackHandler(!!current, game.dismissCard);
  useBackHandler(!!activity, () => setActivity(null));
  useBackHandler(!!phoneApp, () => setPhoneApp(null));
  useBackHandler(showPro, () => setShowPro(false));
  useBackHandler(showSettings, () => setShowSettings(false));
  useBackHandler(dossier, () => setDossier(false));

  if (!run) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-[var(--text-tertiary)]">Opening the books…</p>
      </main>
    );
  }

  if (perform) return <PerformScreen />;

  const phoneNode = (app: PhoneApp | "home") => (
    <Phone
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
     */
    <main className="min-h-dvh bg-[var(--bg)] lg:mx-auto lg:grid lg:min-h-dvh lg:max-w-6xl lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-6 lg:px-6 lg:py-6">
      {/* Left column on desktop; masthead on phone. */}
      <div className="lg:sticky lg:top-6 lg:self-start lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:shadow-[var(--e2)]">
        <HomeStage
          run={run}
          founderName={profile?.founderName ?? run.founderName}
          onOpenPhone={() => setPhoneApp("home")}
          onOpenPro={() => setShowPro(true)}
          onOpenSettings={() => setShowSettings(true)}
          dossierOpen={dossier}
          onDossier={setDossier}
          nativeControls={!domChrome}
        />
      </div>

      {/* Right rail on desktop; the rest of the page on phone. */}
      <div className="flex min-h-0 flex-col lg:h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:bg-[var(--surface)] lg:shadow-[var(--e2)]">
        <div data-coach="books">
          <TheBooks run={run} onTermTap={(t) => setTerm({ term: t })} />
        </div>

        {/*
          The log takes the reserved space rather than a spacer taking it.
          Glass refracts what is behind it, so what has to be behind the native
          deck is scrolling content — a padded opaque band would leave the most
          expensive material on the screen with nothing to show.
        */}
        <div
          className="flex-1 overflow-y-auto pb-3"
          style={domChrome ? undefined : { paddingBottom: "var(--nv-chrome-bottom, 0px)" }}
        >
          <LifeLog lines={run.log} />
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
                  atGate={atGate}
                  disabled={!!current || !run.alive}
                  onAdvance={game.advance}
                  onOpenGate={game.openYearGate}
                />
              </div>
              <div className="mt-1.5" data-coach="tabs">
                <ActivityBar active={activity} onOpen={setActivity} />
              </div>
            </div>
          </>
        ) : null}
      </div>

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

      {/* ── Each tab is a full screen now, not a list of options ─────────── */}
      {activity === "company" && <CompanyScreen onClose={() => setActivity(null)} />}
      {activity === "team" && (
        <TeamScreen
          onClose={() => setActivity(null)}
          onFire={game.fire}
          onOpenPhone={() => {
            setActivity(null);
            setPhoneApp("linkedout");
          }}
        />
      )}
      {activity === "product" && <ProductScreen onClose={() => setActivity(null)} />}
      {activity === "assets" && (
        <AssetsScreen
          onClose={() => setActivity(null)}
          onBuy={game.buyHolding}
          onSell={game.sellHolding}
        />
      )}
      {activity === "market" && phoneNode("robinghood")}
      {activity === "closet" && (
        <ClosetScreen onClose={() => setActivity(null)} onChange={game.setAvatar} />
      )}

      {phoneApp && activity !== "market" && phoneNode(phoneApp)}

      {showPro && <ProSheet onClose={() => setShowPro(false)} />}
      {showSettings && <SettingsScreen onClose={() => setShowSettings(false)} />}

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
          steps={FIRST_RUN_STEPS}
          index={coachIndex}
          onAdvance={() => setCoachIndex((i) => i + 1)}
          onFinish={finishCoaching}
          nativeChrome={nativeChromeOwned}
          nativeRect={nativeCoachRect}
        />
      )}
    </main>
  );
}
