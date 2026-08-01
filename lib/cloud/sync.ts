import { adoptEntitlements } from "@/lib/cloud/billing";
import { RESTORED_FLAG } from "@/lib/cloud/keys";
import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
import type { LegacyState, RunState } from "@/lib/engine/types";
import type { Entitlements } from "@/lib/monetization";

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
  /** Null until a purchase is recorded. Never sent back up — the PUT side has
   *  no entitlements field, because the server is the only writer. */
  entitlements?: Entitlements | null;
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
 * Is there an account to sync to?
 *
 * This used to CREATE one — /api/session minted an anonymous identity for
 * anyone who asked. It no longer does, so this is now a question rather than
 * an instruction, and "no" is the normal answer for a player who has not
 * signed up.
 *
 * `disabled` is set on a no, which switches the whole sync layer off for the
 * page: no pulls, no pushes, nothing leaves the device. It is deliberately NOT
 * sticky across sign-in — signUp() and signIn() call resume() below, because
 * by then the answer has genuinely changed.
 */
export async function ensureSession(): Promise<boolean> {
  if (disabled) return false;
  if (signedIn) return true;
  try {
    const res = await fetch(apiUrl("/api/session"), {
      method: "POST",
      credentials: API_CREDENTIALS,
    });
    const body = (await res.json()) as { configured: boolean; signedIn: boolean };
    if (!body.configured || !body.signedIn) {
      // Three cases, one answer: no Supabase project, no account, or an
      // expired cookie. All three mean the game plays on localStorage alone,
      // which is a supported way to run Novus and not worth surfacing as an
      // error to a player who never asked for cloud saves.
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

/**
 * Re-arms the sync layer after an account appears.
 *
 * On a device with no account, boot sets `disabled` and every later call
 * returns early — which is the point. But signing up does not reload the page,
 * so without this the brand-new account would sit behind a flag set one second
 * earlier by the fact that it did not exist yet, and the first push
 * (pushLocalNow) would silently do nothing.
 *
 * Called by lib/cloud/auth.ts on sign-up and sign-in.
 */
export function resume(): void {
  disabled = false;
  signedIn = false; // re-established on the next ensureSession, as the new user
  setState("idle");
}

/** Pulls the cloud copy. Returns null when there is nothing to adopt. */
export async function pull(): Promise<PullResult | null> {
  if (!(await ensureSession())) return null;
  try {
    setState("syncing");
    const res = await fetch(apiUrl("/api/sync"), {
      method: "GET",
      credentials: API_CREDENTIALS,
    });
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
type Payload = { run?: RunState | null; legacy?: LegacyState; prefs?: Prefs };

let pending: Payload = {};
let timer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 1500;

function schedule() {
  if (disabled) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), DEBOUNCE_MS);
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Sends whatever has accumulated, and reports whether the server has it.
 *
 * ── The answer is load-bearing ─────────────────────────────────────────────
 *
 * signOut() in lib/cloud/auth.ts erases this device's localStorage — the
 * companies, the legacy, the entitlements — on the strength of "the server has
 * a copy". This function is where that claim is established, so `true` has to
 * mean the server said yes, and every other outcome has to be `false`.
 *
 * It did not used to. The old version reported success from `res.ok` alone,
 * which was true of an HTTP 200 the server had marked as failed, and of a 200
 * saying nobody was signed in. On a shared classroom iPad that read as
 * permission to delete the only surviving copy of a child's work. The route
 * now answers 500 for a write it did not do, and this checks the body as well,
 * because two answers agreeing is the point.
 *
 * A failed send also puts its payload BACK, whatever went wrong — the old code
 * only did that for a thrown fetch, so an HTTP error dropped the batch on the
 * floor. That mattered most for pushLocalNow(), which fires once, after
 * sign-up, and is the only thing carrying a player's existing company into
 * their new account.
 */
export function flush(): Promise<boolean> {
  /*
   * Serialised rather than skipped.
   *
   * The old version returned early when a request was already in flight, so
   * sign-out could ask "is this device safe to wipe?" while the debounced
   * write was still on the wire, and be answered about neither. Chaining means
   * every caller waits for a send that covers their data and gets that send's
   * verdict — and `pending` is read inside send(), after the wait, so the
   * later caller carries anything queued in the meantime.
   */
  const next = chain.then(send, send);
  // The chain itself must never reject, or one failed send poisons every
  // flush after it.
  chain = next.catch(() => undefined);
  return next;
}

async function send(): Promise<boolean> {
  if (disabled) return false;

  if (Object.keys(pending).length === 0) {
    // Nothing queued. Every write to localStorage goes through queueRun /
    // queueLegacy / queuePrefs (lib/engine/save.ts), and a failed send puts
    // its payload back — so an empty queue on a live session genuinely means
    // there is nothing here the server has not confirmed.
    return signedIn;
  }

  if (!(await ensureSession())) return false;

  const body = pending;
  pending = {};
  setState("syncing");

  try {
    const res = await fetch(apiUrl("/api/sync"), {
      method: "PUT",
      credentials: API_CREDENTIALS,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!(await accepted(res))) {
      requeue(body);
      setState("error");
      return false;
    }

    setState("synced");
    return true;
  } catch {
    requeue(body);
    setState("error");
    return false;
  }
}

/**
 * Did the server actually take it?
 *
 * Three ways this can be no, and only the first is visible in `res.ok`:
 * a transport or server error, a 200 the route marked `{ok: false}` because a
 * table refused the write, and a 200 saying the session has gone. The last one
 * is the quiet one — `ensureSession()` caches `signedIn` for the page, so a
 * cookie that expires mid-session is first noticed here — and it also has to
 * clear that cache, or every subsequent flush repeats the same doomed request.
 */
async function accepted(res: Response): Promise<boolean> {
  if (!res.ok) return false;
  try {
    const body = (await res.json()) as { ok?: boolean; signedIn?: boolean };
    if (body.signedIn === false) {
      signedIn = false;
      return false;
    }
    return body.ok !== false;
  } catch {
    // An answer we cannot read is not an answer that anything was saved.
    return false;
  }
}

/** Newer queued values win — this is a batch coming back, not arriving. */
const requeue = (body: Payload) => {
  pending = { ...body, ...pending };
};

/**
 * Strips the one field that is never allowed to leave this device.
 *
 * `RunState.playerAge` is local age-gating. 0001's header lists it as one of
 * two fields "deliberately absent from this schema [that] must never be
 * added", the PUT handler has a comment saying sending it "would convert a
 * device preference into stored data about a child", and adoptFromCloud
 * restores it from local because "the server has never seen it".
 *
 * All of which was true of the PREFS payload, and false of this one. The run
 * is sent as an opaque blob — `state: run` straight into a jsonb column — and
 * playerAge is a field of RunState, so it rode along inside it and was stored
 * verbatim on the server. Three careful comments guarded the front door while
 * the field went through the wall.
 *
 * It is stripped here, on the way out, rather than only server-side: the point
 * is that a child's age never crosses the wire at all, and a strip that
 * happens after the request arrives has already failed at that.
 */
const withoutAge = (run: RunState): RunState => {
  const { playerAge: _dropped, ...rest } = run;
  return rest as RunState;
};

export function queueRun(run: RunState | null) {
  pending.run = run === null ? null : withoutAge(run);
  schedule();
}

/**
 * Pushes whatever is on this device to the account that is signed in NOW.
 *
 * Called once, straight after sign-up. A player who has been playing
 * anonymously has their companies in localStorage and nowhere else that they
 * can reach; sign-up mints a NEW auth user, so without this their progress
 * stays attached to the abandoned anonymous identity and the fresh account
 * starts empty on every other device.
 *
 * The ordinary debounced path would eventually carry it up — but only on the
 * next commit(), which never comes for someone who signs up and closes the
 * tab. "Made an account to keep my company, lost my company" is not a
 * behaviour to leave to chance.
 *
 * Awaited rather than queued, so the caller can reload knowing it landed —
 * and it reports whether it did. A false here is survivable rather than fatal:
 * the batch stays in `pending`, so the next commit carries it up, and the
 * device still has it either way.
 */
export async function pushLocalNow(): Promise<boolean> {
  if (disabled) return false;
  // Dynamic import for the same reason restoreOnBoot uses one: save.ts imports
  // this file, and a static cycle would leave one of them half-initialised.
  const { loadRun, loadLegacy, loadProfile } = await import("@/lib/engine/save");

  const profile = loadProfile();
  const run = loadRun();

  pending = {
    ...pending,
    // `run: null` is a real instruction (clearRun), so only send the key when
    // there is genuinely a company here — an empty device must not tell a
    // fresh account to delete a save it might have. Stripped of playerAge on
    // the way out, exactly as queueRun does.
    ...(run ? { run: withoutAge(run) } : {}),
    legacy: loadLegacy(),
    ...(profile
      ? {
          prefs: {
            rookieMode: profile.rookieMode,
            onboarded: profile.onboarded,
            micCalibration: profile.micCalibration,
            founderName: profile.founderName,
            // playerAge is deliberately absent, as everywhere else.
          },
        }
      : {}),
  };

  if (timer) clearTimeout(timer);
  return flush();
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

/** Guards the restore reload below so it can happen at most once per tab.
 *  Shared with lib/cloud/billing.ts, which clears it when a player returns
 *  from Stripe — see lib/cloud/keys.ts for why it lives in its own file. */
export { RESTORED_FLAG };

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
 *
 * **Entitlements are the exception to all of the above.** They are adopted on
 * every boot, and the server's copy always wins — see lib/cloud/billing.ts for
 * why the rule inverts. That is also why the "device already has saves, skip
 * the request" shortcut that used to sit here is gone: a subscription
 * cancelled last night, or a pack bought on a phone, is only knowable by
 * asking, and a device with a full localStorage is exactly the device that
 * would never have asked.
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

  const hasLocalRun = !!window.localStorage.getItem("novus:run:v1");
  const hasLocalLegacy = !!window.localStorage.getItem("novus:legacy:v1");
  const hasLocalProfile = !!window.localStorage.getItem("novus:profile:v1");

  const cloud = await pull();
  if (!cloud) return;

  // Runs first and unconditionally. A player whose Pro lapsed must not keep
  // The Room just because this device also has a save worth keeping.
  const entitlementsChanged = adoptEntitlements(cloud.entitlements);

  // Import here rather than at module scope: save.ts imports this file, and a
  // static cycle between the two would leave one of them half-initialised.
  const { adoptFromCloud } = await import("@/lib/engine/save");

  const run = hasLocalRun ? undefined : cloud.run;
  const legacy = hasLocalLegacy ? undefined : cloud.legacy;
  const prefs = hasLocalProfile ? undefined : cloud.prefs;

  if (!run && !legacy && !prefs) {
    // Nothing to restore, but a changed entitlement still has to reach screens
    // that read it once at mount. Same one-reload-per-tab guard.
    if (entitlementsChanged) markAndReload();
    return;
  }

  adoptFromCloud({ run, legacy, prefs });
  markAndReload();
}

/**
 * Re-enters the app once, and only once per tab.
 *
 * The flag is set BEFORE the reload, so a failure to write it means no reload
 * at all rather than a loop — the same trade the original restore made, now
 * shared with the entitlements path.
 */
function markAndReload(): void {
  try {
    window.sessionStorage.setItem(RESTORED_FLAG, "1");
  } catch {
    return;
  }
  window.location.reload();
}
