/**
 * Enterprise identity is collected before checkout and editable by the owner
 * afterwards. These four fields belong to the organisation's management
 * screen; only the name may be returned to ordinary members. Keeping one
 * validator on both sides makes a rejected checkout recoverable before any
 * payment is attempted, and caps Stripe metadata at its supported size.
 */
export const ORGANIZATION_TYPES = ["school", "university", "club", "company", "other"] as const;

export interface ChapterProfile {
  name: string;
  organizationType: (typeof ORGANIZATION_TYPES)[number];
  contactName: string;
  contactEmail: string;
}

export type ChapterProfileResult =
  | { ok: true; profile: ChapterProfile }
  | { ok: false; error: string };

export function validateChapterProfile(value: unknown): ChapterProfileResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Enter your enterprise's basic information before continuing." };
  }
  const fields = value as Record<string, unknown>;
  const text = (key: string) => typeof fields[key] === "string" ? fields[key].trim() : "";
  const name = text("name");
  const contactName = text("contactName");
  const contactEmail = text("contactEmail").toLowerCase();
  const organizationType = text("organizationType");
  const cleanText = (entry: string) => !/[\u0000-\u001f\u007f]/.test(entry);
  if (!name || name.length > 100 || !cleanText(name)) {
    return { ok: false, error: "Enter an enterprise name of 1–100 characters." };
  }
  if (!(ORGANIZATION_TYPES as readonly string[]).includes(organizationType)) {
    return { ok: false, error: "Choose an organisation type." };
  }
  if (!contactName || contactName.length > 100 || !cleanText(contactName)) {
    return { ok: false, error: "Enter a contact name of 1–100 characters." };
  }
  if (contactEmail.length > 254 || !cleanText(contactEmail) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, error: "Enter a valid contact email address." };
  }
  return {
    ok: true,
    profile: { name, organizationType: organizationType as ChapterProfile["organizationType"], contactName, contactEmail },
  };
}

/** The metadata keys are explicitly namespaced so personal checkout is unchanged. */
export function chapterProfileMetadata(profile: ChapterProfile): Record<string, string> {
  return {
    chapter_name: profile.name,
    chapter_organization_type: profile.organizationType,
    chapter_contact_name: profile.contactName,
    chapter_contact_email: profile.contactEmail,
  };
}

/** Older/manual subscriptions may have no profile. Their owner completes setup. */
export function chapterProfileFromMetadata(metadata: Record<string, string> | null | undefined): ChapterProfile | null {
  const result = validateChapterProfile({
    name: metadata?.chapter_name,
    organizationType: metadata?.chapter_organization_type,
    contactName: metadata?.chapter_contact_name,
    contactEmail: metadata?.chapter_contact_email,
  });
  return result.ok ? result.profile : null;
}
