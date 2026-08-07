"use client";

import { useEffect, useState } from "react";
import { GlassButton } from "@/components/ui/Glass";
import { useNativeOverlayDock } from "@/components/native/useNativeOverlay";
import { loadAccount, type Account } from "@/lib/account";
import { PROVIDER_LABEL, type OAuthProvider } from "@/lib/auth/providers";
import { ChooseName } from "@/components/ChooseName";
import {
  deleteAccount,
  nativeProviderSignIn,
  requestPasswordReset,
  signIn,
  signOut,
} from "@/lib/cloud/auth";
import { restoreForSignIn } from "@/lib/cloud/sync";
import { entryRoute } from "@/lib/entry";
import { storefront } from "@/lib/commerce";
import { appPath } from "@/lib/native/href";
import { Field, Section } from "@/components/screens/SettingsBits";

/**
 * The account, as its own module.
 *
 * It was the top third of SettingsScreen.tsx, reachable only from inside a
 * company — so a brand-new player on a new phone had no way to say "I already
 * have an account" before founding one. The welcome screen offers it now, and
 * a screen that only wants a sign-in form must not pull the operator console
 * and the billing card in with it.
 */

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
export function AccountSection() {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** The reset link's own flag and its own line, for the reason forgot() below
   *  gives — and the same split the front door now makes. */
  const [sending, setSending] = useState(false);
  const [resetSaid, setResetSaid] = useState<{ ok: boolean; text: string; n: number } | null>(null);
  const sayReset = (ok: boolean, text: string) =>
    setResetSaid((prev) => ({ ok, text, n: (prev?.n ?? 0) + 1 }));

  /**
   * Google and Apple, when this build can actually do them.
   *
   * Empty unless the app is running natively AND its project carries the social
   * login plugin, which is the only configuration where the token can come back
   * into the app rather than into Safari (lib/cloud/native-oauth.ts). The web
   * redirect flow is deliberately not offered here as a fallback: it would hand
   * the session to a browser this webview cannot read, and the player would
   * come back to a settings sheet exactly as signed out as they left it.
   */
  const [providers, setProviders] = useState<readonly OAuthProvider[]>([]);
  /** Set when a provider sign-in turns out to have created the account. */
  const [naming, setNaming] = useState<{ suggested: string | null } | null>(null);

  // localStorage, so never during render — this screen can be prerendered into
  // the static export the app ships from.
  useEffect(() => {
    setAccount(loadAccount());
    setReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    void import("@/lib/cloud/native-oauth").then(({ nativeAuthAvailable, availableProviders }) => {
      if (!alive || !nativeAuthAvailable()) return;
      setProviders(availableProviders());
    });
    return () => {
      alive = false;
    };
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
    /*
     * The literal used to be "/play" — the route `entryRoute()` returned for
     * anyone with a company. It answers "/islands" now, and the two branches
     * below want opposite things from it: the web sends a player with saves to
     * the marketing page, and the app cannot (that page carries prices a store
     * build may not show at all, Guideline 3.1.1) so it sends them to onboarding.
     */
    const route = entryRoute();
    if (storefront() === "web") {
      window.location.href = route === "/islands" ? "/" : route;
      return;
    }
    window.location.href = appPath(route === "/islands" ? "/welcome" : route);
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
    /*
     * The account's saves land BEFORE the route is chosen.
     *
     * Two bugs sat on this line. signIn() empties the device on purpose — it
     * belonged to whoever was here before — so `entryRoute()` asked straight
     * afterwards reads an empty device and answers "/welcome" for everyone:
     * the returning player this form exists for was marched through the
     * onboarding they finished a term ago, with their company arriving from
     * the server a second later onto a screen that had already decided. The
     * web front door dodges this by handing the decision to AccountGate, which
     * waits; the app has no front door, so the wait happens here.
     *
     * And the app's navigation has to name a file, not a directory. This line
     * used to append a trailing slash, on the belief that the shell resolved a
     * directory to its index.html. It does the opposite: an extensionless path
     * gets the bundle's ROOT index.html, which in this export is the marketing
     * page. See lib/native/href.ts — that belief is what put an account gate
     * inside the app and made every way out of it lead back to it.
     */
    await restoreForSignIn();
    const route = entryRoute();
    window.location.href = storefront() === "web" ? route : appPath(route);
  };

  /**
   * Continue with Google, or with Apple, without leaving the app.
   *
   * The system sheet returns a signed token in this process, so unlike the web
   * there is no round trip to survive — which is the whole reason the app takes
   * this route rather than the redirect one. What happens afterwards is the
   * same fork every sign-in path in this app has:
   *
   * · **known** — a returning player. The device was emptied by the sign-in
   *   (it belonged to whoever used this app before), so the account's saves are
   *   pulled BEFORE the route is chosen, exactly as submitSignIn does above and
   *   for the same reason: `entryRoute()` on an empty device answers "/welcome"
   *   for everybody, and marches a returning player through onboarding they
   *   finished a term ago.
   * · **new** — the account was created just now, so it needs a name. That is
   *   one screen, and this sheet is already on top of the game, so it happens
   *   here rather than by navigating out to /auth/callback and back.
   */
  const useProvider = async (provider: OAuthProvider) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await nativeProviderSignIn(provider);
    if (!result.ok) {
      setBusy(false);
      // A closed sheet is a change of mind, not a failure.
      if (result.reason !== "cancelled") setError(result.message);
      return;
    }

    if (result.state === "new") {
      setBusy(false);
      // "Founder" is the placeholder written when the provider offered no name.
      // Prefilling with it would invite the player to accept it, which is the
      // opposite of what the naming step is for.
      setNaming({
        suggested:
          result.suggestedName && result.suggestedName !== "Founder" ? result.suggestedName : null,
      });
      return;
    }

    await restoreForSignIn();
    const route = entryRoute();
    window.location.href = storefront() === "web" ? route : appPath(route);
  };

  /**
   * Ask for a reset email. Same repair as the front door's forgot().
   *
   * This button was better wired than that one — it did at least dim itself —
   * but it borrowed the sign-in form's `busy`, so the only control that changed
   * its WORDS was the SIGN IN button above it, which announced an action nobody
   * had asked for. And the answer rendered outside the card entirely, below the
   * three-line paragraph about making accounts at novuspitch.com: seventy-odd
   * pixels from the button, on a sheet that scrolls, with nothing to bring it
   * into view. Its own flag, its own label, its own line under the button.
   */
  const forgot = async () => {
    if (sending) return;
    setError(null);
    setNotice(null);
    // Gone the moment a new attempt starts — a stale answer above a button that
    // says it is sending is the same confusion this whole change is about.
    setResetSaid(null);

    if (!email.trim()) {
      sayReset(false, "Enter your email above first, then tap this again.");
      return;
    }

    setSending(true);
    try {
      const result = await requestPasswordReset(email.trim());
      sayReset(result.ok, result.message);
    } finally {
      setSending(false);
    }
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

  /*
   * The account's own controls, in the native glass dock.
   *
   * Both of these are destructive-adjacent and both keep their two-tap
   * confirmation — the dock does not make them easier to hit by accident, it
   * makes them reachable without scrolling past everything else in Settings to
   * find them. `delete` only takes the red ground on the SECOND tap, which is
   * the same rule the DOM button below follows: `danger` is red ink asking a
   * question, `destructive` is red ground carrying out the answer.
   *
   * Null when signed out — there is nothing to sign out OF, and a dock that
   * kept saying so would be a bar at the bottom of the screen advertising an
   * action that cannot run.
   */
  const nativeDock = useNativeOverlayDock(
    account?.email
      ? [
          {
            id: "acct-signout",
            title: "Sign out",
            label: "Sign out of this account",
            style: "plain" as const,
            enabled: !busy,
          },
          {
            id: "acct-delete",
            title: confirmDelete ? "Yes, delete" : "Delete account",
            label: confirmDelete
              ? "Confirm — delete my account for good"
              : "Delete my account",
            style: confirmDelete ? ("destructive" as const) : ("plain" as const),
            enabled: !busy,
          },
        ]
      : null,
    (id) => (id === "acct-signout" ? void leaveAccount() : void remove()),
  );

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

            {/* UIKit's dock carries this when it is up. Not rendered rather
                than hidden — a hidden button still takes a tap on iOS. */}
            {nativeDock ? null : (
              <GlassButton
                onClick={() => void leaveAccount()}
                disabled={busy}
                className="mt-3 text-sm"
              >
                Sign out
              </GlassButton>
            )}
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
            {nativeDock ? null : (
              <GlassButton
                tone={confirmDelete ? "alert" : "danger"}
                onClick={() => void remove()}
                disabled={busy}
                className={`mt-2.5 text-sm ${
                  confirmDelete ? "font-extrabold tracking-[0.04em]" : ""
                }`}
              >
                {confirmDelete ? "Yes, delete my account" : "Delete my account"}
              </GlassButton>
            )}
            {/* The way back out of the confirmation stays in the page on every
                platform. The dock holds two controls and the second tap is one
                of them; a third would make the row that carries "delete
                everything" the busiest thing on the screen. */}
            {confirmDelete && (
              <GlassButton
                tone="quiet"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="mt-2 h-11 text-sm"
              >
                Keep my account
              </GlassButton>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-[var(--radius-row)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {naming
              ? "What should we call you?"
              : account
                ? `Playing as ${account.displayName}`
                : "Playing without an account"}
          </p>
          <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
            {naming
              ? "Your account is made. This is the name the game uses — your own invention, not the one on your Google or Apple account."
              : "The whole free game works this way, and nothing about it is sent to us. An account backs your companies up so they survive a new phone, and it is what Novus Pro attaches to."}
          </p>

          {naming ? (
            <div className="mt-3">
              <ChooseName
                suggested={naming.suggested}
                submitLabel="SAVE AND PLAY"
                onDone={() => {
                  // A new account KEEPS this device (lib/cloud/auth.ts), so the
                  // company the player already had open is still here and is
                  // where they belong. No restoreForSignIn: there is nothing on
                  // the server yet that this device does not have.
                  const route = entryRoute();
                  window.location.href = storefront() === "web" ? route : appPath(route);
                }}
              />
            </div>
          ) : !open ? (
            <>
              <GlassButton onClick={() => setOpen(true)} className="mt-3 text-sm">
                Sign in
              </GlassButton>

              {/* Only in a build whose native project has the plugin — see the
                  `providers` state. There is no web fallback here on purpose:
                  a redirect would leave the session in Safari's cookie jar,
                  where this webview cannot reach it. */}
              {providers.map((provider) => (
                <GlassButton
                  key={provider}
                  onClick={() => void useProvider(provider)}
                  disabled={busy}
                  className="mt-2 text-sm"
                >
                  Continue with {PROVIDER_LABEL[provider]}
                </GlassButton>
              ))}
            </>
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

              {/* The one control on this card that asks for something, so the
                  one that takes the accent into the material. */}
              <GlassButton
                type="submit"
                tone="action"
                disabled={busy}
                className="mt-3 text-sm font-extrabold tracking-[0.04em]"
              >
                {busy ? "SIGNING IN…" : "SIGN IN"}
              </GlassButton>
              <GlassButton
                tone="quiet"
                onClick={() => void forgot()}
                disabled={busy || sending}
                className="mt-2 h-11 text-xs"
              >
                {sending ? "SENDING RESET LINK…" : "Forgot your password?"}
              </GlassButton>

              {/* Inside the card and directly under the button, rather than
                  with the shared error/notice below — those sit past the
                  paragraph beneath this form, far enough down a scrolling sheet
                  to be off screen at the moment the button is pressed. */}
              {resetSaid ? (
                <p
                  key={resetSaid.n}
                  role="status"
                  className={`mt-2 text-2xs leading-snug ${
                    resetSaid.ok ? "text-[var(--text-secondary)]" : "text-[var(--alert)]"
                  }`}
                >
                  {resetSaid.text}
                </p>
              ) : null}

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

