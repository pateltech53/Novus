"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";

import { StudioEnvironment, fitToBox } from "./studio";
import { modelUrl, type ModelSlug } from "@/lib/rewards/models";
import { TIER_SLUGS, type Tier } from "@/lib/rewards/tables";

/**
 * The briefcase, turning.
 *
 * ── Why 3-D for one prop ────────────────────────────────────────────────────
 *
 * A chest that rotates reads as an OBJECT you are about to open; a static PNG
 * reads as an icon. The difference is the whole of the anticipation, and it is
 * the beat this screen exists for. The models are 140–240 kB each after the
 * repo's meshopt pipeline, and exactly one is on screen at a time.
 *
 * ── Hover, and why it is a lean rather than a bounce ────────────────────────
 *
 * Pointer position tilts the case toward the cursor — the case is looking at
 * you. A bounce or a scale-up would read as a button; a lean reads as a thing
 * with weight, which is what makes the tap that follows feel like an act.
 * Touch devices have no hover, so there the idle rotation carries it alone.
 *
 * ── Why the model is normalised rather than trusted ─────────────────────────
 *
 * Meshy does not promise a scale, and the case is framed by a camera at a
 * fixed distance. The v1 meshes came back from their Blender round-trip
 * inside a ±0.95 box and this canvas was tuned to that by accident; the v2
 * exports measure the same, so the fit below is currently a no-op. It is here
 * for the export that is not — one at a different unit size would render the
 * Gold Briefcase at twice the size of the Canvas Case, on the one screen this
 * system exists for, with nothing in the code to explain it.
 * `fitToBox` (components/rewards/studio.tsx) scales every case to
 * MODEL_FIT on its longest axis and centres it, so the ceremony's framing is
 * a property of this file rather than of whatever the last generation
 * happened to produce.
 *
 * ── The upgrade shake ───────────────────────────────────────────────────────
 *
 * `pulse` is bumped by the parent on every tap. A tap that UPGRADES spins the
 * case a full turn and flares it; a tap that does not gives a short recoil.
 * The distinction has to be visible in the motion itself, because the label
 * above it changes only on the upgrade — and a player who cannot tell the two
 * apart stops believing the taps do anything.
 */

function CaseModel({
  tier,
  pointer,
  pulse,
  upgraded,
  reduced,
}: {
  tier: Tier;
  pointer: { x: number; y: number };
  pulse: number;
  upgraded: boolean;
  reduced: boolean;
}) {
  const group = useRef<Group>(null);
  const spin = useRef(0);
  const shake = useRef(0);
  const lastPulse = useRef(pulse);

  const { scene } = useGLTF(modelUrl(TIER_SLUGS[tier] as ModelSlug), false);

  /*
   * Cloned because `useGLTF` caches by URL and this component mutates what it
   * renders — rotation, scale and position all live on the loaded object's
   * parent, but the fit below writes to the object itself, and a tap that
   * upgraded T1 → T2 and back would otherwise re-fit an already-fitted scene.
   */
  const model = useMemo(() => scene.clone(true), [scene]);
  useLayoutEffect(() => fitToBox(model), [model]);

  useEffect(() => {
    if (pulse === lastPulse.current) return;
    lastPulse.current = pulse;
    // A full extra turn on an upgrade, a recoil on a miss.
    if (upgraded) spin.current += Math.PI * 2;
    else shake.current = 1;
  }, [pulse, upgraded]);

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;

    // Idle turn. Slow enough to read the whole case in a couple of seconds.
    const idle = reduced ? 0 : delta * 0.55;
    node.rotation.y += idle;

    // Bleed the upgrade spin off on top of the idle turn.
    if (spin.current > 0) {
      const step = Math.min(spin.current, delta * 9);
      node.rotation.y += step;
      spin.current -= step;
    }

    // Lean toward the pointer, eased so the case has mass.
    const wantX = reduced ? 0 : pointer.y * 0.28;
    const wantZ = reduced ? 0 : -pointer.x * 0.16;
    node.rotation.x += (wantX - node.rotation.x) * Math.min(1, delta * 6);
    node.rotation.z += (wantZ - node.rotation.z) * Math.min(1, delta * 6);

    // The miss recoil: a quick squash that settles.
    if (shake.current > 0) {
      shake.current = Math.max(0, shake.current - delta * 4);
      const amount = shake.current * shake.current;
      node.scale.setScalar(1 - amount * 0.08);
      node.position.y = -amount * 0.05;
    } else {
      node.scale.setScalar(1);
      node.position.y += (0 - node.position.y) * Math.min(1, delta * 8);
    }
  });

  return (
    <group ref={group}>
      <primitive object={model} />
    </group>
  );
}

export default function CaseCanvas({
  tier,
  pulse,
  upgraded,
  reduced = false,
  className = "",
}: {
  tier: Tier;
  pulse: number;
  upgraded: boolean;
  reduced?: boolean;
  className?: string;
}) {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  return (
    <div
      className={className}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        setPointer({
          x: ((e.clientX - box.left) / box.width) * 2 - 1,
          y: ((e.clientY - box.top) / box.height) * 2 - 1,
        });
      }}
      onPointerLeave={() => setPointer({ x: 0, y: 0 })}
    >
      <Canvas
        camera={{ position: [0, 0.35, 2.6], fov: 42 }}
        dpr={[1, 2]}
        // The ceremony is the moment the game must not stutter, and it is also
        // the only thing on screen — so the canvas may run flat out here where
        // the pitch screen's shark deliberately does not.
        gl={{ antialias: true, alpha: true }}
      >
        {/* Without this the metallic cases — gold, titanium, the obsidian's
            chrome latch — render nearly black: metal reflects an environment,
            and three point lights are not one. See ./studio. */}
        <StudioEnvironment />
        <ambientLight intensity={1.1} />
        <directionalLight position={[-3, 4, 3]} intensity={2.2} />
        <directionalLight position={[3, 1, -2]} intensity={0.7} />
        <CaseModel tier={tier} pointer={pointer} pulse={pulse} upgraded={upgraded} reduced={reduced} />
      </Canvas>
    </div>
  );
}
