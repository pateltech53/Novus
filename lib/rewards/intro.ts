"use client";

/**
 * Whether this device has been told about briefcases.
 *
 * ── What it remembers, and for whom ─────────────────────────────────────────
 *
 * The reward loop (docs/BRIEFCASES.md) shipped behind a per-account beta flag
 * and now reaches every signed-in account. Two kinds of player meet it. One is
 * founding their first company and is taught in the guided first play — the
 * "briefcases" step in components/Coachmarks.tsx, which app/welcome/page.tsx
 * records here the moment onboarding finishes, so the tutorial is that
 * player's whole introduction. The other finished that tutorial weeks ago and
 * has never heard the word: they get one sheet, once
 * (components/rewards/BriefcaseIntro.tsx), and this flag is the entire memory
 * of it.
 *
 * ── Why localStorage, and not the profile or the account ────────────────────
 *
 * It is an announcement, not progress. The profile (`novus:profile:v1`) is
 * mirrored to the cloud and read by the entry router, and a field that exists
 * only to say "the sheet was shown" would ride along on every sync for the
 * rest of the account's life. An entitlement row is an operator's cell, not a
 * client's. So the fact stays where it is cheap — on the device, under a key
 * of its own, deliberately OUTSIDE the DEVICE_KEYS list lib/cloud/auth.ts
 * wipes on sign-in. A shared classroom iPad therefore shows the sheet once per
 * machine rather than once per student, and the tutorial step remains the
 * teaching that follows every new player to every device.
 *
 * ── The failure rule ────────────────────────────────────────────────────────
 *
 * A device that cannot remember reports the sheet as SEEN. Safari in private
 * mode and a browser with site data blocked both throw on the accessor, and
 * the alternative — reading "cannot remember" as "never shown" — is a device
 * that announces briefcases on every single visit, forever. Missing one
 * announcement on one locked-down browser is the cheaper mistake, and the
 * Closet still carries the BRIEFCASES row for anyone who missed it.
 */

const KEY = "novus:briefcases:intro:v1";

/** True once the introduction has been shown here — or cannot be recorded. */
export function introSeen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

/** Record that this device has been introduced. Idempotent, never throws. */
export function markIntroSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* nothing depends on it — see the failure rule above */
  }
}
