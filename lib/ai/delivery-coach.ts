/**
 * HOW YOU CAME ACROSS — camera and volume coaching for a live take.
 *
 * ── WHICH SIDE OF THE LINE THIS FILE IS ON ──────────────────────────────────
 *
 * `lib/ai/pitch-content.ts` cuts pitch judging in two, structurally rather than
 * by convention. `scorePitchContent` produces the 0..10 that the panel, the year
 * gate and the autopsy all read, and it is deliberately unable to reach
 * `deliveryMetrics`, which is handed to the player and graded nowhere.
 *
 * THIS FILE SITS ON THE `deliveryMetrics` SIDE. Everything it measures is
 * coaching feedback and is never scored. Nothing here touches the pitch score,
 * the panel outcome, the year gate, or any stat.
 *
 * The boundary is kept the same way the other one is — structurally, so that
 * folding it into the score takes a deliberate act rather than an accident:
 *
 *   · this file imports nothing from `lib/engine` and nothing from `lib/state`,
 *     so there is no path from here into a run;
 *   · nothing it exports returns a 0..10, a weight, or a delta;
 *   · the report type carries no `score` field, and carries `scored: false`
 *     so anyone reading the type meets the rule before they meet the numbers.
 *
 * Brand Law 5: never score accent, pitch of voice, energy level, or speech
 * rhythm. Volume, sway, gaze and gesture are all delivery — the same class of
 * thing — so they get the same treatment. A teenager with a quiet voice, a
 * stutter, a tic, a wheelchair, or a room where they cannot stand up straight
 * must be able to win here on the strength of the business. The camera exists so
 * they can practise, not so it can mark them.
 *
 * ── PRIVACY ─────────────────────────────────────────────────────────────────
 *
 * Frames are read in memory and discarded as they are read. The video element is
 * handed straight to the model; no frame is copied to a canvas, no landmark
 * history is retained, and no image, landmark or measurement is uploaded or
 * persisted. What survives a sample is a handful of running totals — see the
 * `Spread` accumulator, which keeps a mean and a variance rather than a series
 * precisely so there is nothing to leak. This is a product for minors and that
 * is a floor, not a feature. It is also stated in the UI, not only here.
 *
 * ── GRACEFUL ABSENCE ────────────────────────────────────────────────────────
 *
 * The vision runtime is loaded at runtime from our own origin, never bundled and
 * never fetched from a third party, so the app builds and runs unchanged when it
 * is not installed. If the files are missing, the device is small, the browser
 * says Save-Data, the model is slow, or the camera never opened, `stop()`
 * returns null and the coaching panel simply does not appear. Inference is
 * capped to a fraction of wall-clock time and abandons itself if it overruns:
 * a take must never be slowed down by the thing watching it.
 */

// ── The runtime, described rather than imported ─────────────────────────────
//
// Structural types for the slice of @mediapipe/tasks-vision we use. Declared
// locally on purpose: `import type` from the package would make a missing
// package a typecheck failure, and this module has to compile without it.

interface MpLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

interface MpCategory {
  categoryName: string;
  score: number;
}

interface MpFaceResult {
  faceLandmarks: MpLandmark[][];
  faceBlendshapes: { categories: MpCategory[] }[];
  facialTransformationMatrixes: { data: number[] }[];
}

interface MpPoseResult {
  landmarks: MpLandmark[][];
}

interface MpDetector<R> {
  detectForVideo(frame: HTMLVideoElement, timestampMs: number): R;
  close(): void;
}

interface MpVision {
  FilesetResolver: { forVisionTasks(wasmPath: string): Promise<unknown> };
  FaceLandmarker: {
    createFromOptions(fileset: unknown, options: unknown): Promise<MpDetector<MpFaceResult>>;
  };
  PoseLandmarker: {
    createFromOptions(fileset: unknown, options: unknown): Promise<MpDetector<MpPoseResult>>;
  };
}

/**
 * Where the runtime lives. Same-origin by default: a CDN would mean a minors'
 * product opening a connection to a third party every time a camera turns on,
 * which is a worse trade than a few megabytes in `public/`.
 */
