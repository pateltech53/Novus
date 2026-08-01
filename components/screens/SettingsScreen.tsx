"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { LegalSheet } from "@/components/LegalSheet";
import { loadTheme, saveTheme, type ThemeChoice } from "@/lib/theme";
import { APP_VERSION, SUPPORT_EMAIL, supportMailto } from "@/lib/app-info";
import { PRIVACY, TERMS, type LegalDocument } from "@/lib/legal/documents";
import { loadAccount, type Account } from "@/lib/account";
import {
  deleteAccount,
  requestPasswordReset,
  signIn,
  signOut,
} from "@/lib/cloud/auth";
import { openBillingPortal, restorePurchases } from "@/lib/cloud/billing";
import { isPro, loadEntitlements } from "@/lib/monetization";
import { MANAGE_SUBSCRIPTION_NOTE, storefront, useSellsHere } from "@/lib/commerce";
import { entryRoute } from "@/lib/entry";

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
 * app never opens (native/boot.html sends every cold start to /welcome, /found
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

  return (
    <motion.div
      className="fixed inset-0 z-40 overflow-y-auto bg-[var(--bg)]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      {/* Centred column on desktop rather than a stretched sheet. */}
      <div className="mx-auto w-full max-w-lg px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-extrabold tracking-[-0.01em]">Settings</h1>
          <button
            type="button"
            onClick={onClose}
            className="nv-press h-10 rounded-[var(--radius-pill)] px-4 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
          >
            DONE
          </button>
        </div>

        {/* ── Appearance ─────────────────────────────────────────────────── */}
        <Section label="APPEARANCE">
          <div
            role="radiogroup"
            aria-label="Theme"
            className="grid grid-cols-3 gap-2"
          >
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

        {/* ── Sound ──────────────────────────────────────────────────────── */}
        <Section label="SOUND">
          <SoundToggle />
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

              {!confirmEnd ? (
                <button
                  type="button"
                  onClick={() => setConfirmEnd(true)}
                  className="nv-press mt-3 h-12 w-full rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-sm font-bold text-[var(--alert)]"
                >
                  End this business
                </button>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-2xs font-bold tracking-[0.1em] text-[var(--alert)]">
                    THIS CANNOT BE UNDONE.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      game.endRun();
                      onClose();
                    }}
                    className="nv-press h-12 w-full rounded-[var(--radius-pill)] bg-[var(--alert)] text-sm font-extrabold tracking-[0.04em] text-[var(--on-action)]"
                  >
                    Yes, end {run.companyName}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEnd(false)}
                    className="nv-press h-11 w-full rounded-[var(--radius-pill)] text-sm font-bold text-[var(--text-secondary)]"
                  >
                    Keep going
                  </button>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── Legal, support, and which build this is ─────────────────────── */}
        <Section label="ABOUT NOVUS">
          <div className="divide-y divide-[var(--hairline)] overflow-hidden rounded-[var(--radius-row)] bg-[var(--surface)]">
            <RowButton label="Privacy policy" onClick={() => setLegal(PRIVACY)} />
            <RowButton label="Terms of use" onClick={() => setLegal(TERMS)} />
            {/* A real inbox, and the same address the store listing gives as
                its support URL. Reviewers do write to it. */}
            <RowLink
              label="Contact support"
              value={SUPPORT_EMAIL}
              href={supportMailto("Novus — help")}
            />
          </div>
          <p className="tnum mt-2 text-2xs text-[var(--text-tertiary)]">
            Novus {APP_VERSION} · built at LaunchX Flagship, San Diego 2026
          </p>
        </Section>
      </div>

      {legal && <LegalSheet doc={legal} onClose={() => setLegal(null)} />}
    </motion.div>
  );
}

// ── Account ──────────────────────────────────────────────────────────────────

/**
 * Signed out, this is a sign-in form. Signed in, it is the account's own
 * controls — including the delete button Guideline 5.1.1(v) requires.
 *
 * Both halves reload rather than flip state on success, for the reason
 * lib/cloud/auth.ts spells out: signing in and deleting both EMPTY the device,
 * and every screen holding those values in memory has to re-read them. A
 * setState here would leave the last player's companies on screen under the
 * new player's name.
 */
