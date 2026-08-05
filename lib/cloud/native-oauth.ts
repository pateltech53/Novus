"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

import type { OAuthProvider } from "@/lib/auth/providers";
import { isNative, isIOS } from "@/lib/native/platform";

/**
 * The system sign-in sheet, on the two platforms that have one.
 *
 * ── Why there is no npm dependency here ────────────────────────────────────
 *
 * The obvious version of this file imports `@capgo/capacitor-social-login` and
 * calls it. That would put a package into the WEB build — which never uses a
 * line of it — and, worse, would make `next build` fail outright on any
 * checkout where `npm install` had not yet been run with the plugin in
 * package.json, because a bundler resolves a dynamic import at build time just
 * as eagerly as a static one.
 *
 * `registerPlugin` is Capacitor's own answer to this and costs nothing:
 * `@capacitor/core` is already a dependency, and the call returns a proxy over
 * the native bridge rather than any implementation. If the native plugin is
 * installed in the iOS/Android project the proxy reaches it; if it is not, the
 * proxy is still perfectly valid JavaScript and `isPluginAvailable` answers
 * false. So the web build carries a few lines it never runs, an app built
 * before the plugin was added simply does not offer the buttons, and there is
 * no version of this that breaks a build.
 *
 * The plugin the native projects install is `@capgo/capacitor-social-login`,
 * which registers under this name. docs/OAUTH-SETUP.md §5 has the install.
 */

interface SocialLoginResult {
  provider: string;
  result?: {
    idToken?: string | null;
    accessToken?: { token?: string } | string | null;
    profile?: {
      email?: string | null;
      name?: string | null;
      givenName?: string | null;
      familyName?: string | null;
    } | null;
  } | null;
}

interface SocialLoginPlugin {
  initialize(options: Record<string, unknown>): Promise<void>;
  login(options: { provider: string; options: Record<string, unknown> }): Promise<SocialLoginResult>;
}

const SocialLogin = registerPlugin<SocialLoginPlugin>("SocialLogin");

/*
 * Client ids, read at build time.
 *
 * Public by nature — a client id is in every OAuth request the moment the sheet
 * opens — so `NEXT_PUBLIC_` is correct here in a way it never is for a secret.
 * Absent values are not an error: they mean that provider is not configured for
 * this build, and `availableProviders()` simply does not offer it rather than
 * putting a button on screen that opens a sheet and fails.
 */
const GOOGLE_WEB_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
const GOOGLE_IOS_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
const APPLE_SERVICES_ID = process.env.NEXT_PUBLIC_APPLE_SERVICES_ID ?? "";
const APPLE_REDIRECT_URL = process.env.NEXT_PUBLIC_APPLE_REDIRECT_URL ?? "";

/** True only inside a shipped app whose native project actually has the
 *  plugin. False in every browser, and in an app built before it was added. */
export function nativeAuthAvailable(): boolean {
  return isNative() && Capacitor.isPluginAvailable("SocialLogin");
}

/**
 * Which buttons the app may show.
 *
 * Apple on iOS needs no configuration from us — the entitlement on the target
 * is the whole of it, and the sheet is part of the OS. Everything else needs a
 * client id, and an unconfigured provider is left out rather than offered.
 *
 * Apple on **Android** goes through Apple's web flow inside the app, which is
 * why it needs a Services ID and a return URL there and not on iOS.
 */
export function availableProviders(): OAuthProvider[] {
  if (!nativeAuthAvailable()) return [];

  const providers: OAuthProvider[] = [];
  if (GOOGLE_WEB_CLIENT_ID) providers.push("google");
  if (isIOS() || (APPLE_SERVICES_ID && APPLE_REDIRECT_URL)) providers.push("apple");
  return providers;
}

/** initialize() is idempotent on the plugin's side, but it is a bridge call —
 *  held so opening the sheet twice does not pay for it twice. */
let ready: Promise<void> | null = null;

function initialise(): Promise<void> {
  ready ??= SocialLogin.initialize({
    ...(GOOGLE_WEB_CLIENT_ID
      ? {
          google: {
            webClientId: GOOGLE_WEB_CLIENT_ID,
            ...(GOOGLE_IOS_CLIENT_ID ? { iOSClientId: GOOGLE_IOS_CLIENT_ID } : {}),
          },
        }
      : {}),
    ...(APPLE_SERVICES_ID
      ? { apple: { clientId: APPLE_SERVICES_ID, redirectUrl: APPLE_REDIRECT_URL } }
      : {}),
  }).catch((error: unknown) => {
    // Not memoised as a rejection: a first attempt that failed because the
    // network was down must not poison every attempt after it.
    ready = null;
    throw error;
  });
  return ready;
}

export interface NativeToken {
  idToken: string;
  /** Apple's once-only handover. Null for Google, whose name is in the token. */
  name: string | null;
}

/**
 * Opens the system sheet and returns the signed token it produces.
 *
 * Returns null when the player dismissed the sheet, which is not an error and
 * must not be reported as one — the most common reason this function does not
 * produce a token is somebody changing their mind, and a red message under the
 * button for that reads as a broken app.
 *
 * ── On the nonce ──────────────────────────────────────────────────────────
 *
 * Deliberately not sent. Apple's replay protection wants the app to put a
 * SHA-256 of a random value into the request and hand the RAW value to whoever
 * verifies the token — and whether a given plugin version hashes it for you or
 * passes it through is exactly the sort of thing that is wrong in one direction
 * or the other and fails identically either way. Supabase treats `nonce` as
 * optional and skips the check when it is absent, so leaving it out is a
 * working flow rather than a subtly broken one. The signature and audience
 * checks — the ones that decide whether the token is real — are unaffected, and
 * the token's whole life here is one TLS hop from this device to our own
 * origin. `/api/auth/oauth/native` already accepts a nonce for the day somebody
 * verifies which convention the plugin follows on a real device.
 */
export async function nativeIdToken(provider: OAuthProvider): Promise<NativeToken | null> {
  await initialise();

  let response: SocialLoginResult;
  try {
    response = await SocialLogin.login({
      provider: provider === "google" ? "google" : "apple",
      options:
        provider === "google"
          ? { scopes: ["email", "profile"] }
          : { scopes: ["email", "name"] },
    });
  } catch (error) {
    if (dismissed(error)) return null;
    throw error;
  }

  const idToken = response.result?.idToken;
  if (!idToken) return null;

  return { idToken, name: appleName(response) };
}

/**
 * Was that a cancel rather than a failure?
 *
 * Neither platform agrees on the wording, and the plugin passes each through,
 * so this matches on what they have in common. A false negative here costs an
 * error message nobody needed; a false positive costs a silent failure, which
 * is why the list is narrow.
 */
function dismissed(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    message.includes("cancel") ||
    message.includes("dismiss") ||
    message.includes("closed by user") ||
    // ASAuthorizationError.canceled
    message.includes("1001")
  );
}

/** Apple sends given/family separately, and only the first time. */
function appleName(response: SocialLoginResult): string | null {
  const profile = response.result?.profile;
  if (!profile) return null;
  const joined = [profile.givenName, profile.familyName].filter(Boolean).join(" ").trim();
  const name = (profile.name ?? "").trim() || joined;
  return name || null;
}