export interface DeliveryCoachAssets {
  /** The tasks-vision ESM bundle. */
  bundle: string;
  /** Directory holding vision_wasm_internal.js and .wasm. */
  wasm: string;
  /** face_landmarker.task */
  face: string;
  /** pose_landmarker_lite.task — optional; without it, hands and torso go quiet. */
  pose: string;
}

const DEFAULT_ASSETS: DeliveryCoachAssets = {
  bundle: "/vendor/mediapipe/vision_bundle.mjs",
  wasm: "/vendor/mediapipe/wasm",
  face: "/vendor/mediapipe/face_landmarker.task",
  pose: "/vendor/mediapipe/pose_landmarker_lite.task",
};

// ── What comes out ──────────────────────────────────────────────────────────

export interface VolumeCoaching {
  /** Mean reading while audible, on the same 0..1 curve the on-screen bar draws. */
  averageLevel: number;
  /** 0..1 share of the take spent under the audible floor. */
  quietShare: number;
  /** Times the level fell under the floor mid-sentence and stayed there. */
  dropouts: number;
  longestDropoutSeconds: number;
  samples: number;
}

export interface CameraCoaching {
  /** Frames actually read. Under `MIN_FRAMES` there is no card at all. */
  frames: number;
  /** 0..1 share of read frames with head and eyes pointed at the lens. */
  eyeContactShare: number;
  /** Longest unbroken stretch off the lens, in seconds. */
  longestAwaySeconds: number;
  /** Of the frames spent off the lens, the share where the eyes were down. */
  lookedDownShare: number;
  /** Drift of the head centre across the take, in head-widths. */
  headSway: number | null;
  /** Same for the shoulder line, in shoulder-widths. Null without the pose model. */
  torsoSway: number | null;
  /** Hand moves per minute. Null without the pose model. */
  gesturesPerMinute: number | null;
  /** 0..1 share of pose frames with a wrist actually in shot. */
  handsVisibleShare: number | null;
}

export interface CoachingNote {
  topic: "volume" | "eyes" | "sway" | "hands";
  /** Shown to the player verbatim. Never about accent, pitch, energy or rhythm. */
  text: string;
  /** Colours the row. Not a grade — there is no grade on this side of the line. */
  tone: "ok" | "watch";
}

export interface DeliveryCoaching {
  /**
   * Always false. Present so that the first thing anyone reading this type sees
   * is the rule: none of what follows is scored, anywhere, ever.
   */
  readonly scored: false;
  /** Length of the observed window, seconds. */
  seconds: number;
  volume: VolumeCoaching | null;
  camera: CameraCoaching;
  notes: CoachingNote[];
}

export interface DeliveryCoachOptions {
  /** The live preview. Read frame by frame, never copied, never kept. */
  video: HTMLVideoElement | null;
  /**
   * The existing WebAudio meter (`createLevelMeter` in lib/media/recorder).
   * Passing the one already running is cheaper than opening a second
   * AudioContext, and it means the number the player is coached on is the number
   * they watched on the bar.
   */
  readLevel?: () => number;
  /** Fallback when no meter is supplied — an AnalyserNode of our own. */
  stream?: MediaStream | null;
  assets?: Partial<DeliveryCoachAssets>;
}

/**
 * A live reading, for the strip that renders DURING the take.
 *
 * Exists because a coach that only speaks after the pitch looks broken while
 * the pitch is happening — the first user test reported "it doesn't track my
 * gestures or anything" while the tracker was, in fact, tracking. Proof has to
 * be on screen while it is true. Same rule as the report: read, shown, never
 * scored.
 */
export interface DeliveryLive {
  /** False until the face model is armed and reading frames. */
  tracking: boolean;
  /** Was the last read frame on-lens? Null before the first frame. */
  eyesOn: boolean | null;
  framesRead: number;
  /** Hand moves counted so far. Null without the pose model. */
  gestures: number | null;
  /** Volume level 0..1 as the meter reads it right now. */
  level: number;
}

