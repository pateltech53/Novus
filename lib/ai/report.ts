/**
 * Why the AI tier is not being used, said somewhere a developer will find it.
 *
 * ── The failure this file exists to end ────────────────────────────────────
 *
 * Three times now the same thing has happened: keys are set, the app looks
 * completely normal, and the panel speaks in the browser voice. Every AI
 * feature here degrades to a COMPLETE local fallback by design — that is a good
 * design and it stays — but it means "no key", "wrong key", "route not
 * deployed", "origin unreachable" and "working perfectly" are five states with
 * one appearance. There was no console line anywhere in this codebase's client
 * code, so the only way to tell them apart was to read the source.
 *
 * ── The rule this follows ──────────────────────────────────────────────────
 *
 * Loud where a developer looks. Silent where a player looks.
 *
 * Nothing here renders, throws, or reaches the game UI. A twelve-year-old
 * mid-pitch must never see "HTTP 401" — the fallback is a real feature and
 * their turn is not degraded. This writes to the console, and to a registry
 * that `window.__novusAi()` and the opt-in debug overlay read.
 *
 * Once per feature per session. A latched failure re-logged once per spoken
 * line is how a console becomes as useless as silence.
 */

export type AiFeature = "voice" | "transcription" | "verdict" | "panel" | "debrief";

/** Which route backs each feature, and which key turns it on. Both appear in
 *  the log line, because "voice is off" is not actionable and "ELEVENLABS_API_KEY
 *  behind /api/tts is off" is. */
const ORIGIN_OF: Record<AiFeature, { route: string; key: string; fallback: string }> = {
  voice: {
    route: "/api/tts",
    key: "ELEVENLABS_API_KEY",
    fallback: "the browser's speech synthesis",
  },
  transcription: {
    route: "/api/stt",
    key: "DEEPGRAM_API_KEY",
    fallback: "the browser's own recogniser",
  },
  verdict: {
    route: "/api/pitch",
    key: "OPENROUTER_API_KEY",
    fallback: "the offline resolver",
  },
  /*
   * The Tank used to have no entry here because it never called anything: it
   * replayed `lib/ai/fixtures/panel-scripts.json` on every deploy, with or
   * without a key. That is precisely the "five states, one appearance" problem
   * the top of this file describes, and it is why it now reports like the rest.
   */
  panel: {
    route: "/api/panel",
    key: "OPENROUTER_API_KEY",
    fallback: "the offline shark, which reads the same attack points",
  },
  debrief: {
    route: "/api/debrief",
    key: "OPENROUTER_API_KEY",
    fallback: "the offline debrief, built from the transcript and the books",
  },
};

/**
 * What each status actually means for the person reading it, and what to do.
 *
 * The status codes are not arbitrary: the three route handlers pass the
 * provider's own code through rather than flattening everything to 502,
 * precisely so this table can exist.
 */
function remedy(status: number, key: string, route: string): string {
  switch (status) {
    case 501:
      return `${key} is not set on the deploy serving ${route}. Set it and REDEPLOY — a running instance does not pick up a new variable.`;
    case 401:
      return `${key} is set but the provider rejected it. Ask the server which reason: GET ${route}. Then check the key's value, and its permissions.`;
    case 403:
      return `${key} is set but not permitted to do this. On ElevenLabs that is a key without the voices_read or text_to_speech scope.`;
    case 404:
      return `Nothing is deployed at ${route}. In the native app this usually means NEXT_PUBLIC_API_ORIGIN points somewhere without these routes.`;
    case 429:
      return `The cap in lib/ai/server/providers.ts is spent. This is a budget decision working, not a bug.`;
    case 0:
      return `${route} could not be reached at all. From the native app that is normally CORS or a wrong NEXT_PUBLIC_API_ORIGIN — check middleware.ts and lib/native/origins.ts.`;
    default:
      return `${route} answered ${status}. The provider is likely down; the fallback covers it.`;
  }
}

export interface AiReport {
  feature: AiFeature;
  /** `live` — the hosted tier answered. `local` — the fallback is in use. */
  using: "live" | "local";
  /** 0 means the request never completed: no response to read a status off. */
  status?: number;
  detail?: string;
}

