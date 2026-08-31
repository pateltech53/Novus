"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { SHEET_SPRING } from "@/components/ui/Motion";
import { useGame } from "@/lib/state/GameProvider";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { RookieToggle } from "@/components/ui/RookieToggle";
import { LiveActivityToggle } from "@/components/ui/LiveActivityToggle";
import {
  GlassButton,
  GlassGroup,
  GlassRow,
} from "@/components/ui/Glass";
import {
  useNativeOverlay,
  useNativeOverlayOwned,
} from "@/components/native/useNativeOverlay";
import { useResolvedTheme } from "@/lib/native/theme";
import { LegalSheet } from "@/components/LegalSheet";
import { AccountSection } from "@/components/account/AccountSection";
import { Field, RowLink, Section } from "@/components/screens/SettingsBits";
import { loadTheme, saveTheme, type ThemeChoice } from "@/lib/theme";
import { APP_VERSION, SUPPORT_EMAIL, supportMailto } from "@/lib/app-info";
import { PRIVACY, TERMS, type LegalDocument } from "@/lib/legal/documents";
import { loadAccount } from "@/lib/account";
import { openBillingPortal, restorePurchases } from "@/lib/cloud/billing";
import { isAdminAccount } from "@/lib/cloud/admin-skip";
import { fmtMoney } from "@/lib/engine/format";
import { isPro, loadEntitlements } from "@/lib/monetization";
import {
  ownedLine,
  planStanding,
  planWord,
  standingLine,
  standingNote,
  useEntitlements,
} from "@/lib/plan";
import { MANAGE_SUBSCRIPTION_NOTE, storefront, useSellsHere } from "@/lib/commerce";
import { BuyOnWeb, RestoreButton } from "@/components/upgrade/BuyOnWeb";
import { appPath } from "@/lib/native/href";

/**
 * Settings.
 *
 * Everything here is about how the player wants to be spoken to, about their
 * own identity, or about the account behind both — never about the company's
 * numbers. Nothing in this screen can change an outcome, and every destructive
 * action is behind a confirmation.
 *
 * ── Why the account half exists ─────────────────────────────────────────────
 *
 * Until this revision the only place to sign out, delete an account, read the
 * privacy policy or reach a human was the landing page — a route the shipped
 * app never opens (public/boot.html sends every cold start to /welcome, /found
 * or /play). So in the app those controls did not exist at all, and three of
 * them are not optional:
 *
 * · **Delete account** — App Store Guideline 5.1.1(v). An app with accounts
 *   must offer deletion from inside the app, not by email, not on a website.
 * · **Privacy policy and terms** — 5.1.1 and, once a subscription exists,
 *   3.1.2. Functional links, reachable without leaving the app.
 * · **Restore purchases** — 3.1.1. It is load-bearing here rather than
 *   ceremonial: nothing is sold inside a store build (lib/commerce.ts), so
 *   signing in and restoring is the only path by which Pro can ever appear on
 *   a phone.
 *
 * Sign-IN is here; sign-UP is not. Creating an account passes a Cloudflare
 * Turnstile check (app/api/auth/signup), and that widget is not loadable from
 * the `capacitor://` origin the app runs on — a create form that fails on
 * device is worse than one that was never offered. The free game needs no
 * account at all, which is what makes that an acceptable line.
 */
