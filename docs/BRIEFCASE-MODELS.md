# Briefcase-system 3-D models — the Meshy pipeline

Eleven props: the five tier cases, the Shark Token, and the five tier keys.
Generated through the [Meshy](https://meshy.ai) API from the shipped 2-D art,
decimated by the repo's existing mesh pipeline, and served out of
`public/briefcase/models/`.

This doc is the 3-D half of [BRIEFCASE-ART.md](./BRIEFCASE-ART.md) (which
covers the 244 Gemini-generated 2-D assets) and the same shape: what to run,
what the rules are, where things live.

## The failure this pipeline exists to end

The first six GLBs were made by hand in the Meshy **web app**, round-tripped
through Blender, and committed. Nothing recorded a prompt, a model or a
setting; the API account holds no task for any of them; and the Blender
export dropped every material — `gltf-transform inspect` on each of those
originals reported *"No materials found / No textures found"*. The unlock
ceremony had been spinning an untextured grey mesh and calling it the Gold
Briefcase for the whole of the beta.

`scripts/build-models.mjs` already carries the same complaint about the shark
("the derivation lived in somebody's shell history"). This is that fix applied
to the props: the registry is checked in, the task ids are checked in, and
anyone with a key can rebuild the set.

## The run

```sh
export MESHY_API_KEY=msy_…          # only ever read from the environment
npm run art:models -- status        # what exists, what is missing
npm run art:models -- generate      # ~30 credits each, resumable, 4 at a time
open art-review/briefcase/models/   # LOOK at the renders before installing
npm run art:models -- install       # → assets-src/…/*.original.glb + provenance
npm run models                      # → public/briefcase/models/*-v<n>.glb
git add assets-src art-review public/briefcase/models docs/asset-review
```

Regenerate one:

```sh
npm run art:models -- generate --only key-t3 --force
npm run art:models -- install
npm run models -- --only key-t3
```

A **regenerated model that is already shipped needs a version bump** — bump
`version` in `assets-src/briefcase/models.json` *and* `MODEL_VERSIONS` in
`lib/rewards/models.ts`, then delete the superseded file. `next.config.ts`
serves this directory `immutable, max-age=7d`, so replacing a file in place
means a week of players holding the old one. `npm run models` names the files
that have gone stale; `npm run events` refuses to pass until they are gone.

`--mock` runs the whole pipeline with no network and no credits (a valid
one-triangle GLB into a separate staging root); that is how the plumbing is
tested.

## The route, and when to leave it

**Image-to-3D from the shipped 2-D master** is the default, and nine of the
eleven props use it. The Gemini pipeline already spent its consistency budget
getting every case, key and token into one toy style on one white ground;
lifting those exact renders keeps the 3-D set in step with the 2-D set — the
same latch, the same tag, the same gold. A fresh text prompt re-rolls the
design.

Two entries are pinned to `"route": "text"` in the registry, each with a
`note` saying why. Both are worth reading before adding a third:

| Slug | Why |
|---|---|
| `t4-obsidian` | The 2-D master draws a squat lidded box with **no handle**. The image lift was faithful — to the wrong object — and put a lunchbox between the T3 titanium case and the T5 gold briefcase, breaking the tier ladder. The text route produced a proper attaché. **Regenerate `cases/t4-obsidian-closed.png` and this should go back to the image route.** |
| `key-t3` | `keys/t3.png` draws a flat modern car-key at a steep tilt. Image-to-3D collapsed it into an unreadable lump on two separate attempts — the one silhouette in the key set the image route could not hold. |

The rule those two encode: **the image route inherits the art direction, so it
also inherits the art's mistakes.** When a 2-D master is off-model, fix the
master or take the text route — do not ship a faithful lift of the wrong
object.

## Cost

30 credits per textured model on either route (image: 30 in one task; text: 20
preview + 10 refine). The full set of eleven plus three regenerations came to
430 credits. `npm run art:models -- generate` prints the balance and what the
run will cost before it starts, and a 402 aborts the whole run rather than
failing one slug at a time — finished models are kept, so topping up and
re-running resumes.

## Where things live

| Path | What | In git? |
|---|---|---|
| `assets-src/briefcase/models.json` | **The registry.** Slug, tier, version, source image, texture prompt, text fallback, route pins | yes |
| `assets-src/briefcase/models/*.original.glb` | The Meshy exports at full density (5–9 MB each) — what `npm run models` decimates from | yes |
| `assets-src/briefcase/models/provenance.json` | **Generated.** Route, model, task ids, credits, the sha256 of the image each mesh was lifted from | yes |
| `art-review/briefcase/models/*.png` | Meshy's own render of each mesh — the QA sheet, never deployed | yes |
| `public/briefcase/models/<slug>-v<n>.glb` | What the app serves, 130–290 kB each | yes |
| `docs/asset-review/MODELS.md` | **Generated** gallery: source art beside the resulting mesh, GitHub renders it | yes |
| `.assets-staging/briefcase/models/` | Raw downloads, task state, the resume log | no (ignored) |

## What the code guarantees

- **`scripts/validate-models.mjs`** runs inside `npm run events`, so `check`
  and CI both fail on any drift between the registry, `lib/rewards/models.ts`
  and the files actually in `public/briefcase/models/` — including a stale
  file no registry entry claims. A version bumped in one place and not the
  others is a 404 in the ceremony: the case never appears, and nothing that
  does not open a browser would notice.
- **`fitToBox`** (`components/rewards/PropCanvas.tsx`) scales every model to
  `MODEL_FIT` (1.9) on its longest axis and centres it. Measured, this is a
  no-op today — Meshy normalises to a ±0.95 box and the old hand-made set
  happened to match — which is exactly why it is written down rather than
  relied on.
- **`npm run models`** asserts the bounding box does not move through
  decimation (max drift measured across the eleven: 0.00117).

## QA rubric

Same 30 seconds per render as the 2-D set, on
[`docs/asset-review/MODELS.md`](./asset-review/MODELS.md):

Reads as the object at 128 px · silhouette matches the 2-D master · material
matches the tier (canvas is cloth, titanium is metal, gold is mirror) · the
tier ladder holds, every T*n* out-shining every T*n−1* · no fused handle, no
melted latch · nothing floating detached from the body.

Expect the odd miss. Of fourteen generations here, two needed a route change
and one of those needed two attempts.

## Known misses, not yet fixed

- **`key-t1` carries the words "FINANCE & WEALTH"** on its luggage tag,
  because the 2-D master does — Gemini put text on it despite the negative
  block, and the 3-D lift reproduced it faithfully. It is stock-art phrasing
  that means nothing in Novus. Fixing it starts with regenerating the 2-D key,
  not the mesh.
- **`key-t3` reads gunmetal rather than brushed titanium**, and its blue
  accent sits at the head instead of the tip. It is unmistakably a key and it
  sits correctly in the ladder; the material is a second-pass concern.
- **The keys are not wired into any screen** — neither are their 2-D twins.
  They exist because the briefcase plan specifies a key per tier; the ceremony
  has never had a key beat. Nothing renders them today.