function AccountSection() {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // localStorage, so never during render — this screen can be prerendered into
  // the static export the app ships from.
  useEffect(() => {
    setAccount(loadAccount());
    setReady(true);
  }, []);

  /**
   * Where a player lands after signing out or deleting.
   *
   * A full navigation, not a route push: both paths EMPTY the device, and every
   * screen holding those values in memory has to re-read them.
   *
   * On the web that is the front door, which is where signing back in lives. In
   * the app it must not be: "/" is the marketing landing, it is in the bundle,
   * and it carries the plan prices and checkout buttons that a store build is
   * not allowed to show at all (Guideline 3.1.1). So the app goes to the
   * ordinary entry route instead — with the trailing slash the shell's file
   * server needs to resolve a directory.
   */
  const leave = () => {
    if (storefront() === "web") {
      window.location.href = entryRoute() === "/play" ? "/" : entryRoute();
      return;
    }
    const route = entryRoute();
    window.location.href = `${route === "/play" ? "/welcome" : route}/`;
  };

  const submitSignIn = async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      setError("Enter the email and password for your account.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await signIn(email.trim(), password);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    // signIn wiped the device and pulled nothing yet; the reload is what makes
    // the account's own saves appear.
    window.location.href = entryRoute();
  };

  const forgot = async () => {
    if (busy) return;
    if (!email.trim()) {
      setError("Enter your email first, then tap this again.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(await requestPasswordReset(email.trim()));
    setBusy(false);
  };

  const leaveAccount = async () => {
    if (busy) return;
    setBusy(true);
    await signOut();
    leave();
  };

  /**
   * Delete, on the second tap.
   *
   * Two taps rather than a modal: the confirmation is the label changing to
   * say what is about to happen, which is harder to click through on autopilot
   * than a dialog with an OK button. Same pattern as the front door, and as
   * "End this business" above.
   */
  const remove = async () => {
    if (busy) return;
    if (!confirmDelete) {
      setError(null);
      setNotice(null);
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    const result = await deleteAccount();
    if (!result.ok) {
      setBusy(false);
      setConfirmDelete(false);
      setError(result.message ?? "Could not delete the account.");
      return;
    }
    leave();
  };

  // Nothing until the device has been read: a sign-in form that flashes for a
  // frame in front of a signed-in player reads as having been signed out.
  if (!ready) return null;

  return (
    <Section label="ACCOUNT">
      {account?.email ? (
        <>
          <div className="rounded-[var(--radius-row)] bg-[var(--surface)] p-4">
            <p className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
              SIGNED IN AS
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-[var(--text-primary)]">
              {account.email}
            </p>
            <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
              Your companies are backed up to this account, so they survive a
              new phone. Signing out clears them from this device — the
              account keeps its copy.
            </p>

            <button
              type="button"
              onClick={() => void leaveAccount()}
              disabled={busy}
              className="nv-press mt-3 h-12 w-full rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-sm font-bold text-[var(--text-primary)] disabled:opacity-50"
            >
              Sign out
            </button>
          </div>

          {/* Deletion is its own card, below the ordinary controls, in the
              alert colour — it erases the account AND everything on this
              device, and it is not undoable. */}
          <div className="mt-2 rounded-[var(--radius-row)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Delete account
            </p>
            <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
              Erases your email, your progress and every company you have run —
              from this device and from our servers. Immediately, for real, and
              with no way back. A Pro subscription is cancelled with it.
            </p>

            {confirmDelete && (
              <p className="mt-2.5 text-2xs font-bold tracking-[0.1em] text-[var(--alert)]">
                THIS CANNOT BE UNDONE.
              </p>
            )}
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className={`nv-press mt-2.5 h-12 w-full rounded-[var(--radius-pill)] text-sm font-bold disabled:opacity-50 ${
                confirmDelete
                  ? "bg-[var(--alert)] font-extrabold tracking-[0.04em] text-[var(--on-action)]"
                  : "bg-[var(--surface-overlay)] text-[var(--alert)]"
              }`}
            >
              {confirmDelete ? "Yes, delete my account" : "Delete my account"}
            </button>
            {confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="nv-press mt-2 h-11 w-full rounded-[var(--radius-pill)] text-sm font-bold text-[var(--text-secondary)]"
              >
                Keep my account
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-[var(--radius-row)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {account ? `Playing as ${account.displayName}` : "Playing without an account"}
          </p>
          <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
            The whole free game works this way, and nothing about it is sent to
            us. An account backs your companies up so they survive a new phone,
            and it is what Novus Pro attaches to.
          </p>

          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="nv-press mt-3 h-12 w-full rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-sm font-bold text-[var(--text-primary)]"
            >
              Sign in
            </button>
          ) : (
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitSignIn();
              }}
            >
              <Field
                id="account-email"
                label="Email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                type="email"
                inputMode="email"
                autoComplete="email"
                enterKeyHint="next"
              />
              <div className="mt-2">
                <Field
                  id="account-password"
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Your password"
                  type="password"
                  autoComplete="current-password"
                  enterKeyHint="go"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="nv-press mt-3 h-12 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-sm font-extrabold tracking-[0.04em] text-[var(--on-action)] disabled:opacity-50"
              >
                {busy ? "SIGNING IN…" : "SIGN IN"}
              </button>
              <button
                type="button"
                onClick={() => void forgot()}
                disabled={busy}
                className="nv-press mt-2 h-11 w-full rounded-[var(--radius-pill)] text-xs font-bold text-[var(--text-secondary)]"
              >
                Forgot your password?
              </button>
              <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
                New accounts are made at novuspitch.com, where the human check
                can run. Signing in here brings that account&rsquo;s companies
                onto this device.
              </p>
            </form>
          )}
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-2xs leading-relaxed text-[var(--alert)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-2xs leading-relaxed text-[var(--text-secondary)]">
          {notice}
        </p>
      ) : null}
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
 */
function ProSection() {
  const game = useGame();
  const sellsHere = useSellsHere();

  const [pro, setPro] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {pro ? "Pro is on" : "Free"}
          </p>
          <span
            className={`text-2xs font-bold tracking-[0.12em] ${
              pro ? "text-[var(--color-prestige)]" : "text-[var(--text-tertiary)]"
            }`}
          >
            {pro ? "ACTIVE" : "THE WHOLE GAME"}
          </span>
        </div>
        <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
          {pro
            ? "Twelve industries, The Room, three runs a day, the long wardrobe."
            : "Free is the whole game — same year, same pitch, same panel, same board. Pro adds content, never an advantage."}
        </p>

        <button
          type="button"
          onClick={() => void restore()}
          disabled={busy}
          className="nv-press mt-3 h-12 w-full rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-sm font-bold text-[var(--text-primary)] disabled:opacity-50"
        >
          {busy ? "CHECKING…" : "Restore purchases"}
        </button>

        {/* On the web this opens Stripe's portal — cancel, switch plan, update
            card, receipts. In a store build there is nothing for the app to
            open, so it states where the subscription lives instead of offering
            a button that cannot work. */}
        {pro &&
          (sellsHere === true ? (
            <button
              type="button"
              onClick={() => void openBillingPortal()}
              className="nv-press mt-2 h-12 w-full rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-sm font-bold text-[var(--text-primary)]"
            >
              Manage subscription
            </button>
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
        {label}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A 48px list row. The height is the tap target, not the text. */
const ROW =
  "nv-press flex h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-[var(--text-primary)]";

function RowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={ROW}>
      {label}
      <span aria-hidden className="text-[var(--text-tertiary)]">›</span>
    </button>
  );
}

function RowLink({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <a href={href} className={ROW}>
      {label}
      <span className="truncate text-2xs font-bold text-[var(--text-tertiary)]">
        {value}
      </span>
    </a>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  onCommit,
  type = "text",
  inputMode,
  autoComplete = "off",
  enterKeyHint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onCommit?: () => void;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>["enterKeyHint"];
}) {
  // The name fields cap at 28 to keep a masthead one line; an email or a
  // password has no business being truncated.
  const capped = type === "text";
  return (
    <label
      htmlFor={id}
      className="block rounded-[var(--radius-row)] bg-[var(--surface)] px-4 py-3"
    >
      <span className="block text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        {label.toUpperCase()}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(capped ? e.target.value.slice(0, 28) : e.target.value)}
        onBlur={onCommit}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        enterKeyHint={enterKeyHint}
        autoCapitalize={type === "email" ? "none" : undefined}
        autoCorrect={type === "email" ? "off" : undefined}
        spellCheck={type === "email" ? false : undefined}
        className="mt-1 w-full bg-transparent text-base font-semibold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
      />
    </label>
  );
}
