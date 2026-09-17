"use client";

import { useState } from "react";
import { ChapterProfileFields } from "@/components/chapter/ChapterProfileFields";
import { validateChapterProfile, type ChapterProfile } from "@/lib/chapter/profile";
import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";

/**
 * Profile completion and deletion belong to the owner console. Destruction
 * requires an explicit typed word, calls the server's owner-scoped endpoint,
 * and stays on screen on failure so a billing cancellation can be retried.
 * The parent shares busy state with the roster to prevent overlapping edits.
 */
export interface ChapterDetailsInfo {
  id: string;
  name: string | null;
  organizationType: ChapterProfile["organizationType"] | null;
  contactName: string | null;
  contactEmail: string | null;
  profileComplete: boolean;
  source: string;
}

export function ChapterDetails({ chapter, busy, setBusy, onSaved, onDeleted }: {
  chapter: ChapterDetailsInfo;
  busy: boolean;
  setBusy: (action: string | null) => void;
  onSaved: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(!chapter.profileComplete);
  const [profile, setProfile] = useState<ChapterProfile>({
    name: chapter.name ?? "",
    organizationType: chapter.organizationType ?? "school",
    contactName: chapter.contactName ?? "",
    contactEmail: chapter.contactEmail ?? "",
  });
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    const validated = validateChapterProfile(profile);
    if (!validated.ok) return setError(validated.error);
    setBusy("profile");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(apiUrl("/api/chapter"), {
        method: "PATCH", credentials: API_CREDENTIALS,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id, profile: validated.profile }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save the enterprise information.");
      setProfile(validated.profile);
      setEditing(false);
      setNotice("Enterprise information saved.");
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (busy || confirmation !== "DELETE") return;
    setBusy("delete-enterprise");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(apiUrl("/api/chapter"), {
        method: "DELETE", credentials: API_CREDENTIALS,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id, confirmation }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not delete the enterprise. Please try again.");
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-6 rounded-[var(--radius-card)] bg-[var(--n-2)] p-5 ring-1 ring-[var(--hairline)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold tracking-[0.08em]">ENTERPRISE INFORMATION</h2>
        {!editing && <button type="button" disabled={busy} onClick={() => { setEditing(true); setError(null); setNotice(null); }} className="min-h-11 text-xs font-bold underline underline-offset-4 disabled:opacity-35">EDIT INFORMATION</button>}
      </div>
      {!chapter.profileComplete && <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">Complete your enterprise information before inviting or registering members.</p>}
      {editing ? <form className="mt-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <ChapterProfileFields value={profile} onChange={setProfile} disabled={busy} />
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className="nv-gc min-h-12 rounded-[var(--radius-row)] nv-t-action px-5 text-sm font-extrabold disabled:opacity-35">{busy ? "PLEASE WAIT…" : "SAVE INFORMATION"}</button>
          {chapter.profileComplete && <button type="button" disabled={busy} onClick={() => { setEditing(false); setProfile({ name: chapter.name ?? "", organizationType: chapter.organizationType ?? "school", contactName: chapter.contactName ?? "", contactEmail: chapter.contactEmail ?? "" }); setError(null); }} className="min-h-12 px-3 text-xs font-bold disabled:opacity-35">CANCEL</button>}
        </div>
      </form> : <p className="mt-2 break-words text-sm leading-relaxed text-[var(--text-secondary)]">{chapter.contactName} · {chapter.contactEmail}</p>}

      <div className="mt-5 border-t border-[var(--hairline)] pt-4">
        {!deleting ? <button type="button" disabled={busy} onClick={() => { setDeleting(true); setError(null); setNotice(null); }} className="min-h-11 text-xs font-bold text-[var(--alert)] underline underline-offset-4 disabled:opacity-35">DELETE ENTERPRISE</button> : <form onSubmit={(event) => { event.preventDefault(); void remove(); }}>
          <h3 className="break-words text-sm font-extrabold">Delete {chapter.name || "this enterprise"}?</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">This permanently removes the enterprise, its membership and its shared leaderboard. All enterprise Pro seats end immediately. Personal accounts, game progress and separately purchased Pro subscriptions remain.</p>
          {chapter.source === "stripe" && <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">Its enterprise subscription will be cancelled immediately. Deletion does not issue an automatic refund.</p>}
          <label className="mt-4 block text-xs font-bold">Type DELETE to confirm
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} className="mt-2 block min-h-12 w-full rounded-[var(--radius-row)] border border-[var(--hairline)] bg-transparent px-3 text-base" />
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="submit" disabled={busy || confirmation !== "DELETE"} className="min-h-12 rounded-[var(--radius-row)] border border-[var(--alert)] px-4 text-xs font-extrabold text-[var(--alert)] disabled:opacity-35">{busy ? "PLEASE WAIT…" : "PERMANENTLY DELETE"}</button>
            <button type="button" disabled={busy} onClick={() => { setDeleting(false); setConfirmation(""); setError(null); }} className="min-h-12 px-3 text-xs font-bold disabled:opacity-35">KEEP ENTERPRISE</button>
          </div>
        </form>}
      </div>
      {notice && <p role="status" className="mt-3 text-sm text-[var(--text-secondary)]">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm leading-relaxed text-[var(--alert)]">{error}</p>}
    </section>
  );
}
