import "server-only";

import { randomBytes } from "node:crypto";

import type { Session } from "@/lib/supabase/route";
import type { ChapterId } from "@/lib/monetization";
import { validateChapterProfile, type ChapterProfile } from "@/lib/chapter/profile";

/**
 * Shared plumbing for the chapter admin routes (app/api/chapter/*).
 *
 * The division of labour every route follows:
 *
 *   1. The caller's OWNERSHIP is proved through their own session client —
 *      `chapters` has an owner-only SELECT policy (0007), so a query that
 *      returns a row is the proof, and a query that returns nothing ends the
 *      request. No route ever trusts a chapter id from the request body.
 *   2. The WRITES then run on the service role, because creating accounts,
 *      granting entitlements and counting seats against the cap are exactly
 *      the operations the browser must never hold the keys to.
 *
 * Every service-role statement filters by the chapter id resolved in step 1 —
 * lib/supabase/admin.ts's standing rule, applied to chapters.
 */

export interface OwnedChapter {
  role: "owner" | "admin";
  id: string;
  licence: ChapterId;
  seats: number;
  status: "active" | "lapsed";
  currentPeriodEnd: string | null;
  source: "stripe" | "comp";
  name: string | null;
  organizationType: ChapterProfile["organizationType"] | null;
  contactName: string | null;
  contactEmail: string | null;
  profileComplete: boolean;
}

/**
 * The chapter this session owns, or null.
 *
 * Reads through the caller's own client so RLS is the authority on ownership.
 * Prefers the active licence: an owner whose old chapter lapsed and who
 * bought again administers the new one, while a lone lapsed chapter is still
 * returned so its console can say "lapsed" instead of pretending the chapter
 * never existed.
 */
export async function ownedChapter(session: Session): Promise<OwnedChapter | null> {
  return findChapter(session, null, true);
}

export async function managedChapter(session: Session, id?: string | null): Promise<OwnedChapter | null> {
  return findChapter(session, id, false);
}

async function findChapter(session: Session, id: string | null | undefined, ownerOnly: boolean): Promise<OwnedChapter | null> {
  let query = session.supabase
    .from("chapters")
    .select("id, owner_profile_id, licence, seats, status, current_period_end, created_at, source, name, organization_type, contact_name, contact_email")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (ownerOnly) query = query.eq("owner_profile_id", session.userId);
  if (id) query = query.eq("id", id);
  const { data, error } = await query;
  if (error) throw new Error("Could not load enterprise access.");
  if (!data || data.length === 0) return null;

  const row = data.find((c) => c.status === "active") ?? data[0];
  const profile = {
    name: (row.name as string | null) ?? null,
    organizationType: (row.organization_type as ChapterProfile["organizationType"] | null) ?? null,
    contactName: (row.contact_name as string | null) ?? null,
    contactEmail: (row.contact_email as string | null) ?? null,
  };
  return {
    role: row.owner_profile_id === session.userId ? "owner" : "admin",
    id: row.id as string,
    licence: row.licence as ChapterId,
    seats: row.seats as number,
    status: row.status as OwnedChapter["status"],
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    source: row.source as OwnedChapter["source"],
    ...profile,
    profileComplete: validateChapterProfile(profile).ok,
  };
}

/** The roster row shape the console renders. No profile ids leave the server —
 *  the email is the admin's own input and the id would add nothing but risk. */
export interface SeatRow {
  email: string;
  name: string | null;
  origin: "registered" | "invited";
  inviteSentAt: string | null;
  /** When password setup completed through either mailer. Registered seats
   *  and existing accounts do not require an invitation claim. */
  claimedAt: string | null;
  createdAt: string;
}

/**
 * A password for an account whose password is about to be chosen by its
 * owner through the set-password email. 40 base64url characters of CSPRNG —
 * never shown, never stored outside the hash, satisfies every length rule.
 */
export const randomPassword = (): string => randomBytes(30).toString("base64url");

/** Seat names obey profiles.display_name's own bounds (1–24 after trim). */
export const cleanSeatName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : null;
};

/** How many rows one request may carry. The seat cap is the real limit; this
 *  only stops a pathological paste from becoming a five-minute request. */
export const MAX_BATCH = 200;

/** Postgres constraint noise → one sentence the admin can act on. */
export function seatMessage(message: string): string {
  if (message.includes("chapter is full")) {
    return "the chapter is full — every seat is taken";
  }
  if (message.includes("chapter_seats_profile_id_key")) {
    return "already holds a seat in another chapter";
  }
  if (message.includes("chapter_seats_chapter_id_email_key")) {
    return "already on this roster";
  }
  return message;
}
