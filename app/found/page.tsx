"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GameProvider, useGame } from "@/lib/state/GameProvider";
import { FounderPortrait } from "@/components/FounderAvatar";
import { PickMark } from "@/components/ui/PickMark";
import type { Gender } from "@/lib/engine/avatar";
import { INDUSTRIES } from "@/lib/engine/constants";
import type { Industry } from "@/lib/engine/types";
import { liveIslandCount, loadProfile } from "@/lib/engine/save";
import {
  ISLAND_CAP,
  industryUnlocked,
  islandCapFor,
  loadEntitlements,
  onEntitlementsChange,
  runsRemainingToday,
} from "@/lib/monetization";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";
import { usePrefetch } from "@/lib/prefetch";
import { useNavigating } from "@/lib/navigating";
import { EMPTY_BRIEF, sanitizeBrief, type CompanyBrief } from "@/lib/engine/company-brief";
import { writeBrief } from "@/lib/ai/brief";

export default function FoundPageWrapper() {
  return (
    <GameProvider>
      {/* useSearchParams needs one — this page is statically exported
          (next.config.ts, output: "export") and the hook suspends until the
          client knows the query. */}
      <Suspense fallback={null}>
        <FoundPage />
      </Suspense>
    </GameProvider>
  );
}

/**
 * O8 · Found the company. Every industry picks; Pro is asked for at FOUND IT.
 *
 * The grid used to refuse a paid industry on the tap — dimmed card, padlock,
 * instant upsell. It now selects like any other, and the refusal waits for the
 * press that commits. A player who has chosen the business, named the company
 * and written the brief is being answered about something they want; a player
 * whose finger has just landed on a card is being told off for looking.
 *
 * ── Why this screen knows about the company you already have ─────────────────
 *
 * It is reachable with a run in progress — a bookmark, the back button, the
 * reload the cloud restore performs after adopting a save — and it used to
 * pretend otherwise. Two things went wrong when it did. A free player, who gets
 * one founding a real day, saw NO RUNS LEFT TODAY with no way to reach the
 * company that was sitting in storage the whole time. And a player who DID have
 * a slot left founded straight over a live company: startRun writes the new run
 * to the same key, so the old one went without a record, an autopsy, or a
 * question.
 *
 * So: an open company is offered back first, and founding another one closes it
 * the honest way — through endRun(), which writes it into legacy exactly as
 * Settings does — behind a confirmation that says the name out loud.
 */