const reports = new Map<AiFeature, AiReport>();
/** Logged-once bookkeeping, kept separate from the registry so that a feature
 *  recovering and failing again is still only one line per distinct state. */
const said = new Set<string>();

export const FEATURES = ["voice", "transcription", "verdict", "panel", "debrief"] as const;

/** What each feature is called on screen, where "verdict" means nothing. */
export const LABEL: Record<AiFeature, string> = {
  voice: "Shark voices",
  transcription: "Transcription",
  verdict: "Cold-call verdicts",
  panel: "The Tank",
  debrief: "Pitch debrief",
};

export function routeOf(feature: AiFeature): string {
  return ORIGIN_OF[feature].route;
}

export function keyOf(feature: AiFeature): string {
  return ORIGIN_OF[feature].key;
}

export function remedyFor(report: AiReport): string {
  const { route, key } = ORIGIN_OF[report.feature];
  return remedy(report.status ?? 0, key, route);
}

/**
 * The banner is a React component and React needs a store it can subscribe to.
 *
 * `useSyncExternalStore` compares snapshots by identity, so the snapshot has to
 * be a cached array rebuilt only when something actually changes — returning a
 * fresh `.map()` on every read is an infinite render loop.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: AiReport[] = FEATURES.map((feature) => ({
  feature,
  using: "local" as const,
  detail: "not attempted yet",
}));

export function subscribeAi(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The current state, stable by identity until it genuinely changes. */
export function aiSnapshot(): AiReport[] {
  return snapshot;
}

function publish(): void {
  snapshot = FEATURES.map(
    (feature) => reports.get(feature) ?? { feature, using: "local", detail: "not attempted yet" },
  );
  for (const fn of listeners) fn();
}

/** The hosted tier answered. Recorded so the debug surfaces can show a green
 *  line rather than only ever showing bad news, which reads as "no data". */
export function reportLive(feature: AiFeature): void {
  const previous = reports.get(feature);
  reports.set(feature, { feature, using: "live" });
  publish();
  if (previous?.using === "live") return;
  log(`%c[novus:ai]%c ${feature} → live (${ORIGIN_OF[feature].route}).`, "color:#3ba55d");
}

/**
 * The fallback is in use. `status` is the HTTP status the route returned, or 0
 * when the request never completed at all — which is a genuinely different
 * problem and the one that only ever shows up in the shipped app.
 */
export function reportFallback(feature: AiFeature, status: number, detail?: string): void {
  reports.set(feature, { feature, using: "local", status, detail });
  publish();

  const signature = `${feature}:${status}`;
  if (said.has(signature)) return;
  said.add(signature);

  const { route, key, fallback } = ORIGIN_OF[feature];
  log(
    `%c[novus:ai]%c ${feature} → ${fallback}` +
      (status ? ` (HTTP ${status} from ${route})` : ` (${route} unreachable)`) +
      `\n  ${remedy(status, key, route)}` +
      (detail ? `\n  ${detail}` : "") +
      `\n  Full picture: window.__novusAi()  ·  server side: GET /api/ai`,
    "color:#e0a33e",
  );
}

/** Everything known about the three features, for a console or the banner. */
export function aiStatus(): AiReport[] {
  return snapshot;
}

function log(message: string, colour: string): void {
  if (typeof console === "undefined") return;
  // `%c` twice: the prefix is coloured, the rest is not. Falls back to plain
  // text in a console that does not do CSS, which is every native webview
  // inspector worth the name and also plain `adb logcat`.
  console.info(message, `${colour};font-weight:bold`, "");
}

/**
 * `window.__novusAi()` — the one thing to type when the voice sounds wrong.
 *
 * Deliberately on `window` in production too. This exposes no key and no player
 * data, only which of three routes answered, and it is the difference between
 * diagnosing a live deploy in ten seconds and rebuilding it with logging in.
 */
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__novusAi = () => {
    const rows = aiStatus();
    // eslint-disable-next-line no-console
    console.table(
      rows.map((r) => ({
        feature: r.feature,
        using: r.using,
        route: ORIGIN_OF[r.feature].route,
        key: ORIGIN_OF[r.feature].key,
        status: r.status ?? "",
        detail: r.detail ?? "",
      })),
    );
    return rows;
  };
}
