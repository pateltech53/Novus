"use client";

import { useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import { Box3, PMREMGenerator, Vector3, type Object3D } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { MODEL_FIT } from "@/lib/rewards/models";

/**
 * The two things every briefcase prop needs before it looks like itself: a
 * scale it can be trusted at, and something for its metal to reflect.
 *
 * Both canvases (`CaseCanvas`, `PropCanvas`) import from here rather than one
 * importing from the other, because neither is the other's parent.
 */

// ── fit ─────────────────────────────────────────────────────────────────────

/**
 * Scale and centre a loaded scene so its longest axis is exactly `fit`.
 *
 * Measured, this is a no-op on today's set: Meshy normalises its exports to a
 * ±0.95 box (the eleven shipped props measure 1.9014–1.9030 across) and the
 * old hand-made set happened to match, so the scale factor is 1.000. That is
 * exactly why it is written down. The agreement is a property of Meshy's
 * exporter, not a promise to this repo, and it is invisible — nothing else in
 * either canvas says "these models are 1.9 units across", so the day one
 * arrives at a different scale it renders at the wrong size on a screen
 * nobody re-checks, and no test that does not open a browser can see it.
 *
 * Cost: two Box3 passes per mount over a ~10k-triangle mesh.
 */
export function fitToBox(object: Object3D, fit = MODEL_FIT) {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) return;
  object.scale.setScalar(fit / longest);
  // Re-measure after scaling: the centre moves with it, and centring on the
  // pre-scale box leaves the model off-axis by (1 − scale) × its offset.
  object.position.sub(new Box3().setFromObject(object).getCenter(new Vector3()));
}

// ── environment ─────────────────────────────────────────────────────────────

/**
 * An image-based light, generated rather than downloaded.
 *
 * ── Why the props were black without it ─────────────────────────────────────
 *
 * A metal surface has no diffuse response — it shows you the room it is
 * standing in and nothing else. Punctual lights (ambient, directional) supply
 * a specular highlight and no reflection at all, so a `metalness: 1` material
 * lit by three of them renders very nearly black.
 *
 * That did not matter while the shipped meshes carried NO materials: their
 * Blender round-trip dropped every one, three.js substituted its default
 * white non-metal, and the Gold Briefcase was a light grey briefcase-shaped
 * object that read as "3-D case" and nobody questioned. The Meshy exports
 * that replaced them are properly textured PBR — gold is metallic, titanium
 * is metallic, the token's rim is metallic — and lighting them with the old
 * rig turned the entire tier ladder into shades of dark brown. Measured on
 * the shipped GLBs in headless Chromium: without this, T5 gold reads as dark
 * bronze and T3 titanium as near-black; with it, gold is gold and titanium is
 * steel.
 *
 * ── Why RoomEnvironment and not an HDRI ─────────────────────────────────────
 *
 * `drei`'s `<Environment preset>` fetches an HDRI from a CDN, and this app
 * does not talk to third-party origins — CSP pins `connect-src 'self'` and
 * the child-safety rule pins everything else. Shipping our own HDRI would put
 * a megabyte of EXR in `public/` for a 240 px prop. `RoomEnvironment` is
 * geometry and emissive planes from three's own addons, built into a cube map
 * at runtime: no request, no asset, ~4 kB of code, and it lands in the lazy
 * 3-D chunk with everything else here.
 *
 * `resolution` 0.04 is PMREM's blur, not a pixel count — the props are matte
 * to semi-gloss toys and a sharp reflection of a virtual room's corners would
 * read as dirt on the gold.
 */
export function StudioEnvironment({ intensity = 0.85 }: { intensity?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useLayoutEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const target = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      target.texture.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);

  return null;
}
