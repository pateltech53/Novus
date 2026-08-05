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
 * read it during render — `entryRoute()` behind AccountGate's CONTINUE button
 * (lib/entry.ts), `useState(() => loadLegacy().runsCompleted)` in ClosetScreen —
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

/** One company on the wire, with the slot that says which island it is. */
export interface CloudIsland {
  slot: number;
  state: RunState;
}

interface PullResult {
  configured: boolean;
  signedIn: boolean;
  /** Every island the account holds. Absent on an account that has none. */
  runs?: CloudIsland[] | null;
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
/*
 * ── Why `runs` is a map and not a field ────────────────────────────────────
 *
 * This was `run?: RunState | null`, one company, where `null` meant "delete
 * it". Two writes inside one 1500 ms debounce window therefore collapsed to
 * the later one — which was harmless while a device held a single company and
 * both writes named the same row, and is a lost delete the moment it does not:
 *
 *   endRun() on island 3   → pending.run = null    (delete)
 *   startRun() on island 0 → pending.run = state   (overwrites the delete)
 *
 * The DELETE never reaches the server, island 3 stays on the account, and it
 * comes back on the next device that restores. Keyed by slot, the two are
 * simply different entries and both are sent.
 *
 * `null` keeps its meaning per island: an instruction to delete that row.
 */
type RunPatch = Record<number, RunState | null>;
type Payload = { runs?: RunPatch; legacy?: LegacyState; prefs?: Prefs };

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

/**
 * Newer queued values win — this is a batch coming back, not arriving.
 *
 * `runs` is merged one island at a time rather than as a field. A shallow
 * spread would drop the whole returning map the instant any single island had
 * been queued since, which is exactly the failed-push-is-discarded bug the map
 * exists to prevent: island 0 queued while island 3's push was in flight must
 * not throw island 3 away.
 */
const requeue = (body: Payload) => {
  const runs = body.runs || pending.runs ? { ...body.runs, ...pending.runs } : undefined;
  pending = { ...body, ...pending, ...(runs ? { runs } : {}) };
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

export function queueRun(run: RunState | null, slot: number) {
  pending.runs = { ...pending.runs, [slot]: run === null ? null : withoutAge(run) };
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
  const { listIslands, loadRun, loadLegacy, loadProfile } = await import("@/lib/engine/save");

  const profile = loadProfile();

  /*
   * Every island, not the active one.
   *
   * This used to send `loadRun()` — one company — which was the whole device
   * when a device held one. Sending only the active island now would hand a
   * brand-new account one company and silently strand the rest on an
   * anonymous identity the player can never sign back into, which is the exact
   * failure this function exists to prevent.
   */
  const local: RunPatch = {};
  for (const island of listIslands()) {
    const state = loadRun(island.slot);
    // `null` is a real instruction (clearRun), so an island that failed to
    // load is SKIPPED rather than sent as null — an unreadable local blob must
    // never tell a fresh account to delete the copy it may already hold.
    if (state) local[island.slot] = withoutAge(state);
  }

  pending = {
    ...pending,
    // Same reason: only send the key when there is genuinely something here.
    // Anything already queued wins, being newer than this snapshot.
    ...(Object.keys(local).length > 0
      ? { runs: { ...local, ...pending.runs } }
      : {}),
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
export function restoreOnBoot(): Promise<void> {
  booted ??= boot();
  return booted;
}

/** The boot restore, held so a screen can wait for it instead of racing it. */
let booted: Promise<void> | null = null;

/**
 * How long the front door waits for a restore before going with whatever is
 * already on the device.
 *
 * Long enough for a phone on mobile data; short enough that a network which
 * never answers is a pause rather than a locked door. Playing on localStorage
 * alone is a supported way to run Novus, so the timeout lands somewhere real.
 */
const RESTORE_WAIT_MS = 4000;

/**
 * Resolves once the boot restore has settled, or given up waiting for it.
 *
 * The front door needs this. CONTINUE routes on what is in localStorage
 * (`entryRoute()`), and on a device that has never seen this account — a new
 * phone, a cleared browser, a school machine — the company that answers that
 * question is still on the wire. Routing before it lands sends a returning
 * player into onboarding, or to a found screen offering them a company they
 * already have.
 *
 * Resolves immediately when no restore is running, which is the common case: a
 * device with no account never starts one, and the flag stops the second.
 */
export function whenRestored(): Promise<void> {
  if (!booted) return Promise.resolve();
  // Settled, not resolved: a restore that threw must let the player in, not
  // reject into a click handler that has no way to answer for it.
  const settled = booted.then(
    () => undefined,
    () => undefined,
  );
  return Promise.race([
    settled,
    new Promise<void>((resolve) => setTimeout(resolve, RESTORE_WAIT_MS)),
  ]);
}

async function boot(): Promise<void> {
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

  const landed = await pullAndAdopt();

  /*
   * Only a RUN is worth re-entering the app for.
   *
   * ── What this used to do, and what it cost ─────────────────────────────
   *
   * `landed.saves || landed.entitlements` — so a legacy row, a prefs row or a
   * changed entitlement reloaded the whole app too. Each of those is a real
   * reason to want a fresh mount and none of them is worth what a reload costs
   * on a device: it happens whenever the network answers, which is a second or
   * two after launch, which is exactly when the player is pressing something.
   * The reload takes the press with it, and the button reads as broken.
   *
   * That is not a new failure — it is the one `markAndReload` already documents
   * for the web front door, where the fix was to skip the reload on "/". The
   * reasoning there ended with "the shipped app is untouched: it boots straight
   * to /play, /found or /welcome, so a restore there still re-enters exactly as
   * before." Which is the bug: in the app those three screens are not a front
   * door being passed through, they are where the player is standing.
   *
   * ── Why a run is different ─────────────────────────────────────────────
   *
   * A run is only ever adopted onto a device that has none (see pullAndAdopt).
   * So a reload for one cannot interrupt a game in progress — there is no game
   * in progress — and it is the case the restore exists for: a new phone,
   * where the alternative is a player staring at onboarding they finished
   * months ago.
   *
   * The other three do not need it. Entitlements announce themselves
   * (`saveEntitlements` → `announce()`, which is why the closet and the
   * industry grid pick up a purchase without one). Legacy is read by screens
   * that mount after a run ends. Prefs reach the next screen the player opens.
   * All three are visible on the next mount; none is worth a lost tap.
   */
  if (landed.run) markAndReload();
}

/**
 * Pulls the account's copy onto this device and adopts what the device is
 * missing. Goes nowhere and reloads nothing — the caller decides that.
 *
 * Split out of the boot restore so a caller who is ABOUT to navigate can make
 * the data land first. That is the whole of the sign-in problem: signing in
 * empties this device on purpose (lib/cloud/auth.ts), so a route chosen from
 * localStorage a moment later is chosen for nobody.
 */
async function pullAndAdopt(): Promise<{
  /** A company landed on a device that had none. The only one worth a reload. */
  run: boolean;
  legacy: boolean;
  prefs: boolean;
  entitlements: boolean;
}> {
  const nothing = { run: false, legacy: false, prefs: false, entitlements: false };
  if (typeof window === "undefined") return nothing;

  const hasLocalLegacy = !!window.localStorage.getItem("novus:legacy:v1");
  const hasLocalProfile = !!window.localStorage.getItem("novus:profile:v1");

  const cloud = await pull();
  if (!cloud) return nothing;

  // Runs first and unconditionally. A player whose Pro lapsed must not keep
  // The Room just because this device also has a save worth keeping.
  const entitlements = adoptEntitlements(cloud.entitlements);

  // Import here rather than at module scope: save.ts imports this file, and a
  // static cycle between the two would leave one of them half-initialised.
  const { adoptFromCloud, listIslands } = await import("@/lib/engine/save");

  /*
   * "Local always wins" — now decided PER ISLAND.
   *
   * It used to be one device-level boolean: any company here at all meant the
   * cloud copy was refused wholesale. With islands that rule is not
   * conservative, it is lossy — a device holding one company would refuse to
   * adopt the other nine, forever, with nothing on screen to say so.
   *
   * Per slot it means what it always meant, and means it more precisely: a
   * company in progress on THIS device is never replaced by a server copy,
   * and an island this device has never seen is simply restored.
   */
  const held = new Set(listIslands().map((i) => i.slot));
  const runs = (cloud.runs ?? []).filter((i) => !held.has(i.slot));
  const legacy = hasLocalLegacy ? undefined : cloud.legacy;
  const prefs = hasLocalProfile ? undefined : cloud.prefs;

  if (runs.length === 0 && !legacy && !prefs) {
    return { run: false, legacy: false, prefs: false, entitlements };
  }

  adoptFromCloud({ runs, legacy, prefs });
  // Reported per category rather than as one "saves" flag: the caller reloads
  // for exactly one of them, and rolling three together is what made a prefs
  // row cost the same as a company.
  return { run: runs.length > 0, legacy: !!legacy, prefs: !!prefs, entitlements };
}

/**
 * Bring the account's saves down NOW, for a caller about to decide where the
 * player goes.
 *
 * The one caller is the in-app sign-in (components/screens/SettingsScreen).
 * The web front door does not need it — AccountGate hands the same decision to
 * the boot restore by way of `whenRestored()` — but the shipped app has no
 * front door to hand it to: "/" is the marketing page, and a store build may
 * not show it at all (lib/commerce.ts). So the app waits here instead.
 *
 * Never throws: a sign-in that worked must not be reported as a failure
 * because the save behind it was slow. The player is signed in either way, and
 * the ordinary boot restore on the next page is still behind this.
 */
export async function restoreForSignIn(): Promise<void> {
  try {
    await pullAndAdopt();
  } catch {
    /* the account is still signed in; the next boot will try again */
  }
}

/**
 * Re-enters the app once, and only once per tab — but never the front door.
 *
 * The flag is set BEFORE the reload, so a failure to write it means no reload
 * at all rather than a loop — the same trade the original restore made, now
 * shared with the entitlements path.
 *
 * ── The bug this exception fixes ───────────────────────────────────────────
 *
 * On the web a tab starts at "/", so the front door is where this almost
 * always landed — and reloading it took the player's tap with it. CONTINUE AS
 * is a client-side push, and for the second or so that /play's bundle is on
 * the wire the URL is still "/": the reload re-entered the landing page, the
 * push was thrown away, and the one button on the screen read as broken. It
 * looked intermittent because it was a race, and it cleared up after one
 * reload because by then the flag was set.
 *
 * Skipping it there costs nothing. The landing page is the only screen that
 * reads no saved state at mount — the gate resolves `entryRoute()` inside the
 * click handler — so an adopt is already visible to it the moment it lands.
 * The screens that DO snapshot at mount (/play, /found, and everything they
 * hold) are reached by a navigation that mounts them fresh anyway.
 *
 * ── And never on top of a player ───────────────────────────────────────────
 *
 * The paragraph above used to end by noting that the shipped app was untouched,
 * because it boots straight to /play, /found or /welcome rather than to "/".
 * That was the wrong conclusion drawn from the right observation: in the app
 * those three screens are not somewhere the player is passing through, they are
 * where the player is standing and pressing things. A restore that lands a
 * second after launch reloads the screen out from under the press, and the
 * player sees a button that did nothing — or, on /play, a white webview while
 * the page re-parses.
 *
 * So the reload is off the table the moment anybody has touched the screen. It
 * costs nothing to skip: every route this restore matters to reads its state at
 * mount, and a player who is interacting is about to mount one — the tap they
 * just made is the navigation. `capture: true` and `once: true` so the listener
 * sees the press before any handler can stop it and then gets out of the way.
 */
let touched = false;

if (typeof window !== "undefined") {
  const noticed = () => {
    touched = true;
  };
  for (const event of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(event, noticed, { capture: true, once: true, passive: true });
  }
}

function markAndReload(): void {
  try {
    window.sessionStorage.setItem(RESTORED_FLAG, "1");
  } catch {
    return;
  }
  if (onTheFrontDoor() || touched) return;
  window.location.reload();
}

/** "/" — and the same page as the static export names it. */
function onTheFrontDoor(): boolean {
  const path = window.location.pathname;
  return path === "/" || path === "/index.html";
}
