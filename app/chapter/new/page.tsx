"use client";

import { useCallback, useEffect, useState } from "react";
import { ChapterProfileFields, EMPTY_CHAPTER_PROFILE } from "@/components/chapter/ChapterProfileFields";
import { ORGANIZATION_TYPES, validateChapterProfile, type ChapterProfile } from "@/lib/chapter/profile";
import { type Identity } from "@/lib/cloud/auth";
import { goToCheckout } from "@/lib/cloud/billing";
import { clearPendingChapter, rememberPendingChapter } from "@/lib/cloud/pending-chapter";
import { forgetPendingPro } from "@/lib/cloud/pending-pro";
import { useSellsHere } from "@/lib/commerce";
import { CHAPTER_LICENCES, formatPrice, type ChapterLicence } from "@/lib/monetization";
import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
import { appPath } from "@/lib/native/href";

/**
 * Enterprise registration happens before any payment: first authenticate the
 * owner, then collect the organization and its contact, then open checkout.
 * The SKU survives sign-in as a short-lived, tab-local handoff; contact
 * details stay only in this form until the authenticated checkout request.
 * Existing enterprises are edited in their console, never bought twice.
 */
type Phase = "loading" | "signed-out" | "ready" | "owned" | "unconfigured" | "error";
const PRIMARY = "nv-gc flex min-h-14 w-full items-center justify-center rounded-[var(--radius-card)] nv-t-action px-5 py-3 text-sm font-extrabold tracking-[0.04em] shadow-[var(--e2)] disabled:cursor-not-allowed disabled:opacity-35";
const DRAFT_KEY = "novus.chapter-basics-draft";

/** Only public organization details survive a cancelled checkout, for this
 *  signed-in owner and for 30 minutes. Contact fields are never persisted. */
function restoreDraft(owner: string | null): Partial<ChapterProfile> {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const draft = JSON.parse(raw) as Record<string, unknown>;
    if (!owner || draft.owner !== owner || typeof draft.at !== "number" ||
      Date.now() - draft.at < 0 || Date.now() - draft.at > 30 * 60 * 1000 ||
      typeof draft.name !== "string" || draft.name.length > 100 ||
      !(ORGANIZATION_TYPES as readonly unknown[]).includes(draft.organizationType)) {
      sessionStorage.removeItem(DRAFT_KEY);
      return {};
    }
    return { name: draft.name, organizationType: draft.organizationType as ChapterProfile["organizationType"] };
  } catch { return {}; }
}