export interface DeliveryCoach {
  /** Resolves true once the camera side is live. Never rejects. */
  readonly ready: Promise<boolean>;
  /** Begin the observation window. Safe to call before `ready` settles. */
  start(): void;
  /** Cheap, synchronous, callable every frame. */
  live(): DeliveryLive;
  /** Close the window and return the coaching, or null if there is not enough. */
  stop(): DeliveryCoaching | null;
  dispose(): void;
}

// ── Thresholds ──────────────────────────────────────────────────────────────

/** Under this, the meter is reading a room rather than a person. */
const AUDIBLE_FLOOR = 0.12;
/** A gap shorter than this is a breath; longer than this is a pause, not a fade. */
const DROPOUT_MIN_S = 1;
const DROPOUT_MAX_S = 6;
/**
 * A touch-first device — where every cadence below halves. Every figure this
 * coach reports is a share or a per-minute rate, so sampling slower changes
 * NOTHING about what is reported; it only stops the measuring from being why
 * the pitch stutters on the machine that is also running the camera, the
 * recorder and the recogniser. Do not "save" the coach by loosening the
 * abandon thresholds instead — that path deletes the whole card.
 */
const onPhone = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
/** Volume is cheap to sample, so it runs far faster than inference. */
const VOLUME_INTERVAL_MS = 50;
const VOLUME_INTERVAL_MOBILE_MS = 100;

/** Head off the lens by more than this reads as looking elsewhere. */
const FACING_DEG = 22;
/** Blendshape strength at which a glance counts as off-lens. */
const EYES_OFF = 0.45;
/** MediaPipe pose indices. Named because 15 and 16 mean nothing on sight. */
const POSE_L_SHOULDER = 11;
const POSE_R_SHOULDER = 12;
const POSE_L_WRIST = 15;
const POSE_R_WRIST = 16;
const WRIST_VISIBLE = 0.5;
/** Shoulder-widths per second. Hysteresis so one wave is one gesture, not forty. */
const GESTURE_ON = 0.9;
const GESTURE_OFF = 0.35;

/** Target sampling rate for inference. Eight a second is plenty for coaching
 *  on a desktop; four a second is plenty on a phone, where the GPU has a
 *  camera pipeline to run as well. */
const BASE_INTERVAL_MS = 125;
const BASE_INTERVAL_MOBILE_MS = 250;
const MAX_INTERVAL_MS = 500;
/** Never occupy more than a fifth of wall-clock time (a tenth on phones). */
const DUTY = 5;
const DUTY_MOBILE = 9;
/** Sustained cost above this and the camera side gives up rather than stutters. */
const ABANDON_MS = 90;
const ABANDON_STRIKES = 5;
/** Fewer frames than this and there is nothing honest to say. */
const MIN_FRAMES = 24;

// ── Capability ──────────────────────────────────────────────────────────────

/**
 * Whether it is worth trying at all. Cheap, synchronous, and deliberately
 * pessimistic: the cost of a false yes is a slow pitch, the cost of a false no
 * is a missing practice card.
 */
export function deliveryCoachSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (typeof WebAssembly === "undefined") return false;

  const cores = navigator.hardwareConcurrency ?? 0;
  if (cores > 0 && cores < 4) return false;

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memory === "number" && memory < 4) return false;

  // The player told the browser not to pull large files. Twelve megabytes of
  // model is exactly what that setting is about.
  const conn = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  if (conn?.saveData) return false;
  if (conn?.effectiveType && /^(slow-)?2g$/.test(conn.effectiveType)) return false;

  return true;
}

// ── Accumulators ────────────────────────────────────────────────────────────

/**
 * Running mean and variance of a 2D centre, plus a mean reference width.
 *
 * Welford rather than a stored series: keeping every position would mean holding
 * a movement trace of a minor for the length of the take. Two numbers per axis
 * hold the same answer and hold nothing about them.
 */
class Spread {
  private n = 0;
  private meanX = 0;
  private m2X = 0;
  private meanY = 0;
  private m2Y = 0;
  private meanScale = 0;

