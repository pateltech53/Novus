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

// ── Boot ─────────────────────────────────────────────────────────────────────

/** Guards the restore reload below so it can happen at most once per tab. */
const RESTORED_FLAG = "novus:cloud-restored";

/**
 * Runs once on boot: install the flush hook, then restore from the cloud if
 * this device has nothing of its own.
 *
 * **The conflict rule is "local always wins".** A run in progress on this
 * device is never replaced by a server copy — opening a tab must not swap out
 * the company you are halfway through. Restore only fires on a device that is
 * genuinely empty, which is the case it exists for: a new phone, a cleared
 * browser, a second machine.
 *
 * **On the reload.** The game reads localStorage synchronously at mount
 * (`lib/engine/save.ts` explains why it must), and by the time a network
 * round-trip finishes, that read has already happened. Rather than reach into
 * GameProvider's state from outside it, an actual restore re-enters the app
 * once. It costs one reload on the first launch of a new device and nothing
 * ever again — and a restore that did not happen would be the worse bug.
 *
 * The sessionStorage flag makes a reload loop impossible even if the adopt
 * silently fails: the second pass finds the flag and returns.
 */
export async function restoreOnBoot(): Promise<void> {
  installFlushOnHide();

  if (typeof window === "undefined") return;
  let alreadyTried = false;
  try {
    alreadyTried = window.sessionStorage.getItem(RESTORED_FLAG) === "1";
  } catch {
    // Private mode with sessionStorage blocked. Without a loop guard the safe
    // move is to not reload at all.
    return;
  }
  if (alreadyTried) return;

  // Cheap local check first: a device with a save needs nothing from us, and
  // this avoids a pointless request on every single boot.
  const hasLocalRun = !!window.localStorage.getItem("novus:run:v1");
  const hasLocalLegacy = !!window.localStorage.getItem("novus:legacy:v1");
  const hasLocalProfile = !!window.localStorage.getItem("novus:profile:v1");
  if (hasLocalRun && hasLocalLegacy && hasLocalProfile) return;

  const cloud = await pull();
  if (!cloud) return;

  // Import here rather than at module scope: save.ts imports this file, and a
  // static cycle between the two would leave one of them half-initialised.
  const { adoptFromCloud } = await import("@/lib/engine/save");

  const run = hasLocalRun ? undefined : cloud.run;
  const legacy = hasLocalLegacy ? undefined : cloud.legacy;
  const prefs = hasLocalProfile ? undefined : cloud.prefs;
  if (!run && !legacy && !prefs) return;

  adoptFromCloud({ run, legacy, prefs });

  try {
    window.sessionStorage.setItem(RESTORED_FLAG, "1");
  } catch {
    return;
  }
  window.location.reload();
}