export default function NewChapterPage() {
  const sells = useSellsHere();
  const [sku, setSku] = useState<ChapterLicence["id"]>("chapter_35");
  const [phase, setPhase] = useState<Phase>("loading");
  const [profile, setProfile] = useState<ChapterProfile>(EMPTY_CHAPTER_PROFILE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const [identityResponse, chapterResponse] = await Promise.all([
        fetch(apiUrl("/api/auth/me"), { credentials: API_CREDENTIALS }),
        fetch(apiUrl("/api/chapter"), { credentials: API_CREDENTIALS }),
      ]);
      if (!identityResponse.ok || !chapterResponse.ok) throw new Error("Could not load your account. Please try again.");
      const account = await identityResponse.json() as Identity;
      const body = await chapterResponse.json() as { chapter?: { id: string; status: "active" | "lapsed" } | null };
      if (!account.configured) return setPhase("unconfigured");
      if (!account.signedIn || account.anonymous) {
        restoreDraft(null);
        return setPhase("signed-out");
      }
      clearPendingChapter();
      if (body.chapter?.status === "active") return setPhase("owned");
      setOwnerEmail(account.email);
      setProfile({ ...EMPTY_CHAPTER_PROFILE, ...restoreDraft(account.email), contactName: account.displayName || "", contactEmail: account.email || "" });
      setPhase("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your account. Please try again.");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selected = params.get("sku") ?? params.get("plan");
    if (selected === "chapter_100") setSku(selected);
    setCancelled(params.get("purchase") === "cancelled");
    void load();
  }, [load]);

  const submit = async () => {
    if (busy || phase !== "ready" || sells !== true) return;
    const validated = validateChapterProfile(profile);
    if (!validated.ok) return setError(validated.error);
    setBusy(true);
    setError(null);
    try {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ owner: ownerEmail, at: Date.now(), name: validated.profile.name, organizationType: validated.profile.organizationType }));
      } catch { /* Checkout still works when browser storage is disabled. */ }
      const result = await goToCheckout(sku, undefined, undefined, validated.profile);
      if (result.ok) return;
      if (result.reason === "admin-skip") {
        window.location.assign("/chapter");
        return;
      }
      if (result.reason === "admin-cancel") return;
      if (result.reason === "signed-out" || result.reason === "needs-account") {
        // The expired owner's contact must not become the next account's form.
        setProfile(EMPTY_CHAPTER_PROFILE);
        setPhase("signed-out");
        setError("Your session ended. Sign in again to continue registration.");
      } else if (result.reason === "owned") {
        setPhase("owned");
      } else if (result.reason === "not-configured") {
        setError("Checkout is currently unavailable. Contact team@novuspitch.com to arrange your enterprise.");
      } else {
        setError(result.message ?? "Checkout could not be opened. Please try again.");
      }
    } catch {
      setError("Could not reach checkout. Your details are still here; please try again.");
    } finally {
      setBusy(false);
    }
  };

  const licence = CHAPTER_LICENCES.find((option) => option.id === sku)!;
  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-6 pb-16 pt-[max(3rem,var(--nv-safe-top),calc(var(--nv-overlay-top)+1rem))]">
      <a href={sells === true ? "/" : appPath("/home")} onClick={clearPendingChapter} className="inline-flex min-h-11 items-center text-xs font-bold text-[var(--text-secondary)]">BACK TO NOVUS</a>
      <p className="mt-5 text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">NOVUS ENTERPRISE · CHAPTERS</p>
      <h1 className="mt-2 text-[1.75rem] font-extrabold leading-tight">Set up your enterprise.</h1>
      {sells === null || phase === "loading" ? (
        <p role="status" className="mt-4 text-sm text-[var(--text-secondary)]">Loading your account…</p>
      ) : sells === false ? (
        <div className="mt-4">
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">Enterprise plans are managed on the web. Existing owners can manage their enterprise and members here.</p>
          <a href={appPath("/chapter")} className={`${PRIMARY} mt-5`}>OPEN ENTERPRISE</a>
        </div>
      ) : (
        <>
          {phase === "signed-out" && <div className="mt-6">
            <p className="mb-5 text-sm leading-relaxed text-[var(--text-secondary)]">First, sign in or create the Novus account that will manage this enterprise. Then you will return here to enter its basic information.</p>
            <a href="/#account" onClick={() => { forgetPendingPro(); rememberPendingChapter(sku); }} className={PRIMARY}>SIGN IN OR CREATE ACCOUNT</a>
          </div>}
          {phase === "owned" && <div className="mt-6">
            <p className="mb-5 text-sm leading-relaxed text-[var(--text-secondary)]">This account already manages an enterprise. Open its console to edit its information, manage members or billing.</p>
            <a href="/chapter" className={PRIMARY}>OPEN ENTERPRISE</a>
          </div>}
          {phase === "unconfigured" && <p className="mt-5 text-sm leading-relaxed text-[var(--text-secondary)]">Enterprise registration is not available on this build. Contact team@novuspitch.com for help.</p>}
          {phase === "error" && <button type="button" onClick={() => void load()} className={`${PRIMARY} mt-5`}>TRY AGAIN</button>}
          {phase === "ready" && <form className="mt-6" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            {cancelled && <p role="status" className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">Checkout was cancelled. Review your information and continue when you are ready.</p>}
            <p className="mb-5 text-sm leading-relaxed text-[var(--text-secondary)]">Enter your organization’s information before continuing to secure checkout. All fields are required.</p>
            <ChapterProfileFields value={profile} onChange={setProfile} disabled={busy} />
            <fieldset disabled={busy} className="mt-6">
              <legend className="mb-2 text-xs font-bold">Annual licence</legend>
              <div className="grid gap-2">
                {CHAPTER_LICENCES.map((option) => <label key={option.id} className="flex min-h-14 items-center gap-3 rounded-[var(--radius-row)] border border-[var(--hairline)] px-4 py-3 text-sm">
                  <input type="radio" name="licence" checked={sku === option.id} value={option.id} onChange={() => setSku(option.id)} />
                  <span className="tnum">{option.seats} seats · {formatPrice(option.priceCents)} / year</span>
                </label>)}
              </div>
            </fieldset>
            <p className="tnum my-5 text-sm text-[var(--text-secondary)]">{licence.seats} seats. Billed annually. Members’ personal accounts and progress remain theirs.</p>
            <button type="submit" disabled={busy} className={PRIMARY}>{busy ? "OPENING CHECKOUT…" : "CONTINUE TO CHECKOUT"}</button>
          </form>}
          {error && <p role="alert" className="mt-4 text-sm leading-relaxed text-[var(--alert)]">{error}</p>}
        </>
      )}
    </main>
  );
}