function FoundPage() {
  const router = useRouter();
  const game = useGame();
  const upgrade = useUpgrade();
  const params = useSearchParams();
  /*
   * Which island this company goes on.
   *
   * The picker sends `?island=N` when the player taps a specific empty card,
   * so founding lands where they pointed. Reached without one — a bookmark, the
   * onboarding hand-off, the return from Stripe (`/found?purchase=ok`) — it is
   * left undefined and `startRun` picks with `slotForNewCompany`, which is the
   * same rule the picker used to draw the card in the first place.
   *
   * ── Why this is not `Number(params.get("island"))` ─────────────────────────
   *
   * It was, and `Number(null)` is 0 — not NaN. So every arrival WITHOUT the
   * query string, which is every arrival the comment above describes, asked to
   * found on island 0 specifically. A player with a company on island 0 who
   * reached this screen by any door but the picker founded straight over it:
   * `startRun` wrote the new company to that slot, the picker showed one island
   * back at Year 1 Month 1, and the debounced push replaced the cloud row too,
   * so the loss followed them onto every other device.
   *
   * `Number("")` is 0 as well, so an empty `?island=` gets the same answer as no
   * `?island` at all rather than a slot number nobody typed.
   */
  const askedFor = (params.get("island") ?? "").trim();
  const parsedSlot = askedFor === "" ? Number.NaN : Number(askedFor);
  const targetSlot =
    Number.isInteger(parsedSlot) && parsedSlot >= 0 && parsedSlot < ISLAND_CAP
      ? parsedSlot
      : undefined;

  /** Companies still going, and how many are allowed. Read after mount. */
  const [living, setLiving] = useState(0);
  const [cap, setCap] = useState(ISLAND_CAP);
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState<Industry>("FOOD");
  const [gender, setGender] = useState<Gender>("male");
  const [skipTutorial, setSkipTutorial] = useState(false);
  /**
   * What the company IS. Four questions the sim cannot answer for itself, asked
   * once here rather than improvised under questioning in The Tank.
   *
   * Every field is optional. A player who wants to found and go can; the notes
   * card simply has less on it, and the debrief says so rather than pretending.
   */
  const [brief, setBrief] = useState<CompanyBrief>(EMPTY_BRIEF);
  const [writing, setWriting] = useState(false);
  /** AI first-drafts left for THIS founding. Three on every tier. */
  const [drafts, setDrafts] = useState(3);
  const [briefOpen, setBriefOpen] = useState(false);
  /** null until mounted — the ledger lives in localStorage. */
  const [slotsLeft, setSlotsLeft] = useState<number | null>(null);
  /**
   * Read after mount, like the two above it, and for a sharper reason.
   *
   * `loadProfile()` used to be called during render. localStorage does not
   * exist on the server, so the returning player's "skip the guided year"
   * checkbox was in the client's tree and not in the server's — a hydration
   * mismatch, which React answers by throwing away that subtree and building
   * it again. The subtree contains the company-name field, so anything already
   * typed into it was discarded: type fast enough on the screen that focuses
   * itself 400ms in, and the name you chose is simply gone.
   */
  const [profile, setProfile] = useState<ReturnType<typeof loadProfile>>(null);
  /*
   * The entitlement half re-reads on every write, not only at mount. Buying Pro
   * from the upgrade screen happens without leaving this page, and reading once
   * meant the grid the player was staring at kept its locks and FOUND IT stayed
   * disabled — the purchase looked like it had failed. The profile stays a
   * one-shot read: a purchase does not rename anybody.
   *
   * `isPro` rather than the raw `pro` flag, to match `industryUnlocked()` in
   * lib/monetization.ts: a chapter seat is Pro for the year, and reading the
   * flag directly locked every paid industry for a classroom that had paid for
   * all of them.
   */
  useEffect(() => {
    const sync = () => {
      const e = loadEntitlements();
      setSlotsLeft(runsRemainingToday(e));
      setCap(islandCapFor(e));
      setLiving(liveIslandCount());
    };
    sync();
    setProfile(loadProfile());
    return onEntitlementsChange(sync);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * …and the field keeps whatever is already in it.
   *
   * This page is server-rendered, so the input exists and accepts typing
   * before React has hydrated — which is the normal state of the screen for a
   * returning player who opens it directly. A controlled input resolves that
   * gap by resetting the DOM to its prop, so the browser's own value loses to
   * an empty string that was decided before the player arrived.
   *
   * Uncontrolled through hydration, then adopted: `maxLength` enforces the
   * same 28 characters the slice below does, so the two can never disagree.
   */
  useEffect(() => {
    const typed = inputRef.current?.value;
    if (typed) setCompanyName(typed.slice(0, 28));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  // Naming a company is the last thing before the game itself.
  usePrefetch("/play");

  /*
   * Both routes out of this screen go to /play, which is the heaviest page in
   * the app. Until this, neither of them acknowledged the tap at all — the
   * button stayed lit and the screen stayed put for the length of the chunk.
   */
  const [going, go] = useNavigating();
  const [resuming, resume] = useNavigating();

  const start = () => {
    /*
     * ── This used to close the company you already had ────────────────────
     *
     * With one save, founding meant overwriting, so this screen asked twice
     * and then called `endRun()` on a live company to make room. There is room
     * now: a new company goes on its own island and the old one is still
     * there when the player wants it.
     *
     * Both limits are re-read at the tap rather than trusted from mount. The
     * ledger is a real calendar day and this screen can sit open across
     * midnight in either direction, and the cap can change while it is open —
     * buying an island happens without leaving the page.
     */
    /*
     * ── The industry gate, moved here from the grid ────────────────────────
     *
     * First, before the run slot and the island: a player refused for BOTH
     * should hear the answer that has a door behind it, and this is the one
     * with a door. `open` rather than `notify` — the same choice the island
     * and run-slot refusals on this page already make — because a press on
     * FOUND IT is a decision, not a glance, and it deserves the screen that
     * can actually sell the pack rather than a banner that appears once a
     * session and then never again.
     *
     * Re-read at the tap for the same reason the two limits below are: the
     * paywall this opens can be bought from without leaving the page, so the
     * second press has to see the purchase the first one caused.
     */
    /*
     * `industryUnlocked` rather than `isPro`, and read fresh rather than held
     * in state. There are three ways to own an industry — it is free, the
     * account is Pro or on a chapter seat, or the pack was bought on its own —
     * and this function is the only thing that knows all three. It was
     * exported and called from nowhere until now, which is why a player who
     * had bought FASHION as a one-time pack was still refused it at founding.
     */
    if (!industryUnlocked(industry, loadEntitlements())) {
      upgrade.open("industries");
      return;
    }

    const left = runsRemainingToday();
    setSlotsLeft(left);
    if (left <= 0) return;

    const room = liveIslandCount();
    setLiving(room);
    if (room >= cap) return;

    go(() => {
      game.startRun({
        slot: targetSlot,
        founderName: profile?.founderName ?? "Founder",
        playerAge: profile?.playerAge ?? null,
        companyName: companyName.trim() || "GlorpCo",
        industry,
        rookieMode: profile?.rookieMode ?? true,
        tutorial: !skipTutorial,
        gender,
        brief: sanitizeBrief(brief),
      });
      router.push("/play");
    });
  };

  /**
   * The way out for a founder who cannot yet write a positioning statement.
   *
   * It never overwrites a field the player has already filled in — see
   * `mergeDraft` in lib/ai/brief.ts — so this is a way of finishing a brief,
   * not of having one written over you. It also always returns something: with
   * no model behind the route the offline writer answers instead.
   */
  const generate = async () => {
    if (writing || drafts <= 0) return;
    setWriting(true);
    setBriefOpen(true);
    try {
      const { brief: written } = await writeBrief({
        companyName: companyName.trim() || "GlorpCo",
        industry,
        industryName: INDUSTRIES.find((i) => i.code === industry)?.name ?? "",
        companyType: brief.companyType,
        draft: brief,
      });
      setBrief(written);
      // One of three, spent whether the model or the offline writer answered —
      // the ration is on the shortcut, not on which engine happened to serve
      // it, and it is the same three on every tier: this button finishes a
      // brief, and finishing is not something Pro buys more of.
      setDrafts((d) => d - 1);
    } finally {
      setWriting(false);
    }
  };

  const setField = (key: keyof CompanyBrief, value: string) =>
    setBrief((b) => ({ ...b, [key]: value, source: "player" }));

  const valid = companyName.trim().length > 0;
  /** Every island the allowance permits is already running a live company. */
  const noRoom = living >= cap;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-[max(1.5rem,var(--nv-safe-top))] pb-[max(2rem,var(--nv-safe-bottom))]">
      {/*
        The company you already have, offered back before the form for a new
        one. It is the first thing on the screen because for a returning player
        it is the only thing they came for.
      */}
      {game.islands.length > 0 && (
        <button
          type="button"
          onClick={() => resume(() => router.push("/islands"))}
          disabled={resuming}
          className="mb-5 -ml-1 flex min-h-11 items-center gap-1.5 self-start text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] disabled:opacity-60"
        >
          <span aria-hidden>◂</span>
          {resuming
            ? "OPENING…"
            : game.islands.length === 1
              ? "BACK TO YOUR ISLAND"
              : `BACK TO YOUR ${game.islands.length} ISLANDS`}
        </button>
      )}

      <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
        THE PAPERWORK
      </p>
      <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
        Name it. Then make it worth something.
      </h1>

      {/* Who you are, before anything else. This is the only avatar decision
          the player ever makes — the wardrobe after this is earned, not
          chosen, so it is worth spending real estate on. Both options render
          at tier 1: everyone starts in the hoodie.

          Four things say which one is picked, and that is not one too many: it
          is the answer the game then uses for every pronoun for the next twelve
          months, and it used to be said by a 16% tint alone. Now the card takes
          the picked rim (.nv-pick), a tick lands in its corner, the label goes
          from grey caps to a filled pill, and the portrait NOT chosen steps
          back to 60% — a difference you can see with one card under a thumb. */}
      <fieldset className="mt-5">
        <legend className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
          WHO IS FOUNDING IT
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["male", "female"] as Gender[]).map((g) => {
            const on = gender === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                aria-pressed={on}
                aria-label={g === "male" ? "He" : "She"}
                className={`nv-gc relative flex flex-col items-center rounded-[var(--radius-card)] p-2 ${
                  on ? "nv-pick" : ""
                }`}
              >
                <PickMark on={on} className="absolute right-2 top-2" />
                <FounderPortrait
                  gender={g}
                  tier={1}
                  size={120}
                  priority
                  className={on ? "" : "opacity-60"}
                />
                <span
                  className={`rounded-[var(--radius-pill)] px-3 py-1 text-2xs font-extrabold tracking-[0.1em] ${
                    on
                      ? "bg-[var(--text-primary)] text-[var(--bg)]"
                      : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {g === "male" ? "HE" : "SHE"}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <input
        ref={inputRef}
        defaultValue=""
        maxLength={28}
        onChange={(e) => setCompanyName(e.target.value.slice(0, 28))}
        placeholder="Company name"
        autoComplete="off"
        className="mt-6 w-full border-b border-[var(--hairline)] bg-transparent pb-2 text-[1.5rem] font-extrabold tracking-[-0.01em] outline-none transition-colors focus:border-[var(--text-primary)] placeholder:font-medium placeholder:text-[var(--text-tertiary)]"
      />

      <h2 className="mt-8 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
        WHAT BUSINESS ARE YOU IN
      </h2>
      <ul className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {INDUSTRIES.map((ind) => {
          const selected = industry === ind.code;
          return (
            <li key={ind.code}>
              <button
                type="button"
                /*
                 * ── Every industry picks. The gate is at FOUND IT ──────────
                 *
                 * This used to refuse the tap outright for the eight paid
                 * industries: a dimmed card, a padlock where the pick mark
                 * goes, and an upsell that fired the moment a finger landed.
                 * Three separate ways of saying "not for you" before the
                 * player had done anything but look.
                 *
                 * It got the timing exactly backwards. A player who taps
                 * FASHION has just told us something worth knowing — that is
                 * the most engaged they will ever be with an industry they do
                 * not own — and the old grid answered by making the card look
                 * broken. So the pick is unconditional now: the card selects,
                 * the mark lands, the name appears in the sentence below like
                 * any other. `start()` is where the answer comes, and by then
                 * the player has chosen a name, a business and a brief, and
                 * the paywall is answering a question they actually asked.
                 *
                 * Nothing is given away by this. `start()` re-reads
                 * entitlements at the tap and `game.startRun` refuses again
                 * underneath it — see both. This grid was never a gate worth
                 * having; it was a gate a devtools console could open.
                 */
                onClick={() => setIndustry(ind.code)}
                aria-pressed={selected}
                /* The border stays on every state, transparent under the
                   picked rim: `.nv-pick` draws its 2px inside the box, so a
                   1px border on top of it would be a second edge in a second
                   colour, and dropping the border on selection alone would
                   move the label by a pixel every time you changed your mind. */
                className={`nv-gc flex w-full items-center justify-between gap-2 rounded-[var(--radius-card)] border px-3 py-3 text-left ${
                  selected
                    ? "nv-pick border-transparent font-bold"
                    : "border-[var(--hairline)] hover:bg-[var(--card)]"
                }`}
              >
                <span className="text-sm font-semibold leading-tight">{ind.name}</span>
                {/* Chosen, or nothing. The lock that used to share this slot is
                    gone with the rest of the select-time refusal. */}
                {selected ? <PickMark on size={18} /> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        WHAT THE COMPANY IS.

        This is new, and it is the largest thing on the screen for a reason: a
        run used to be a name and an industry code, so a player reaching The
        Tank had to invent a product, a customer and a reason to exist on the
        spot and then defend whatever they had just made up. A founder walks
        into a room having already decided. Now so does the player.

        Collapsed by default so the screen still reads as "name it and go", and
        every field is optional — but the section says out loud what it is for,
        because "you will be asked these in the Tank" is the only argument that
        makes anyone fill in a form.
      */}
      <section className="mt-8">
        {/*
          Made deliberately hard to miss. This is the one thing a first-time
          player skips and then regrets in The Tank, so the toggle is a real
          card with a title and an arrow rather than a line of 8px caps, and the
          "let the AI do it" shortcut is the FIRST thing inside — a younger
          player who doesn't want to write a paragraph sees the way out before
          the blank fields.
        */}
        <button
          type="button"
          onClick={() => setBriefOpen((v) => !v)}
          className="nv-gc flex w-full items-center justify-between gap-3 rounded-[var(--radius-card)] nv-on px-4 py-3.5 text-left shadow-[var(--e1)] ring-1 ring-[var(--hairline)]"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <PencilGlyph />
              <span className="text-[0.9375rem] font-extrabold tracking-[-0.01em] text-[var(--text-primary)]">
                Tell the sharks what your company is
              </span>
            </span>
            <span className="mt-1 block text-2xs leading-snug text-[var(--text-secondary)]">
              They ask you all of this on camera. Fill it in now — or let the AI
              start it — and it stays on screen while you pitch.
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-[var(--chip)] px-2.5 py-1 text-2xs font-extrabold tracking-[0.1em] text-[var(--text-secondary)]">
            {briefOpen ? "HIDE" : filledCount(brief) > 0 ? `${filledCount(brief)}/4` : "ADD ›"}
          </span>
        </button>

        {briefOpen && (
          <div className="mt-3 space-y-3">
            {/* The shortcut, first and unmissable. Not the accent colour — that
                belongs to FOUND IT — but a full-width button with an icon and
                plain copy a twelve-year-old reads as "press this if you're
                stuck", which is exactly who needs it. */}
            <button
              type="button"
              onClick={generate}
              disabled={writing || drafts <= 0}
              className="nv-gc flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] nv-on text-2xs font-extrabold tracking-[0.08em] text-[var(--text-primary)] shadow-[var(--e1)] ring-1 ring-[var(--hairline)] disabled:opacity-50"
            >
              <SparkleGlyph />
              {writing
                ? "WRITING A FIRST DRAFT…"
                : drafts <= 0
                  ? "THREE DRAFTS USED — THE REST IS YOURS TO WRITE"
                  : drafts < 3
                    ? `LET THE AI WRITE A FIRST DRAFT · ${drafts} LEFT`
                    : "NOT SURE? LET THE AI WRITE A FIRST DRAFT"}
            </button>
            <p className="text-2xs leading-snug text-[var(--text-tertiary)]">
              It fills in the blanks only. Anything you have already written is
              kept exactly as you wrote it, and you can edit every word after.
              Three drafts per company, on every plan.
            </p>

            <BriefField
              label="What kind of business is it? "
              hint="Burger shop. Study app. Sneaker label."
              value={brief.companyType}
              rows={1}
              max={48}
              onChange={(v) => setField("companyType", v)}
            />
            <BriefField
              label="What does it do? "
              hint="What you sell, and who buys it."
              value={brief.whatItDoes}
              rows={3}
              max={240}
              onChange={(v) => setField("whatItDoes", v)}
            />
            <BriefField
              label="What makes it different? "
              hint="The one thing a competitor cannot copy by Friday."
              value={brief.usp}
              rows={2}
              max={200}
              onChange={(v) => setField("usp", v)}
            />
            <BriefField
              label="Why would someone choose you? "
              hint="From the customer's side, not yours."
              value={brief.whyCustomers}
              rows={2}
              max={200}
              onChange={(v) => setField("whyCustomers", v)}
            />
            <BriefField
              label="What is it ultimately for? "
              hint="Optional. One plain sentence."
              value={brief.mission}
              rows={2}
              max={160}
              onChange={(v) => setField("mission", v)}
            />
          </div>
        )}
      </section>

      {profile?.onboarded && (
        <label className="mt-7 flex items-center gap-3 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={skipTutorial}
            onChange={(e) => setSkipTutorial(e.target.checked)}
            className="h-4 w-4 accent-[var(--action)]"
          />
          Skip the guided year — I&rsquo;ve done this before
        </label>
      )}

      <div className="mt-auto w-full pt-8">
        {/*
          design.md §1.5, the strictest rule in the system: the accent paints
          at most ONE element per screen, and it belongs to the primary CTA.
          On this screen founding IS the only action, so it keeps the orange —
          the step-down that used to happen when a company was already open
          belongs to the picker now, where CONTINUE is the primary thing.
        */}
        <button
          type="button"
          onClick={start}
          disabled={!valid || slotsLeft === 0 || noRoom || going}
          className="nv-gc w-full truncate rounded-[var(--radius-card)] nv-t-action px-5 py-4 text-base font-extrabold tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-35"
        >
          {going
            ? "OPENING…"
            : noRoom
              ? "NO ISLAND FREE"
              : slotsLeft === 0
                ? "NO RUNS LEFT TODAY"
                : "FOUND IT ▸"}
        </button>

        {/*
          Two limits, two sentences, and they must never be confused with each
          other. "No island free" is about how many companies you may hold at
          once and is answered by Pro or by burying one; "no runs left today"
          is about how often you may found and is answered by tomorrow. The
          old screen had one message for both, which is how a player ends up
          buying something that does not unblock them.
        */}
        {noRoom ? (
          <button
            type="button"
            onClick={() => upgrade.open("islands")}
            className="mt-2 block w-full text-center text-2xs leading-snug text-[var(--text-secondary)]"
          >
            {cap === 1 ? "One company" : `${cap} companies`} at once on the free
            plan, and all of {cap === 1 ? "it is" : "them are"} running. Bury one
            from its own screen, or{" "}
            <span className="whitespace-nowrap font-bold text-[var(--color-prestige)] underline underline-offset-4">
              see what Pro adds
            </span>
            .
          </button>
        ) : (
          slotsLeft === 0 && (
            /*
             * The one place in the app where free stops a player from playing
             * at all rather than from playing wider, so the way out is a
             * control rather than a line of grey text under a disabled button.
             */
            <button
              type="button"
              onClick={() => upgrade.open("run_slots")}
              className="mt-2 block w-full text-center text-2xs leading-snug text-[var(--text-secondary)]"
            >
              {game.islands.length > 0
                ? "One founding a day on the free plan. Your islands are still yours — open one above, or found again tomorrow. "
                : "One company a day on the free plan, and a dead one stays dead. Tomorrow, or "}
              <span className="whitespace-nowrap font-bold text-[var(--color-prestige)] underline underline-offset-4">
                three a day with Pro
              </span>
              .
            </button>
          )
        )}
      </div>
    </main>
  );
}

/** How much of the brief is answered, for the collapsed header's counter. */
function filledCount(brief: CompanyBrief): number {
  return [brief.whatItDoes, brief.usp, brief.whyCustomers, brief.mission].filter((v) =>
    v.trim(),
  ).length;
}

/**
 * One question from the brief.
 *
 * A textarea rather than an input even at one row: these are sentences, and a
 * single-line field that scrolls sideways is how you teach someone to write
 * three words. The character cap matches `sanitizeBrief` exactly so the two can
 * never disagree about what fits.
 */
function BriefField({
  label,
  hint,
  value,
  rows,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  rows: number;
  max: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-[var(--text-primary)]">{label}</span>
      <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-tertiary)]">
        {hint}
      </span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        className="mt-1.5 w-full resize-none rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-2 text-sm leading-snug text-[var(--text-primary)] outline-none ring-1 ring-[var(--hairline)] transition-shadow focus:ring-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)]"
      />
    </label>
  );
}

function PencilGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M11.5 2.5l2 2L6 12l-2.6.6L4 10l7.5-7.5z"
        stroke="var(--text-secondary)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M8 1.5l1.3 3.9L13 6.7l-3.7 1.3L8 12l-1.3-4L3 6.7l3.7-1.3L8 1.5z"
        fill="var(--text-secondary)"
      />
    </svg>
  );
}
