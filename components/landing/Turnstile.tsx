"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The human check on the sign-up form.
 *
 * ── The one third-party script in the app, and how it is contained ─────────
 *
 * docs/LEADERBOARD.md §1.4 and §9.6 rule out third-party scripts on pages
 * shown to minors, and the rest of this app holds that line — Supabase and
 * Stripe are both reached through our own origin for exactly this reason.
 *
 * This is the deliberate exception, kept as small as it can be:
 *
 *   · It loads ONLY when the sign-up form is open. A player who reads the
 *     landing page, or who plays the free game without an account, never
 *     contacts Cloudflare — the script tag does not exist for them.
 *   · Turnstile sets no cookies and builds no cross-site profile. It is the
 *     only widget of its kind that is defensible in front of children;
 *     reCAPTCHA is an ad company's tracker with a security badge on.
 *   · Unconfigured means absent. With no site key this renders nothing, and
 *     the server requires nothing (lib/auth/turnstile.ts).
 *
 * ── Why the script is not in the root layout ───────────────────────────────
 *
 * Putting it there would be simpler and would defeat the whole point: every
 * visitor to every page would be announced to Cloudflare, including the ones
 * who never sign up. Loading it on demand costs one small fetch at the moment
 * a person has already decided to make an account.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export const turnstileEnabled = (): boolean => SITE_KEY.length > 0;

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Loaded once per page, however many widgets ask for it. */
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile")));
      if (window.turnstile) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Renders the widget and reports the token upward.
 *
 * `onToken(null)` on expiry or error, so the form disables its button again
 * rather than submitting something the server will reject.
 */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The callback identity must not re-run the effect: re-rendering the widget
  // would throw away a token the player has already earned.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;

    void loadScript()
      .then(() => {
        if (cancelled || !hostRef.current || !window.turnstile) return;
        widgetRef.current = window.turnstile.render(hostRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onTokenRef.current(token),
          "error-callback": () => onTokenRef.current(null),
          "expired-callback": () => onTokenRef.current(null),
          // Follows the player's own light/dark choice rather than pinning one.
          theme: "auto",
          size: "flexible",
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      const id = widgetRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          /* already gone with the DOM node */
        }
      }
    };
  }, []);

  if (!SITE_KEY) return null;

  if (failed) {
    return (
      <p role="alert" className="mt-4 text-center text-2xs leading-relaxed text-[var(--color-alert)]">
        The human check could not load. Check your connection and reload the page.
      </p>
    );
  }

  // min-height reserves the widget's own height so the button below does not
  // jump down the moment Cloudflare answers.
  return <div ref={hostRef} className="mt-4 flex min-h-[65px] justify-center" />;
}
