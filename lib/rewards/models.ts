/**
 * The 3-D props the reward loop renders, by served URL.
 *
 * ── Why a table and not a template string ───────────────────────────────────
 *
 * `next.config.ts` serves model files as immutable for a week, and its own
 * rule for replacing such an asset is to rename it. So every regenerated
 * model ships under a new `-v<n>` suffix, and the load sites have to name
 * the version — which used to mean a `-v1` literal inside CaseCanvas that
 * nobody would find when the file changed. This table is the one place the
 * client knows a version, and `scripts/validate-models.mjs` (run by
 * `npm run events`, so by `check` and CI) fails the build the moment it
 * disagrees with `assets-src/briefcase/models.json` or names a file that is
 * not in `public/briefcase/models/`. Bump the two together.
 *
 * ── The fit ─────────────────────────────────────────────────────────────────
 *
 * Meshy does not promise a scale. The hand-made v1 set happened to be
 * normalised to a ±0.95 box and CaseCanvas happened to frame that, so the
 * canvases now scale every model to `MODEL_FIT` on its largest axis and
 * centre it, and a re-export at any unit size renders at the size the
 * ceremony was tuned for. 1.9 is that box, exactly.
 */
import type { Tier } from "./tables";

export const MODEL_VERSIONS = {
  "t1-canvas": 2,
  "t2-leather": 2,
  "t3-titanium": 2,
  "t4-obsidian": 2,
  "t5-gold": 2,
  "shark-token": 2,
  "key-t1": 1,
  "key-t2": 1,
  "key-t3": 1,
  "key-t4": 1,
  "key-t5": 1,
} as const;

export type ModelSlug = keyof typeof MODEL_VERSIONS;

/** Largest bounding-box dimension every model is scaled to, in scene units. */
export const MODEL_FIT = 1.9;

export function modelUrl(slug: ModelSlug): string {
  return `/briefcase/models/${slug}-v${MODEL_VERSIONS[slug]}.glb`;
}

export const keySlug = (tier: Tier): ModelSlug => `key-t${tier}` as ModelSlug;