export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const game = useGame();
  const { run, profile } = game;

  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [founder, setFounder] = useState(profile?.founderName ?? "");
  const [company, setCompany] = useState(run?.companyName ?? "");
  const [confirmEnd, setConfirmEnd] = useState(false);

  /** Which legal document is open over this screen, if any. */
  const [legal, setLegal] = useState<LegalDocument | null>(null);

  useEffect(() => setTheme(loadTheme()), []);

  const pickTheme = (next: ThemeChoice) => {
    setTheme(next);
    saveTheme(next);
  };

  const native = useNativeOverlayOwned();
  const resolved = useResolvedTheme();

  /*
   * The screen's own chrome, drawn by UIKit.
   *
   * Settings is a full-page overlay with its own ground, which is what makes
   * it the right home for a floating glass toolbar: there is nothing for it to
   * collide with and the whole page scrolls under it, which is the one thing a
   * Liquid Glass toolbar is actually for. DONE is a glass circle in the
   * trailing cluster; the title rides on a glass plate beside it.
   */
  useNativeOverlay(
    useMemo(
      () => ({
        mode: "shown" as const,
        theme: resolved,
        title: "Settings",
        trailing: [
          { id: "done", symbol: "xmark", label: "Close settings", style: "plain" as const },
        ],
        /*
         * No segmented control in the toolbar.
         *
         * The theme picker was briefly a real glass one up here, on the
         * reasoning that the toolbar is the only part of this screen that
         * holds still and so the only part that CAN be native. That reasoning
         * is still true and it was still the wrong call: a three-way choice
         * about how the app looks is a setting, and a setting belongs in the
         * list of settings under the heading that names it — not in the
         * chrome, sixty points above the sentence explaining it, where it
         * reads as a filter over the page rather than a row of it.
         *
         * It is the plain three-up picker in the page again, on every
         * platform.
         */
      }),
      [resolved],
    ),
    { onAction: onClose },
  );

  return (
    <motion.div
      className="fixed inset-0 z-40 overflow-y-auto bg-[var(--bg)]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={SHEET_SPRING}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      {/* Centred column on desktop rather than a stretched sheet. The top pad
          clears the native toolbar where there is one, and is the plain safe
          area everywhere else — `--nv-overlay-top` is 0 off iOS. */}
      <div className="mx-auto w-full max-w-lg px-5 pt-[max(1.25rem,var(--nv-safe-top),var(--nv-overlay-top))] pb-[max(2.5rem,var(--nv-safe-bottom),calc(var(--nv-overlay-bottom)+1rem))]">
        <div className="flex items-center justify-between">
          {/* UIKit draws both of these when it owns the screen. Not rendered
              rather than hidden: a hidden button still takes a tap on iOS. */}
          {native ? null : (
            <>
              <h1 className="text-xl font-extrabold tracking-[-0.01em]">Settings</h1>
              <GlassButton
                shape="pill"
                onClick={onClose}
                className="text-2xs tracking-[0.12em]"
              >
                DONE
              </GlassButton>
            </>
          )}
        </div>

        {/* ── The way back to the other companies ────────────────────────── */}
        {/*
          First, above Appearance, because it is the only thing in this sheet
          that is navigation rather than a setting — and because /play has no
          other exit. Before islands it did not need one: there was nowhere
          else to be. Now there are up to ten somewhere-elses and this is the
          door to them.
        */}
        <IslandsSection onClose={onClose} />

        {/* ── Appearance ─────────────────────────────────────────────────── */}
        <Section label="APPEARANCE">
          {/*
            Three plain buttons, the same on iOS as everywhere else.
            Deliberately NOT the control material: the selected one is a raised
            surface with a shadow under it, which is what says "here" on a
            picker that is part of a list rather than part of the chrome.

            `gap-3`, not `gap-2`. The selected option carries a shadow, and a
            shadow needs somewhere to fall: at 8px the three panels read as one
            segmented bar with two hairlines in it, and the raised one had
            nothing to be raised ABOVE. Twelve is where three separate objects
            appear, which is what a radio group is.
          */}
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
            {(
              [
                { id: "system", label: "System" },
                { id: "light", label: "Light" },
                { id: "dark", label: "Dark" },
              ] as { id: ThemeChoice; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={theme === opt.id}
                onClick={() => pickTheme(opt.id)}
                className={`nv-press rounded-[var(--radius-row)] py-3 text-sm font-bold ${
                  theme === opt.id
                    ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[var(--e2)]"
                    : "bg-[var(--surface)] text-[var(--text-tertiary)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-2xs leading-snug text-[var(--text-tertiary)]">
            System follows your phone. Both themes are built and shipped — dark
            is not a debug mode.
          </p>
        </Section>

        {/* ── The game ───────────────────────────────────────────────────── */}
        {/*
          Rookie Mode and the sound switch, together. Both are how the player
          wants to be spoken to — this screen's own definition of itself — and
          Rookie Mode spent its first revisions on the Company sheet only
          because Settings had no section for it. The Company sheet is company
          data again; the pair lives here.
        */}
        <Section label="THE GAME">
          <div className="space-y-2">
            <RookieToggle />
            <SoundToggle />
            {/* Renders nothing off iOS, and nothing on an iPhone where Live
                Activities are already off system-wide. */}
            <LiveActivityToggle />
          </div>
        </Section>

        {/* ── Identity ───────────────────────────────────────────────────── */}
        <Section label="YOU">
          <Field
            id="founder"
            label="Your name"
            value={founder}
            onChange={setFounder}
            placeholder="Founder"
            onCommit={() => game.setFounderName(founder.trim() || "Founder")}
          />
          {run && (
            <div className="mt-2">
              <Field
                id="company"
                label="Company name"
                value={company}
                onChange={setCompany}
                placeholder={run.companyName}
                onCommit={() => game.setCompanyName(company.trim() || run.companyName)}
              />
            </div>
          )}
        </Section>

        {/* ── The account, and the way out of it ─────────────────────────── */}
        <AccountSection />

        {/* ── Pro: status, restore, and where it is managed ──────────────── */}
        <ProSection />

        {/* ── The operator's door — exists only for an admin account ──────── */}
        <AdminSection />

        {/* ── The one destructive thing about the game itself ─────────────── */}
        {run && (
          <Section label="THIS RUN">
            <div className="rounded-[var(--radius-row)] bg-[var(--surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                End {run.companyName}
              </p>
              <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
                Closes the company for good and starts a new Founder Run. Your
                legacy — best year, badges, shark respect — carries over. This
                run does not.
              </p>

              {/* `danger` is red ink on glass — dangerous without looking
                  already-pressed. `alert` is the red ground, and it belongs to
                  the second tap only. */}
              {!confirmEnd ? (
                <GlassButton
                  tone="danger"
                  onClick={() => setConfirmEnd(true)}
                  className="mt-3 text-sm"
                >
                  End this business
                </GlassButton>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-2xs font-bold tracking-[0.1em] text-[var(--alert)]">
                    THIS CANNOT BE UNDONE.
                  </p>
                  <GlassButton
                    tone="alert"
                    onClick={() => {
                      game.endRun();
                      onClose();
                    }}
                    className="text-sm font-extrabold tracking-[0.04em]"
                  >
                    Yes, end {run.companyName}
                  </GlassButton>
                  <GlassButton
                    tone="quiet"
                    onClick={() => setConfirmEnd(false)}
                    className="h-11 text-sm"
                  >
                    Keep going
                  </GlassButton>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── Legal, support, and which build this is ─────────────────────── */}
        <Section label="ABOUT NOVUS">
          {/* One pane of glass with three controls cut out of it, rather than
              three panes — the web's answer to `UIGlassContainerEffect`, and
              the reason this list costs one compositor pass and not three. */}
          <GlassGroup>
            <GlassRow label="Privacy policy" onClick={() => setLegal(PRIVACY)} />
            <GlassRow label="Terms of use" onClick={() => setLegal(TERMS)} />
            {/* A real inbox, and the same address the store listing gives as
                its support URL. Reviewers do write to it. */}
            <RowLink
              label="Contact support"
              value={SUPPORT_EMAIL}
              href={supportMailto("Novus — help")}
            />
          </GlassGroup>
          <p className="tnum mt-2 text-2xs text-[var(--text-tertiary)]">
            Novus {APP_VERSION} · built at LaunchX Flagship, San Diego 2026
          </p>
        </Section>
      </div>

      {legal && <LegalSheet doc={legal} onClose={() => setLegal(null)} />}
    </motion.div>
  );
}

// ── Operator ─────────────────────────────────────────────────────────────────

/**
 * The one place the app links to /admin.
 *
 * The console is deliberately linked from nowhere public — on the web an
 * operator types the URL, but the app has no address bar, so without this row
 * the console simply does not exist on a phone. It appears only when the
 * signed-in account's role says admin (one cached request per tab, a fast 404
 * for anyone else — see lib/cloud/admin-skip.ts), and it asks nothing at all
 * for a player with no account.
 *
 * The navigation names the file (appPath): a document navigation in the shell
 * resolves extensionless paths to the bundle's ROOT index.html — the
 * marketing page — which is both the wrong screen and, in a store build, one
 * the app must not show (lib/native/href.ts has the whole story).
 */
function AdminSection() {
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (!loadAccount()?.email) return;
    let alive = true;
    void isAdminAccount().then((yes) => {
      if (alive && yes) setAdmin(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!admin) return null;

  return (
    <Section label="OPERATOR">
      <GlassGroup>
        <GlassRow
          label="Admin console"
          onClick={() => {
            window.location.href =
              storefront() === "web" ? "/admin" : appPath("/admin");
          }}
        />
      </GlassGroup>
      <p className="mt-2 text-2xs leading-snug text-[var(--text-tertiary)]">
        Only this account sees this row. Users, gifts, chapters, the board
        queue, the numbers — and the view switch that plays this account as
        free or Pro.
      </p>
    </Section>
  );
}

// ── Pro ──────────────────────────────────────────────────────────────────────

/**
 * What this account owns, and the two controls that go with it.
 *
 * There is no price and no buy button anywhere in here, on any platform: in a
 * store build that would be Guideline 3.1.1, and on the web the pricing screen
 * is a screen rather than a Settings row. What Settings owes a player who has
 * already paid is different — proof it arrived, a way to get it back on a new
 * device, and a way to cancel.
 *
 * ── Proof, in the detail the receipt actually has ──────────────────────────
 *
 * This row said "Pro is on" and stopped there, which answers less than it looks
 * like it does. It did not say WHICH plan — so a player deciding whether to
 * switch, or working out what the charge on the card is for, had to open the
 * billing portal to find out — and it said nothing whatsoever about anything
 * bought outside a subscription. An island and an industry pack are purchases
 * that attach to this account exactly as Pro does, and until now the only place
 * either of them was visible was indirectly, as a number on the islands screen
 * or an industry that happened not to be locked. A receipt that omits what you
 * bought is not a receipt. Both come from lib/plan.ts, which is also what the
 * front door and the price list read, so the three cannot word it differently.
 */
function ProSection() {
  const game = useGame();
  const sellsHere = useSellsHere();

  const [pro, setPro] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /* The detail behind `pro`: which plan, and what was bought once. Live rather
     than read at mount, because Restore below changes it without leaving the
     screen — as does the once-a-minute heartbeat. Null until the client has
     read localStorage, which is why every line built from it is conditional. */
  const entitlements = useEntitlements();
  const standing = entitlements ? planStanding(entitlements) : null;
  const bought = entitlements ? ownedLine(entitlements) : null;

  useEffect(() => setPro(isPro(loadEntitlements())), []);

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    const result = await restorePurchases();
    setBusy(false);

    if (!result.ok) {
      setMessage(
        result.reason === "signed-out"
          ? "Sign in first — purchases attach to your Novus account, not to this device."
          : result.reason === "not-configured"
            ? "Purchases are not switched on for this build."
            : "Could not reach the server. Check your connection and try again.",
      );
      return;
    }

    setPro(result.pro);
    // A run started before Pro landed still carries pro:false. The entitlement
    // is the receipt and this is the post-purchase path, so the run adopts it.
    if (result.pro && game.run && !game.run.pro) game.setPro(true);

    setMessage(
      result.pro
        ? result.changed
          ? "Novus Pro restored. Every industry and room is open."
          : "Novus Pro is already on for this device."
        : "Nothing to restore on this account.",
    );
  };

  return (
    <Section label="NOVUS PRO">
      <div className="rounded-[var(--radius-row)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {pro ? "Pro is on" : "Free"}
          </p>
          {/* The chip carries the cadence, because it is already the all-caps
              word beside "Pro is on" and ACTIVE was the least specific thing it
              could have said. Back to ACTIVE for a Pro with no plan of its own
              — a chapter seat, an operator account — and while the entitlements
              are still unreadable. */}
          <span
            className={`text-2xs font-bold tracking-[0.12em] ${
              pro ? "text-[var(--color-prestige)]" : "text-[var(--text-tertiary)]"
            }`}
          >
            {pro
              ? standing?.plan
                ? planWord(standing.plan)
                : "ACTIVE"
              : "THE WHOLE GAME"}
          </span>
        </div>

        {/* This account's own numbers, not the tier's brochure copy: the
            island count here includes any that were bought, which is the
            plainest proof a one-time purchase landed. */}
        {entitlements ? (
          <p className="tnum mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
            {standingLine(entitlements)}
          </p>
        ) : null}

        <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
          {standing
            ? standingNote(standing)
            : pro
              ? "Twelve industries, The Room, three runs a day, the long wardrobe."
              : "Free is the whole game — same year, same pitch, same panel, same board. Pro adds content, never an advantage."}
        </p>

        {/* Everything bought outright, by name. Its own line under a rule,
            because a one-time purchase is a different fact from the plan and
            outlives it: cancelling Pro does not take an island back. */}
        {bought ? (
          <p className="mt-2 border-t border-[var(--hairline)] pt-2 text-2xs leading-snug text-[var(--text-secondary)]">
            <span className="font-bold tracking-[0.1em] text-[var(--text-tertiary)]">BOUGHT </span>
            {bought}
          </p>
        ) : null}

        {/* A store build cannot take the money, and since the 1.0(3)
            rejection it does not point at anywhere that can either — the
            component states where Pro lives, no price, no link (see
            BuyOnWeb.tsx), and Restore below is the action. Same component as
            the Pro sheet and the paywall, so every surface says the same
            thing. */}
        {!pro && sellsHere === false ? <BuyOnWeb className="mt-3" /> : null}

        <RestoreButton busy={busy} onRestore={() => void restore()} className="mt-3" />

        {/* On the web this opens Stripe's portal — cancel, switch plan, update
            card, receipts. In a store build there is nothing for the app to
            open, so it states where the subscription lives instead of offering
            a button that cannot work.

            Gated on there being a subscription rather than on Pro being on. A
            chapter seat and an operator account are both Pro with no plan of
            their own behind them, and the portal opens on nothing for either —
            `openBillingPortal` answers false and the row does nothing at all.
            Falls back to the bare flag only while the detail is still
            unreadable, which is the behaviour this row has always had. */}
        {(standing ? standing.via === "subscription" : pro) &&
          (sellsHere === true ? (
            <GlassButton
              onClick={() => void openBillingPortal()}
              className="mt-2 text-sm"
            >
              Manage subscription
            </GlassButton>
          ) : sellsHere === false ? (
            <p className="mt-2 text-2xs leading-snug text-[var(--text-tertiary)]">
              {MANAGE_SUBSCRIPTION_NOTE}
            </p>
          ) : null)}

        {message ? (
          <p role="status" className="mt-2 text-2xs leading-relaxed text-[var(--text-secondary)]">
            {message}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

// ── Furniture ────────────────────────────────────────────────────────────────

/**
 * Leave this company for the archipelago, and switch straight to another.
 *
 * Both, on purpose. "Back to your islands" is the destination a player asks
 * for by name; the rows under it are the two-tap version of the same trip,
 * because the common case with two companies open is going to the OTHER one
 * and a picker in between is a screen you pass through rather than use.
 *
 * `switchIsland` before the navigation, not after: it is synchronous, and
 * doing it here means /play mounts with the right company already in context
 * rather than opening the old one and swapping it under the player.
 *
 * ── Why this one pushes rather than navigates ───────────────────────────────
 *
 * Every other exit from this screen empties the device — signing out, deleting
 * the account — and has to load a fresh document so nothing carries the old
 * player's values across in memory. This one changes nothing: it is a trip
 * between two screens of the same game, and /found already makes the same trip
 * with a router push.
 *
 * It USED to load a document too, and the cost was not the reload. A document
 * navigation destroys the React tree without running one effect cleanup, and
 * this screen's chrome is a UIKit view owned by the view controller rather
 * than by the page — so Settings' toolbar and its account dock followed the
 * player to the islands and stayed there, over a screen that had never
 * declared any chrome, with the dock sitting where the play screen's ADVANCE
 * capsule lands. Unmounting properly is what takes them down.
 */
function IslandsSection({ onClose }: { onClose: () => void }) {
  const game = useGame();
  const router = useRouter();
  const others = game.islands.filter((i) => i.slot !== game.island);

  return (
    <Section label={others.length === 0 ? "YOUR ISLAND" : "YOUR ISLANDS"}>
      <GlassButton
        onClick={() => {
          onClose();
          router.push("/islands");
        }}
        className="text-sm font-bold"
      >
        ◂ Back to your islands
      </GlassButton>

      {others.length > 0 && (
        <ul className="mt-2 space-y-2">
          {others.map((island) => (
            <li key={island.slot}>
              <button
                type="button"
                onClick={() => {
                  game.switchIsland(island.slot);
                  onClose();
                }}
                className="nv-press flex w-full items-center gap-3 rounded-[var(--radius-row)] bg-[var(--surface)] p-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[var(--text-primary)]">
                    {island.companyName}
                  </p>
                  <p className="tnum mt-0.5 truncate text-2xs text-[var(--text-tertiary)]">
                    {island.alive
                      ? `Year ${island.year} · ${fmtMoney(island.valuation)}`
                      : `Ended in year ${island.year} · peak ${fmtMoney(island.peakValuation)}`}
                  </p>
                </div>
                <span aria-hidden className="text-2xs text-[var(--text-tertiary)]">
                  ▸
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}