  push(x: number, y: number, scale: number) {
    this.n += 1;
    const dx = x - this.meanX;
    this.meanX += dx / this.n;
    this.m2X += dx * (x - this.meanX);
    const dy = y - this.meanY;
    this.meanY += dy / this.n;
    this.m2Y += dy * (y - this.meanY);
    this.meanScale += (scale - this.meanScale) / this.n;
  }

  /** RMS drift of the centre, expressed in reference widths. */
  value(): number | null {
    if (this.n < 12 || this.meanScale <= 0) return null;
    const rms = Math.sqrt((this.m2X + this.m2Y) / this.n);
    return round2(rms / this.meanScale);
  }
}

const round1 = (n: number) => Number(n.toFixed(1));
const round2 = (n: number) => Number(n.toFixed(2));
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

// ── The coach ───────────────────────────────────────────────────────────────

export function createDeliveryCoach(options: DeliveryCoachOptions): DeliveryCoach {
  const assets = { ...DEFAULT_ASSETS, ...options.assets };
  const video = options.video;

  let faceModel: MpDetector<MpFaceResult> | null = null;
  let poseModel: MpDetector<MpPoseResult> | null = null;
  let ownMeter: { read(): number; close(): void } | null = null;

  let disposed = false;
  let running = false;
  let visionDead = false;
  let startedAt = 0;
  let stoppedAt = 0;

  let visionTimer = 0;
  let volumeTimer = 0;
  let lastTimestamp = 0;
  let costEma = 0;
  let strikes = 0;

  // Volume tallies.
  let volN = 0;
  let volSum = 0;
  let audibleN = 0;
  let audibleSum = 0;
  let quietSince: number | null = null;
  let spokeAlready = false;
  let dropouts = 0;
  let longestDropout = 0;

  // Camera tallies.
  let frames = 0;
  let onLens = 0;
  /** Last frame's verdict, for the live strip. Null before the first frame. */
  let lastEyesOn: boolean | null = null;
  let lookedDown = 0;
  let awaySince: number | null = null;
  let longestAway = 0;
  const headDrift = new Spread();
  const torsoDrift = new Spread();
  let poseFrames = 0;
  let wristFrames = 0;
  let gestures = 0;
  let inGesture = false;
  let lastWrists: { lx: number; ly: number; rx: number; ry: number; at: number } | null = null;

  let settle: ((ok: boolean) => void) | null = null;
  const ready = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const settleReady = (ok: boolean) => {
    settle?.(ok);
    settle = null;
  };

  // ── Warm-up ───────────────────────────────────────────────────────────────

  async function loadVision(): Promise<MpVision | null> {
    try {
      // Runtime URL, not a bundler specifier: this is what lets the app build
      // and run with the package absent. Both bundlers are told to leave it be.
      const bundle = assets.bundle;
      const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ bundle)) as
        | MpVision
        | undefined;
      return mod?.FilesetResolver ? mod : null;
    } catch {
      if (process.env.NODE_ENV !== "production") {
        console.info(
          `[delivery-coach] no vision runtime at ${assets.bundle} — coaching panel stays hidden.`,
        );
      }
      return null;
    }
  }

  async function warmUp() {
    if (!video || !deliveryCoachSupported()) {
      settleReady(false);
      return;
    }
    const mod = await loadVision();
    if (!mod || disposed) {
      settleReady(false);
      return;
    }

    let fileset: unknown;
    try {
      fileset = await mod.FilesetResolver.forVisionTasks(assets.wasm);
    } catch {
      settleReady(false);
      return;
    }

    /*
     * GPU first, CPU second — and each attempt is RACED against a deadline.
     *
     * On a locked-down GL context the GPU delegate throws, which the loop
     * handles. On a software-GL context (headless test runners, some VMs, some
     * remote desktops) it does something worse: it HANGS, resolving neither way.
     * A hang here used to mean the whole coach silently never armed — the exact
     * "it doesn't track anything" failure, with no error anywhere to see. A lost
     * race now falls through to the CPU delegate, which is slower and works.
     */
    const deadline = <T,>(work: Promise<T>, ms: number) =>
      Promise.race([
        work,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
      ]);
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        faceModel = await deadline(
          mod.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: assets.face, delegate },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
          }),
          delegate === "GPU" ? 10_000 : 20_000,
        );
        if (faceModel) break;
      } catch {
        faceModel = null;
      }
    }

    if (!faceModel || disposed) {
      settleReady(false);
      if (disposed) teardownModels();
      return;
    }
    settleReady(true);
    if (running) scheduleVision(0);

    // Pose is the optional half: five more megabytes, and all it buys is wrists
    // and a shoulder line. Loaded after the face model is already working so a
    // slow download costs coverage rather than the whole card. On a phone it
    // is not loaded at all — a second inference per tick on the device already
    // running the camera is the wrong trade, and every consumer of the pose
    // figures (gestures, sway, hands-in-shot) is null-tolerant end to end:
    // the card simply drops those rows, exactly as it does on a slow network.
    if (!onPhone()) {
      void (async () => {
        try {
          const model = await mod.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: assets.pose, delegate: "GPU" },
            runningMode: "VIDEO",
            numPoses: 1,
          });
          if (disposed || visionDead) model.close();
          else poseModel = model;
        } catch {
          // Hands and torso stay null. The card drops those rows.
        }
      })();
    }
  }

  function teardownModels() {
    try {
      faceModel?.close();
    } catch {
      /* the runtime is going away anyway */
    }
    try {
      poseModel?.close();
    } catch {
      /* as above */
    }
    faceModel = null;
    poseModel = null;
  }

  // ── Volume ────────────────────────────────────────────────────────────────

  function readLevel(): number {
    if (options.readLevel) return options.readLevel();
    return ownMeter?.read() ?? 0;
  }

  /** Only built when no meter was handed in — see DeliveryCoachOptions. */
  function openOwnMeter() {
    if (options.readLevel || !options.stream) return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(options.stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      ownMeter = {
        read() {
          analyser.getFloatTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
          // Same perceptual curve the on-screen bar uses, so the numbers agree.
          return Math.min(1, Math.pow(Math.sqrt(sum / buffer.length) * 4.5, 0.65));
        },
        close() {
          source.disconnect();
          analyser.disconnect();
          void ctx.close();
        },
      };
    } catch {
      ownMeter = null;
    }
  }

  function sampleVolume() {
    const now = performance.now();
    const level = clamp01(readLevel());
    volN += 1;
    volSum += level;

    if (level < AUDIBLE_FLOOR) {
      if (quietSince === null) quietSince = now;
      return;
    }

    audibleN += 1;
    audibleSum += level;
    if (quietSince !== null) {
      const gap = (now - quietSince) / 1000;
      // Bounded by speech on both sides: a fade, not the pause before you start.
      if (spokeAlready && gap >= DROPOUT_MIN_S && gap <= DROPOUT_MAX_S) {
        dropouts += 1;
        longestDropout = Math.max(longestDropout, gap);
      }
      quietSince = null;
    }
    spokeAlready = true;
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  function blend(categories: MpCategory[] | undefined, name: string): number {
    if (!categories) return 0;
    for (const c of categories) if (c.categoryName === name) return c.score;
    return 0;
  }

  function absorbFace(result: MpFaceResult, aspect: number, now: number) {
    const marks = result.faceLandmarks[0];
    frames += 1;
    lastEyesOn = false; // corrected to true below when this frame lands on-lens

    if (!marks || marks.length === 0) {
      // Out of shot is off the lens. Silence here would flatter the player.
      if (awaySince === null) awaySince = now;
      return;
    }

    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (const p of marks) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const width = maxX - minX;
    if (width > 0.01) {
      // y is normalised by frame height, x by frame width; without the aspect
      // correction a wide frame would report vertical drift as smaller than it is.
      headDrift.push((minX + maxX) / 2, ((minY + maxY) / 2) * aspect, width);
    }

    // Column-major 4x4. The third column is the face's forward axis in camera
    // space, and the camera sits on that axis, so |z| alone gives the angle off
    // the lens without having to trust a Euler convention.
    let headFacing = true;
    const m = result.facialTransformationMatrixes[0]?.data;
    if (m && m.length >= 16) {
      const norm = Math.hypot(m[8], m[9], m[10]) || 1;
      const offAxis = (Math.acos(Math.min(1, Math.abs(m[10]) / norm)) * 180) / Math.PI;
      headFacing = offAxis <= FACING_DEG;
    }

    // Blendshapes are named, so the direction of a glance needs no convention
    // guessing — and a head aimed at the lens with the eyes down is not eye
    // contact, which is exactly the habit worth coaching out of a teenager.
    const cats = result.faceBlendshapes[0]?.categories;
    const down = Math.max(blend(cats, "eyeLookDownLeft"), blend(cats, "eyeLookDownRight"));
    const up = Math.max(blend(cats, "eyeLookUpLeft"), blend(cats, "eyeLookUpRight"));
    const side = Math.max(
      blend(cats, "eyeLookOutLeft"),
      blend(cats, "eyeLookOutRight"),
      blend(cats, "eyeLookInLeft"),
      blend(cats, "eyeLookInRight"),
    );
    const eyesOnLens = down < EYES_OFF && up < EYES_OFF && side < EYES_OFF;

    if (headFacing && eyesOnLens) {
      onLens += 1;
      lastEyesOn = true;
      closeAwayRun(now);
    } else {
      if (down >= EYES_OFF) lookedDown += 1;
      if (awaySince === null) awaySince = now;
    }
  }

  function closeAwayRun(now: number) {
    if (awaySince === null) return;
    longestAway = Math.max(longestAway, (now - awaySince) / 1000);
    awaySince = null;
  }

  function absorbPose(result: MpPoseResult, aspect: number, now: number) {
    const marks = result.landmarks[0];
    if (!marks || marks.length <= POSE_R_WRIST) return;

    const ls = marks[POSE_L_SHOULDER];
    const rs = marks[POSE_R_SHOULDER];
    const shoulder = Math.hypot(ls.x - rs.x, (ls.y - rs.y) * aspect);
    // Too narrow means the player is far away or the detection is junk; either
    // way it is a bad ruler, and every pose number here is measured in it.
    if (shoulder < 0.05) return;

    poseFrames += 1;
    torsoDrift.push((ls.x + rs.x) / 2, ((ls.y + rs.y) / 2) * aspect, shoulder);

    const lw = marks[POSE_L_WRIST];
    const rw = marks[POSE_R_WRIST];
    const lVisible = lw.visibility >= WRIST_VISIBLE;
    const rVisible = rw.visibility >= WRIST_VISIBLE;
    if (!lVisible && !rVisible) {
      lastWrists = null;
      return;
    }
    wristFrames += 1;

    const prev = lastWrists;
    lastWrists = { lx: lw.x, ly: lw.y * aspect, rx: rw.x, ry: rw.y * aspect, at: now };
    if (!prev) return;
    const dt = (now - prev.at) / 1000;
    if (dt <= 0 || dt > 1) return;

    const left = lVisible ? Math.hypot(lw.x - prev.lx, lw.y * aspect - prev.ly) : 0;
    const right = rVisible ? Math.hypot(rw.x - prev.rx, rw.y * aspect - prev.ry) : 0;
    const speed = Math.max(left, right) / shoulder / dt;

    if (!inGesture && speed >= GESTURE_ON) {
      inGesture = true;
      gestures += 1;
    } else if (inGesture && speed <= GESTURE_OFF) {
      inGesture = false;
    }
  }

  // ── The loop ──────────────────────────────────────────────────────────────

  /** Timers only exist where `window` does; dispose can be called anywhere. */
  function clearTimers() {
    if (typeof window === "undefined") return;
    window.clearTimeout(visionTimer);
    window.clearInterval(volumeTimer);
  }

  function scheduleVision(delay: number) {
    if (!running || disposed || visionDead) return;
    window.clearTimeout(visionTimer);
    visionTimer = window.setTimeout(sampleVision, delay);
  }

  /** The device's cadence floor and duty target, decided once per coach. */
  const baseIntervalMs = onPhone() ? BASE_INTERVAL_MOBILE_MS : BASE_INTERVAL_MS;
  const duty = onPhone() ? DUTY_MOBILE : DUTY;

  function sampleVision() {
    if (!running || disposed || visionDead || !faceModel || !video) return;
    if (video.readyState < 2 || video.videoWidth === 0) {
      scheduleVision(baseIntervalMs);
      return;
    }

    const now = performance.now();
    // detectForVideo rejects a timestamp that does not advance.
    const stamp = Math.max(lastTimestamp + 1, Math.round(now));
    lastTimestamp = stamp;
    const aspect = video.videoHeight / video.videoWidth;
    const began = performance.now();

    try {
      absorbFace(faceModel.detectForVideo(video, stamp), aspect, now);
      if (poseModel) absorbPose(poseModel.detectForVideo(video, stamp), aspect, now);
    } catch {
      // A throwing model mid-take is not worth a second attempt.
      abandonVision();
      return;
    }

    const cost = performance.now() - began;
    costEma = costEma === 0 ? cost : costEma * 0.7 + cost * 0.3;
    if (costEma > ABANDON_MS) {
      strikes += 1;
      if (strikes >= ABANDON_STRIKES) {
        // The device cannot do this and talk at the same time. The pitch wins.
        abandonVision();
        return;
      }
    } else {
      strikes = 0;
    }

    scheduleVision(Math.min(MAX_INTERVAL_MS, Math.max(baseIntervalMs, costEma * duty)));
  }

  function abandonVision() {
    visionDead = true;
    if (typeof window !== "undefined") window.clearTimeout(visionTimer);
    teardownModels();
  }

  // ── Handle ────────────────────────────────────────────────────────────────

  void warmUp();

  return {
    ready,

    live(): DeliveryLive {
      return {
        tracking: faceModel !== null && running && !visionDead,
        eyesOn: lastEyesOn,
        framesRead: frames,
        gestures: poseModel ? gestures : null,
        level: readLevel(),
      };
    },

    start() {
      if (running || disposed) return;
      running = true;
      startedAt = performance.now();
      openOwnMeter();
      volumeTimer = window.setInterval(
        sampleVolume,
        onPhone() ? VOLUME_INTERVAL_MOBILE_MS : VOLUME_INTERVAL_MS,
      );
      if (faceModel) scheduleVision(0);
    },

    stop() {
      if (!running) return null;
      running = false;
      stoppedAt = performance.now();
      clearTimers();
      closeAwayRun(stoppedAt);
      return buildReport();
    },

    dispose() {
      disposed = true;
      running = false;
      clearTimers();
      teardownModels();
      ownMeter?.close();
      ownMeter = null;
      settleReady(false);
    },
  };

  // ── Report ────────────────────────────────────────────────────────────────

  function buildReport(): DeliveryCoaching | null {
    const seconds = (stoppedAt - startedAt) / 1000;
    // The camera is the entry ticket. A card that only says "you were a bit
    // quiet" is not worth interrupting a verdict for, so no camera means no card.
    if (frames < MIN_FRAMES || seconds < 5) return null;
    // A lens cap reads as a face that never looked at anyone. Nothing was
    // measured about a person, so there is nothing to coach.
    if (headDrift.value() === null) return null;

    const camera: CameraCoaching = {
      frames,
      eyeContactShare: round2(onLens / frames),
      longestAwaySeconds: round1(longestAway),
      lookedDownShare: frames > onLens ? round2(lookedDown / (frames - onLens)) : 0,
      headSway: headDrift.value(),
      torsoSway: torsoDrift.value(),
      gesturesPerMinute:
        poseFrames >= MIN_FRAMES && seconds > 0 ? round1(gestures / (seconds / 60)) : null,
      handsVisibleShare: poseFrames > 0 ? round2(wristFrames / poseFrames) : null,
    };

    const volume: VolumeCoaching | null =
      volN >= 20
        ? {
            averageLevel: round2(audibleN > 0 ? audibleSum / audibleN : volSum / volN),
            quietShare: round2((volN - audibleN) / volN),
            dropouts,
            longestDropoutSeconds: round1(longestDropout),
            samples: volN,
          }
        : null;

    return {
      scored: false,
      seconds: round1(seconds),
      volume,
      camera,
      notes: writeNotes(volume, camera),
    };
  }
}

