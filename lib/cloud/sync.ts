import type { LegacyState, RunState } from "@/lib/engine/types";

/**
 * The cloud half of persistence.
 *
 * ── Why localStorage does not go away ──────────────────────────────────────────
 *
 * `lib/engine/save.ts` is synchronous, and it has to stay that way. Its callers
 * read it during render — `loadProfile()?.onboarded ? "/found" : "/welcome"` in
 * AccountGate, `useState(() => loadLegacy().runsCompleted)` in ClosetScreen —
 * and there is no synchronous fetch. Making the six save functions async would
 * mean touching every screen, which is exactly what save.ts's own doc comment
 * says this migration must not do.
 *
 * So the shape is: **localStorage is the cache the game reads, Supabase is the
 * durable copy behind it.** Writes go to localStorage immediately and to the
 * server on a debounce. On boot we pull the server copy and adopt it only if
 * this device has nothing newer.
 *
 * This also gives the right failure mode. No project configured, offline, on a
 * plane, anonymous sign-ins disabled — the game plays exactly as it did
 * before, and syncs when it can.
 */

export type SyncState = "idle" | "off" | "syncing" | "synced" | "error";

interface Prefs {
  rookieMode: boolean;
  onboarded: boolean;
  micCalibration: number | null;
  founderName: string;
}

interface PullResult {
  configured: boolean;
  signedIn: boolean;
  run?: RunState | null;
  legacy?: LegacyState | null;
  prefs?: Prefs | null;
}

/** Set once the session route says there is nothing to sync to. */
let disabled = false;
let signedIn = false;
let state: SyncState = "idle";

const listeners = new Set<(s: SyncState) => void>();

function setState(next: SyncState) {
  state = next;
  listeners.forEach((fn) => fn(next));
}

export const syncState = (): SyncState => state;

export function onSyncState(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Establishes the anonymous session. Safe to call more than once; the cookie
 * makes the second call a no-op refresh rather than a second identity.
 */
export async function ensureSession(): Promise<boolean> {
  if (disabled) return false;
  if (signedIn) return true;
  try {
    const res = await fetch("/api/session", { method: "POST" });
    const body = (await res.json()) as { configured: boolean; signedIn: boolean };
    if (!body.configured || !body.signedIn) {
      // Not an error worth surfacing: an unconfigured project is a local-only
      // install, which is a supported way to run this game.
      disabled = true;
      setState("off");
      return false;
    }
    signedIn = true;
    return true;
  } catch {
    disabled = true;
    setState("off");
    return false;
  }
}

/** Pulls the cloud copy. Returns null when there is nothing to adopt. */
export async function pull(): Promise<PullResult | null> {
  if (!(await ensureSession())) return null;
  try {
    setState("syncing");
    const res = await fetch("/api/sync", { method: "GET" });
    const body = (await res.json()) as PullResult;
    if (!body.signedIn) {
      setState("off");
      return null;
    }
    setState("synced");
    return body;
  } catch {
    setState("error");
    return null;
  }
}

// ── The write side ──────────────────────────────────────────────────────────

/**
 * Pending writes, coalesced.
 *
 * commit() fires on every decision, and a run can produce a burst of them in a
 * second. Debouncing turns that burst into one request carrying the latest
 * state — the game is not collaborative, so only the final value matters.
 */
let pending: { run?: RunState | null; legacy?: LegacyState; prefs?: Prefs } = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

const DEBOUNCE_MS = 1500;

function schedule() {
  if (disabled) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), DEBOUNCE_MS);
}

/** Sends whatever has accumulated. Called by the debounce and on page hide. */
export async function flush(): Promise<void> {
  if (disabled || inFlight) return;
  if (Object.keys(pending).length === 0) return;
  if (!(await ensureSession())) return;

  const body = pending;
  pending = {};
  inFlight = true;
  setState("syncing");
  try {
    const res = await fetch("/api/sync", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setState(res.ok ? "synced" : "error");
  } catch {
    // Put the work back so the next flush retries it rather than dropping a
    // player's run on one bad request.
    pending = { ...body, ...pending };
    setState("error");
  } finally {
    inFlight = false;
  }
}

export function queueRun(run: RunState | null) {
  pending.run = run;
  schedule();
}

export function queueLegacy(legacy: LegacyState) {
  pending.legacy = legacy;
  schedule();
}

export function queuePrefs(prefs: Prefs) {
  pending.prefs = prefs;
  schedule();
}

/**
 * A closing tab must not lose the last decision. `visibilitychange` fires on
 * mobile backgrounding where `beforeunload` does not, which is where this
 * actually matters.
 */
export function installFlushOnHide() {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}
