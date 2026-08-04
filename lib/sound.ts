/**
 * Interface sound.
 *
 * Not music — cues. Each one marks a thing that actually happened in the game
 * world, and the app is completely playable with the volume at zero: every cue
 * has a visual twin. Nothing here is load-bearing.
 *
 * ── Why this is the Web Audio API and not <audio> ────────────────────────────
 * It used to be a pool of HTMLAudioElements with `volume` set per cue. iOS
 * ignores `HTMLMediaElement.volume` entirely — only the hardware rocker moves
 * it — so on an iPhone every gain below was discarded and every cue played at
 * 100%: clicks mixed to be felt-not-heard arrived at full blast, and the Tank's
 * ambient bed, ducked to stay under dialogue, was the loudest thing in the
 * room. GainNodes are honoured everywhere, so the mix below now means the same
 * thing on a phone as on a laptop. Decoded buffers also start in the same
 * frame as the tap (an element with `preload="none"` fetched its mp3 on first
 * play, which is why first clicks used to arrive late or not at all), and
 * overlapping plays no longer fight over one element's playhead.
 *
 * ── Rules this file enforces ─────────────────────────────────────────────────
 * · Lazy. Nothing is fetched until a cue is first asked for — except that the
 *   first real gesture warms the incidental band (click, tab, activity,
 *   success), so the taps a player makes constantly never pay the first-fetch
 *   cost. First paint still never waits on 1.7 MB of audio.
 * · Unlocked by a real gesture. Browsers refuse audio before the player has
 *   interacted; `unlock()` is called from the first pointerdown and every
 *   earlier request is silently dropped rather than throwing. Every later
 *   play() nudges a suspended context awake, which is what recovers sound
 *   after an iOS interruption — a phone call, Siri — without a listener.
 * · Muted by default until that gesture, and permanently mutable by the player.
 * · Ambient loops are ducked hard (0.1) so dialogue always wins.
 * · A cue is a moment. One that could not start promptly is dropped, never
 *   played late — a click that lands a second after the tap reads as a bug.
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

/** The cues warmed right after the unlock gesture — the ones that fire
 *  constantly, whose first play must never be their first fetch. */
const WARM: Cue[] = ["click", "tab", "activity", "success"];

/** A one-shot whose buffer took longer than this to arrive is dropped. */
const STALE_MS = 1500;

/** Loop fade, in seconds, so the bed breathes in and out instead of popping. */
const LOOP_FADE_S = 0.25;

const STORAGE_KEY = "novus:sound:v1";

let unlocked = false;
let muted = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Decoded audio, one in-flight promise per cue so nothing is fetched twice. */
const buffers = new Map<Cue, Promise<AudioBuffer | null>>();
/** Loops actually sounding, by cue, so stopLoop can find them. */
const liveLoops = new Map<Cue, { src: AudioBufferSourceNode; gain: GainNode }>();
/** Loops whose buffer is still arriving — a stopLoop in that window cancels
 *  the start instead of racing it. */
const pendingLoops = new Set<Cue>();
/** One-shots currently sounding, so stopAll can silence a room it is leaving. */
const oneShots = new Set<AudioBufferSourceNode>();

if (typeof window !== "undefined") {
  muted = window.localStorage?.getItem(STORAGE_KEY) === "off";
}

/** Safari shipped the API prefixed for years; old WebKit still does. */
function contextCtor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.AudioContext ?? w.webkitAudioContext) as (new () => AudioContext) | null;
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = contextCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER;
  master.connect(ctx.destination);
  return ctx;
}

/**
 * The app's ONE AudioContext, for anything that needs a context at all.
 *
 * The level meter used to mint its own (`createLevelMeter`), which meant two
 * live contexts at two sample rates the moment a microphone opened — the sound
 * effects' context created in the playback session, a second created after
 * getUserMedia flipped the session to play-and-record. Two mismatched contexts
 * plus the TTS element is a known WebKit crackle configuration, and on iOS the
 * per-answer create/close churn in the Tank made it worse. One context, one
 * rate, no churn.
 */
export function sharedAudioContext(): AudioContext | null {
  const c = ensureContext();
  if (c) wake(c);
  return c;
}

/** Nudge a suspended context awake. Called inside real gestures (every play()
 *  runs in a click), which is what iOS requires after an interruption. */
function wake(c: AudioContext): void {
  if (c.state !== "running") {
    try {
      void c.resume().catch(() => {});
    } catch {
      /* not now — the next gesture will try again */
    }
  }
}

