import { isNative } from "@/lib/native/platform";
import type { ChapterLicence } from "@/lib/monetization";

/**
 * Authentication may leave the registration page (including OAuth), but it
 * must not lose the selected licence. The handoff stores only an allowlisted
 * SKU, in this tab, for one hour. Contact information is collected after
 * authentication and never goes into shared-device browser storage.
 */
const KEY = "novus.pending-chapter";
const MAX_AGE_MS = 60 * 60 * 1000;

export function rememberPendingChapter(sku: ChapterLicence["id"]): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ sku, at: Date.now() })); } catch { /* Storage may be unavailable. */ }
}

export function clearPendingChapter(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* No state to clear. */ }
}

export function resumePendingChapter(): boolean {
  if (isNative()) { clearPendingChapter(); return false; }
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return false;
    sessionStorage.removeItem(KEY);
    const pending: unknown = JSON.parse(raw);
    if (!pending || typeof pending !== "object") return false;
    const { sku, at } = pending as { sku?: unknown; at?: unknown };
    if ((sku !== "chapter_35" && sku !== "chapter_100") || typeof at !== "number" ||
      Date.now() - at < 0 || Date.now() - at > MAX_AGE_MS) return false;
    window.location.assign(`/chapter/new?sku=${sku}`);
    return true;
  } catch {
    return false;
  }
}
