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
  const [term, setTerm] = useState<{ term: string; detail?: string } | null>(null);
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

  if (!run) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-[var(--text-tertiary)]">Opening the books…</p>
      </main>
    );
  }

  if (perform) return <PerformScreen />;

  // The guided first play blocks everything else until it's done — but it
  // must yield to anything the player opened, or it draws over the top of it.
  const coaching =
    run.tutorial &&
    run.tutorialStep > 0 &&
    !current &&
    !yearEnd &&
    !activity &&
    !phoneApp &&
    !showPro &&
    !showSettings &&
    run.alive;

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
        />
      </div>

      {/* Right rail on desktop; the rest of the page on phone. */}
      <div className="flex min-h-0 flex-col lg:h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:bg-[var(--surface)] lg:shadow-[var(--e2)]">
        <div data-coach="books">
          <TheBooks run={run} onTermTap={(t) => setTerm({ term: t })} />
        </div>

        <div className="flex-1 overflow-y-auto pb-3">
          <LifeLog lines={run.log} />
        </div>

        <div className="sticky bottom-0 z-20 border-t border-[var(--hairline)] bg-[var(--bg)] pt-2 lg:bg-[var(--surface)]">
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
      </div>

      {/*
        The stance question gets its own sheet. It is the one decision in the
        game that is an identity rather than a tradeoff, and rendering it as a
        generic three-choice card buried the point. Both ask events author their
        choices in STANCE_CHOICE_ORDER, so the stance maps straight back to a
        choice index and resolves through the exact same engine path.
      */}
      {current?.id.startsWith("E-POS-ASK") ? (
        <PositioningSheet
          industry={run.industry}
          event={current}
          positioning={run.positioning ?? null}
          onChoose={(stance) => game.choose(STANCE_CHOICE_ORDER.indexOf(stance))}
          onDismiss={game.dismissCard}
        />
      ) : (
            <DecisionSheet
        event={current}
        choices={current ? game.choicesFor(current) : []}
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
        />
      )}
    </main>
  );
}