/**
 * Both decodeAudioData forms, because iOS carried the callback-only version
 * for a long time. A promise settles once, so the double wiring cannot
 * double-resolve.
 */
function decode(c: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const maybe = c.decodeAudioData(bytes, resolve, reject);
    if (maybe) void maybe.then(resolve).catch(reject);
  });
}

/**
 * The decoded buffer for a cue, fetched and decoded at most once. A load that
 * FAILS is forgotten rather than cached, so one dropped request on a flaky
 * phone network does not silence that cue for the rest of the session.
 */
function load(cue: Cue, c: AudioContext): Promise<AudioBuffer | null> {
  let p = buffers.get(cue);
  if (!p) {
    p = fetch(SRC[cue])
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error())))
      .then((bytes) => decode(c, bytes))
      .catch(() => {
        buffers.delete(cue);
        return null;
      });
    buffers.set(cue, p);
  }
  return p;
}

/**
 * Call once from the first real user gesture. Before this, every play() is a
 * no-op — which is correct, not a bug: an autoplay rejection in the console on
 * page load is noise, and the player has not asked for sound yet. This is also
 * the one moment the AudioContext can be created already-permitted, and the
 * moment the incidental band is warmed.
 */
export function unlockSound(): void {
  unlocked = true;
  const c = ensureContext();
  if (!c) return;
  wake(c);
  if (!muted) for (const cue of WARM) void load(cue, c);
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
  if (master) master.gain.value = next ? 0 : MASTER;
  if (next) stopAll();
}

/** Fire a cue. Safe to call from anywhere, including render-adjacent effects. */
export function play(cue: Cue): void {
  if (!unlocked || muted) return;
  if (LOOPS.includes(cue)) {
    startLoop(cue);
    return;
  }
  const c = ensureContext();
  if (!c) return;
  wake(c);
  const asked = Date.now();
  void load(cue, c).then((buffer) => {
    if (!buffer || muted) return;
    // Late is worse than silent, and a context that never woke would queue
    // this to burst out whenever it finally does.
    if (Date.now() - asked > STALE_MS || c.state !== "running") return;
    try {
      const src = c.createBufferSource();
      src.buffer = buffer;
      const gain = c.createGain();
      gain.gain.value = GAIN[cue] ?? 0.3;
      src.connect(gain);
      gain.connect(master as GainNode);
      oneShots.add(src);
      src.onended = () => {
        oneShots.delete(src);
        try {
          src.disconnect();
          gain.disconnect();
        } catch {
          /* already gone */
        }
      };
      src.start();
    } catch {
      /* a cue that cannot start is dropped, exactly as before */
    }
  });
}

/** Start a looping bed. Idempotent. */
export function startLoop(cue: Cue): void {
  if (!LOOPS.includes(cue)) return;
  if (!unlocked || muted) return;
  if (liveLoops.has(cue) || pendingLoops.has(cue)) return;
  const c = ensureContext();
  if (!c) return;
  wake(c);
  pendingLoops.add(cue);
  void load(cue, c).then((buffer) => {
    // stopLoop while the buffer was arriving deletes the marker; a start that
    // has been cancelled must stay cancelled.
    if (!pendingLoops.delete(cue)) return;
    if (!buffer || muted || liveLoops.has(cue)) return;
    try {
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0, c.currentTime);
      gain.gain.linearRampToValueAtTime(GAIN[cue] ?? 0.3, c.currentTime + LOOP_FADE_S);
      src.connect(gain);
      gain.connect(master as GainNode);
      src.start();
      liveLoops.set(cue, { src, gain });
    } catch {
      /* no bed is a normal way to be in the room */
    }
  });
}

export function stopLoop(cue: Cue): void {
  pendingLoops.delete(cue);
  const live = liveLoops.get(cue);
  if (!live || !ctx) return;
  liveLoops.delete(cue);
  const { src, gain } = live;
  src.onended = () => {
    try {
      src.disconnect();
      gain.disconnect();
    } catch {
      /* already gone */
    }
  };
  try {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + LOOP_FADE_S);
    src.stop(ctx.currentTime + LOOP_FADE_S + 0.01);
  } catch {
    try {
      src.stop();
    } catch {
      /* nothing to stop */
    }
  }
}

export function stopAll(): void {
  for (const cue of [...liveLoops.keys()]) stopLoop(cue);
  pendingLoops.clear();
  for (const src of [...oneShots]) {
    try {
      src.stop();
    } catch {
      /* already ended */
    }
  }
  oneShots.clear();
}