// ── Words ───────────────────────────────────────────────────────────────────

/**
 * Coaching prose. Observation first, then the one thing to do about it.
 *
 * Nothing here comments on how a voice sounds — only on whether it arrived. The
 * distinction is the whole of Brand Law 5: "you were under the floor for four
 * seconds" is a fact about a microphone, "you sounded flat" is a judgement about
 * a person, and this file is only ever allowed the first kind.
 */
export function writeNotes(
  volume: VolumeCoaching | null,
  camera: CameraCoaching,
): CoachingNote[] {
  const notes: CoachingNote[] = [];

  if (volume) {
    if (volume.averageLevel < 0.28) {
      notes.push({
        topic: "volume",
        tone: "watch",
        text: "You were quiet. The meter sat near the floor for most of the take, and a room is louder than a bedroom.",
      });
    } else if (volume.averageLevel > 0.9) {
      notes.push({
        topic: "volume",
        tone: "watch",
        text: "You were pinned to the top of the meter. Past the top it stops getting louder and starts getting distorted.",
      });
    } else {
      notes.push({
        topic: "volume",
        tone: "ok",
        text: "Your level carried the whole way through.",
      });
    }

    if (volume.dropouts >= 2) {
      notes.push({
        topic: "volume",
        tone: "watch",
        text: `Your level fell out of range ${volume.dropouts} times, the longest for ${volume.longestDropoutSeconds}s. It tends to happen at the end of a sentence, once you already know how it ends.`,
      });
    }
  }

  const eyePct = Math.round(camera.eyeContactShare * 100);
  if (camera.eyeContactShare >= 0.7) {
    notes.push({
      topic: "eyes",
      tone: "ok",
      text: `You held the lens for ${eyePct}% of the take.`,
    });
  } else {
    notes.push({
      topic: "eyes",
      tone: "watch",
      text: `You were on the lens ${eyePct}% of the time. Longest stretch away: ${camera.longestAwaySeconds}s.`,
    });
    if (camera.lookedDownShare >= 0.5) {
      notes.push({
        topic: "eyes",
        tone: "watch",
        text: "Most of that was downward. Notes on the desk read as reading, and a room can tell.",
      });
    }
  }

  const sway = camera.torsoSway ?? camera.headSway;
  const swayUnit = camera.torsoSway !== null ? "shoulder-widths" : "head-widths";
  if (sway !== null) {
    if (sway >= 0.3) {
      notes.push({
        topic: "sway",
        tone: "watch",
        text: `You swayed. The centre of you moved about ${sway} ${swayUnit} across the take — plant your feet before you start.`,
      });
    } else {
      notes.push({
        topic: "sway",
        tone: "ok",
        text: `You stayed put — about ${sway} ${swayUnit} of drift.`,
      });
    }
  }

  if (camera.gesturesPerMinute !== null) {
    // Whole moves in prose; the exact figure stays on the metric row.
    const rate = Math.round(camera.gesturesPerMinute);
    if (camera.handsVisibleShare !== null && camera.handsVisibleShare < 0.3) {
      notes.push({
        topic: "hands",
        tone: "ok",
        text: "Your hands were out of shot for most of it, so there is nothing to say about them.",
      });
    } else if (rate < 3) {
      notes.push({
        topic: "hands",
        tone: "watch",
        text: `Your hands barely moved — ${rate} moves a minute. Hands are the cheapest way to mark the parts that matter.`,
      });
    } else if (rate > 25) {
      notes.push({
        topic: "hands",
        tone: "watch",
        text: `Your hands moved ${rate} times a minute. Past a point they compete with the words instead of backing them.`,
      });
    } else {
      notes.push({
        topic: "hands",
        tone: "ok",
        text: `Your hands moved ${rate} times a minute. That reads as talking, not fidgeting.`,
      });
    }
  }

  return notes;
}
