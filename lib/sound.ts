/**
 * Interface sound.
 *
 * Not music — cues. Each one marks a thing that actually happened in the game
 * world, and the app is completely playable with the volume at zero: every cue
 * has a visual twin. Nothing here is load-bearing.
 *
 * ── Rules this file enforces ─────────────────────────────────────────────────
 * · Lazy. Nothing is fetched until the first time a cue actually fires, so the
 *   first paint never waits on 1.7 MB of audio.
 * · Unlocked by a real gesture. Browsers refuse audio before the player has
 *   interacted; `unlock()` is called from the first pointerdown and every
 *   earlier request is silently dropped rather than throwing.
 * · Muted by default until that gesture, and permanently mutable by the player.
 * · Ambient loops are ducked hard (0.18) so dialogue always wins.
 */

export type Cue =
  | "click" // any button
  | "success" // a commit that worked
  | "activity" // opening an activity / non-time-advancing screen
  | "tab" // moving along the bottom menu bar
  | "error" // insufficient funds, a hire you cannot afford
  | "money" // cash actually moved
  | "celebrate" // a good verdict
  | "fail" // Chapter 7
  | "bonus" // a windfall
  | "hire" // LinkedOut hire approved
  | "mail" // new BeeMail
  | "tank-sting" // The Tank logo hits
  | "tank-ambient" // low bed under The Tank
  | "unlock" // a founder tier opened
  | "splash"; // splash, and the beat after onboarding

const SRC: Record<Cue, string> = {
  click: "/sfx/click.mp3",
  success: "/sfx/success.mp3",
  activity: "/sfx/activity.mp3",
  tab: "/sfx/tab.mp3",
  error: "/sfx/error.mp3",
  money: "/sfx/money.mp3",
  celebrate: "/sfx/celebrate.mp3",
  fail: "/sfx/fail.mp3",
  bonus: "/sfx/bonus.mp3",
  hire: "/sfx/hire.mp3",
  mail: "/sfx/mail.mp3",
  "tank-sting": "/sfx/tank-sting.mp3",
  "tank-ambient": "/sfx/tank-ambient.mp3",
  unlock: "/sfx/unlock.mp3",
  splash: "/sfx/splash.mp3",
};

/**
 * Master trim. Everything was mixed too hot — a UI click should be felt more
 * than heard, and none of these should ever be the loudest thing in the room.
 */
const MASTER = 0.55;

/**
 * Per-cue gain, in a deliberate order of loudness:
 *
 *   incidental  (click, tab)          barely there — you touch these constantly
 *   confirming  (success, activity)   slightly present, a small "yes"
 *   consequence (money, hire, error)  audible, because something happened
 *   event       (celebrate, fail…)    the loudest, and the rarest
 *
 * If a cue fires more than a few times a minute it belongs in the first band.
 */
const GAIN: Record<Cue, number> = {
  click: 0.16,
  tab: 0.2,
  activity: 0.24,
  success: 0.3,

  error: 0.4,
  money: 0.45,
  hire: 0.4,
  mail: 0.35,

  bonus: 0.5,
  celebrate: 0.55,
  fail: 0.5,
  unlock: 0.6,
  splash: 0.5,

  "tank-sting": 0.45,
  "tank-ambient": 0.1,
};

const LOOPS: Cue[] = ["tank-ambient"];

const STORAGE_KEY = "novus:sound:v1";

let unlocked = false;
let muted = false;
const pool = new Map<Cue, HTMLAudioElement>();

if (typeof window !== "undefined") {
  muted = window.localStorage?.getItem(STORAGE_KEY) === "off";
}

function el(cue: Cue): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  let a = pool.get(cue);
  if (!a) {
    a = new Audio(SRC[cue]);
    a.preload = "none";
    a.loop = LOOPS.includes(cue);
    a.volume = (GAIN[cue] ?? 0.3) * MASTER;
    pool.set(cue, a);
  }
  return a;
}

/**
 * Call once from the first real user gesture. Before this, every play() is a
 * no-op — which is correct, not a bug: an autoplay rejection in the console on
 * page load is noise, and the player has not asked for sound yet.
 */
export function unlockSound(): void {
  unlocked = true;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage?.setItem(STORAGE_KEY, next ? "off" : "on");
  } catch {
    /* private mode */
  }
  if (next) for (const a of pool.values()) a.pause();
}

/** Fire a cue. Safe to call from anywhere, including render-adjacent effects. */
export function play(cue: Cue): void {
  if (!unlocked || muted) return;
  const a = el(cue);
  if (!a) return;
  try {
    if (!LOOPS.includes(cue)) a.currentTime = 0;
    // Rejections are expected (tab hidden, no gesture yet) and are not errors
    // the player should ever see.
    void a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Start a looping bed. Idempotent. */
export function startLoop(cue: Cue): void {
  if (!LOOPS.includes(cue)) return;
  play(cue);
}

export function stopLoop(cue: Cue): void {
  const a = pool.get(cue);
  if (!a) return;
  a.pause();
  a.currentTime = 0;
}

export function stopAll(): void {
  for (const a of pool.values()) {
    a.pause();
    a.currentTime = 0;
  }
}
