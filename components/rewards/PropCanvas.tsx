"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { Group } from "three";

import { StudioEnvironment, fitToBox } from "./studio";
import { modelUrl, type ModelSlug } from "@/lib/rewards/models";

/**
 * A small 3-D prop, turning: the Shark Token beside a balance, a tier key on
 * a row.
 *
 * ── Why this is separate from CaseCanvas ────────────────────────────────────
 *
 * The case is the ceremony's protagonist — it leans toward the pointer, it
 * spins a full turn on an upgrade, it recoils on a miss, and its canvas is
 * allowed to run flat out because it is the only thing on screen. A token
 * next to a number is furniture: it turns slowly, it reacts to nothing, and
 * there may be several on a screen that is also scrolling. Sharing one
 * component would mean the furniture paying for the protagonist's frame
 * budget, so they are two components with two different bargains:
 *
 *   · `dpr={[1, 1.5]}` rather than `[1, 2]` — at 40-96 px the third
 *     device pixel is not visible, and it costs 1.8× the fragments.
 *   · `frameloop="demand"` is deliberately NOT used: these turn continuously,
 *     and demand-mode with a per-frame invalidate is the same work plus a
 *     scheduler. Reduced motion is what stops the turn (see below).
 *   · No pointer handler, so no React state updates while the page scrolls.
 *
 * ── prefers-reduced-motion stops the turn completely ────────────────────────
 *
 * A permanently spinning object in a list is exactly what the setting is for,
 * and unlike the ceremony there is no drama to preserve — so `spin={false}`
 * (what `useReducedMotion` gives the callers) leaves a still object rather
 * than a slower one. Framer's MotionConfig cannot reach a WebGL loop, so this
 * is passed in rather than inherited.
 *
 * ── The fit and the light ───────────────────────────────────────────────────
 *
 * Both come from `./studio`: every prop is normalised to MODEL_FIT so its
 * size is a property of the code rather than of the last generation, and
 * `<StudioEnvironment>` is what stops a metallic prop rendering black. The
 * reasoning for each is in that file.
 */

function Prop({ slug, spin, speed }: { slug: ModelSlug; spin: boolean; speed: number }) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(modelUrl(slug), false);

  /*
   * `useGLTF` caches by URL, so two props of the same slug on one screen would
   * otherwise share — and mutate — one object. The clone is per-mount, and the
   * fit runs on the clone before first paint.
   */
  const model = useMemo(() => scene.clone(true), [scene]);
  useLayoutEffect(() => fitToBox(model), [model]);

  useFrame((_, delta) => {
    if (!spin || !group.current) return;
    group.current.rotation.y += delta * speed;
  });

  return (
    <group ref={group}>
      <primitive object={model} />
    </group>
  );
}

export default function PropCanvas({
  slug,
  spin = true,
  speed = 0.5,
  label,
  className = "",
}: {
  slug: ModelSlug;
  /** False under `prefers-reduced-motion`: a still object, not a slow one. */
  spin?: boolean;
  /** Radians per second. */
  speed?: number;
  /**
   * What a screen reader should hear. Omit and the canvas is hidden from the
   * tree entirely — correct when the prop sits beside text that already says
   * "1,240 Shark Tokens", where announcing it twice is noise.
   */
  label?: string;
  className?: string;
}) {
  return (
    <div className={className} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <Canvas
        camera={{ position: [0, 0.2, 3.1], fov: 40 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <StudioEnvironment />
        <ambientLight intensity={1.15} />
        <directionalLight position={[-3, 4, 3]} intensity={2.1} />
        <directionalLight position={[3, 1, -2]} intensity={0.6} />
        <Prop slug={slug} spin={spin} speed={speed} />
      </Canvas>
    </div>
  );
}
