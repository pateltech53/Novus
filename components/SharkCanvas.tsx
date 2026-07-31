"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import { Color, type Group, type Mesh, type MeshStandardMaterial } from "three";
import { BRAND_ACTION, NEUTRAL_WHITE } from "@/lib/brand";
import type { SharkState } from "@/components/SharkStage";

/**
 * The R3F half of the mascot, split out so it can be dynamically imported.
 *
 * Nothing in this file is reachable until a route actually renders a shark —
 * previously `useGLTF.preload()` sat at module scope, so importing SharkStage
 * anywhere pulled the 23 MB GLB. /welcome and /found both paid for it while
 * showing only a poster.
 */

const BASE_Y = -0.06;
const MODEL_SCALE = 1.1;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Only these two states genuinely need a continuous 60fps loop. */
const isLive = (s: SharkState) => s === "listening" || s === "celebrate";

export default function SharkCanvas({
  state,
  level,
  reduced,
  tint,
  suitTint,
}: {
  state: SharkState;
  level: number;
  reduced: boolean;
  tint?: string;
  suitTint?: string;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0.15, 3.1], fov: 34 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: "transparent" }}
      dpr={[1, 2]}
      // Idle/thinking/verdict render on demand and are ticked slowly by
      // <Heartbeat/>, so a shark the player is not talking to does not burn
      // the battery at 60fps while they read a decision sheet.
      frameloop={isLive(state) && !reduced ? "always" : "demand"}
    >
      <Heartbeat live={isLive(state)} reduced={reduced} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[2.5, 3, 3]} intensity={1.5} />
      {/* Brand orange rim light — the mascot's signature edge, and the honest
          version of the CSS bloom that used to fake it. */}
      <directionalLight position={[-3, 1, -2]} intensity={0.9} color={BRAND_ACTION} />
      <Suspense fallback={null}>
        <SharkModel state={state} level={level} reduced={reduced} tint={tint} suitTint={suitTint} />
        <Environment preset="city" />
      </Suspense>
    </Canvas>
  );
}

/**
 * Drives the on-demand frameloop.
 *
 * `frameloop="demand"` renders only when something calls invalidate(), which
 * would otherwise freeze the idle breath entirely. A ~12fps tick keeps the
 * mascot alive at a fifth of the cost. Backgrounded tabs and reduced-motion
 * stop it completely — a still shark is the correct reduced-motion answer.
 */
function Heartbeat({ live, reduced }: { live: boolean; reduced: boolean }) {
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (live && !reduced) return; // "always" loop is already running
    if (reduced) {
      invalidate(); // paint one frame, then stay still
      return;
    }
    let id: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    const start = () => {
      window.clearInterval(id);
      // 12fps while visible; nothing at all while backgrounded.
      id = window.setInterval(tick, document.visibilityState === "visible" ? 83 : 1000);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", start);
    };
  }, [live, reduced, invalidate]);

  return null;
}

function SharkModel({
  state,
  level,
  reduced,
  tint,
  suitTint,
}: {
  state: SharkState;
  level: number;
  reduced: boolean;
  tint?: string;
  suitTint?: string;
}) {
  const group = useRef<Group>(null);
  /**
   * useDraco: false — deliberate.
   *
   * The mesh is meshopt-compressed (23.7 MB → 2.96 MB), and drei's meshopt
   * decoder is bundled from three-stdlib. Draco would have compressed further
   * (1.5 MB) but drei fetches its decoder from a Google CDN by default, which
   * breaks both the offline-after-load requirement and the no-third-party
   * stance. Leaving useDraco at its default `true` would attach that loader
   * even though this file never triggers it — so it is switched off outright.
   */
  const { scene } = useGLTF("/shark/shark.glb", false);
  const model = useMemo(() => scene.clone(true), [scene]);

  // NOTE: this is still the broken Phase 4 behaviour — `tint ?? suitTint` means
  // skin and suit are mutually exclusive, and the traversal paints every
  // material one flat colour. Left exactly as-is on purpose: the Closet is
  // Phase 4's job and it needs a decision, not a patch. See BUILD-PROMPT.md.
  useEffect(() => {
    if (!tint && !suitTint) return;
    const target = new Color(tint ?? suitTint ?? NEUTRAL_WHITE);
    model.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as MeshStandardMaterial | MeshStandardMaterial[];
      const list = Array.isArray(mat) ? mat : [mat];
      for (const m of list) {
        if (!m || !("color" in m)) continue;
        m.color.copy(target);
        m.needsUpdate = true;
      }
    });
  }, [model, tint, suitTint]);

  const t = useRef(0);

  useFrame((_, delta) => {
    if (!group.current) return;
    t.current += delta;
    const time = t.current;

    if (reduced) {
      group.current.position.set(0, BASE_Y, 0);
      group.current.rotation.set(0, 0, 0);
      return;
    }

    switch (state) {
      case "listening": {
        // Leans toward the camera; the lean tracks how loud you actually are.
        const lean = 0.1 + level * 0.14;
        group.current.rotation.x = lerp(group.current.rotation.x, lean, 0.08);
        group.current.rotation.y = Math.sin(time * 0.5) * 0.06;
        group.current.position.z = lerp(group.current.position.z, 0.22 + level * 0.12, 0.07);
        group.current.position.y = BASE_Y + Math.sin(time * 1.1) * 0.015;
        break;
      }
      case "thinking": {
        group.current.rotation.y = lerp(group.current.rotation.y, -0.3, 0.05);
        group.current.rotation.z = lerp(group.current.rotation.z, 0.07, 0.05);
        group.current.position.y = BASE_Y + Math.sin(time * 0.9) * 0.02;
        group.current.position.z = lerp(group.current.position.z, 0, 0.05);
        break;
      }
      case "celebrate": {
        group.current.position.y = BASE_Y + Math.abs(Math.sin(time * 4.2)) * 0.16;
        group.current.rotation.y = Math.sin(time * 3.4) * 0.22;
        group.current.rotation.z = Math.sin(time * 3.4 + 1) * 0.06;
        break;
      }
      case "verdict": {
        group.current.rotation.y = lerp(group.current.rotation.y, 0.12, 0.06);
        group.current.rotation.x = lerp(group.current.rotation.x, -0.04, 0.06);
        group.current.position.y = BASE_Y + Math.sin(time * 1.4) * 0.01;
        break;
      }
      default: {
        // Idle breath.
        group.current.rotation.y = Math.sin(time * 0.35) * 0.1;
        group.current.rotation.x = lerp(group.current.rotation.x, 0, 0.05);
        group.current.rotation.z = lerp(group.current.rotation.z, 0, 0.05);
        group.current.position.y = BASE_Y + Math.sin(time * 1.05) * 0.022;
        group.current.position.z = lerp(group.current.position.z, 0, 0.05);
      }
    }
  });

  return (
    <group ref={group} position={[0, BASE_Y, 0]}>
      <primitive object={model} scale={MODEL_SCALE} />
    </group>
  );
}
