"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Box3, Vector3, type Group } from "three";

/**
 * The R3F half of the landing hero, dynamically imported (ssr:false) from
 * LandingShark so the GLB and three.js are only paid for by "/".
 *
 * ── What this replaced, and why ────────────────────────────────────────────
 *
 * The first version was a turntable: a full 360° spin on a 21s clock, lit by
 * drei's `<Environment preset="city">`. Both halves were wrong.
 *
 * The spin meant a visitor spent half of every rotation looking at the BACK of
 * the mascot's head — the one angle with no face, no lapels and no trophy,
 * which is exactly the frame the first review screenshot of this page caught.
 * A hero object is posed, not rotated. It faces the audience the way the
 * founder portraits and the panel sharks do, and it moves the way a character
 * idles — it breathes, it shifts its weight, it leans a few degrees toward the
 * pointer — without ever showing the visitor its back.
 *
 * The Environment preset was worse: drei fetches those HDRIs from a CDN at
 * runtime, which this app forbids (offline-capable, third-party-free — the
 * same rule that picked meshopt over Draco). When that fetch failed, the model
 * rendered on ambient light alone: the flat, washed look that made the page
 * feel generated. The rig below is authored locally instead — a warm key from
 * the front, a cool fill, a steel rim for separation, and a floor bounce so
 * the suit's underside keeps its form.
 */

const MODEL_URL = "/models/shark-champion.glb";

/** Largest model dimension, in world units. */
const FIT = 1.9;

/**
 * The pose: three-quarter front-left, chin level — face, pinstripes and the
 * trophy all readable at once, which is the whole job of the mesh.
 */
const BASE_YAW = -0.42;

/** Idle sway, radians. A character shifting weight, not a display turntable. */
const SWAY = 0.075;
const SWAY_PERIOD_S = 9.5;

/** How far the pointer can pull the pose. Touch never hovers, so this is
 *  desktop-only by nature, and small enough that the face never leaves the
 *  audience. */
const POINTER_YAW = 0.16;
const POINTER_PITCH = 0.05;

/*
 * A touch-first device, resolved once per module.
 *
 * The play-screen canvas has downgraded DPR and switched antialiasing off on
 * phones since the pitch-lag work (components/SharkCanvas.tsx) — but the two
 * LANDING canvases never got it, and the landing page is the surface a stranger
 * meets first, on whatever phone they own. A 2.2 MB mesh rendered at 2× device
 * pixel ratio with MSAA, at 60 fps, is a lot of GPU to spend on someone who has
 * not decided whether they want the app yet; it shows up as heat and battery
 * long before it shows up as dropped frames.
 *
 * 1.5× is the same ceiling SharkCanvas uses and is visually indistinguishable
 * at this size. Antialiasing off matters more than it sounds: at 1.5× DPR the
 * remaining edge stepping is sub-pixel on a phone screen.
 */
const MOBILE =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const DPR: [number, number] = MOBILE ? [1, 1.5] : [1, 2];
const GL = { alpha: true, antialias: !MOBILE };
const CANVAS_STYLE = { background: "transparent" };

export default function LandingSharkCanvas({
  reduced,
  spinning,
  onReady,
}: {
  reduced: boolean;
  /** False while the hero is scrolled away, and false while the page is being
   *  scrolled at all — freezes the loop so neither reading the page below nor
   *  dragging it costs 60fps of GPU. */
  spinning: boolean;
  onReady?: () => void;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0.16, 3.25], fov: 33 }}
      gl={GL}
      style={CANVAS_STYLE}
      dpr={DPR}
      frameloop={spinning && !reduced ? "always" : "demand"}
    >
      {/*
        The studio rig, authored rather than fetched:
          key    warm white, high front-right — the face and the lapels.
          fill   cool, low front-left, soft — opens the shadow side without
                 flattening the pinstripes.
          rim    a cool steel edge from behind-left. This was the brand orange
                 for a while, and at rim intensity orange on a grey-blue shark
                 reads as RED — the head looked sunburnt. Character colour
                 belongs to the texture; the rim's only job is separation.
          bounce dim uplight so the jacket's underside and tail keep form.
      */}
      <ambientLight intensity={0.52} />
      <directionalLight position={[2.2, 3.2, 2.6]} intensity={2.1} color="#fff4e6" />
      <directionalLight position={[-2.6, 0.6, 2.8]} intensity={0.7} color="#dfe8f2" />
      <directionalLight position={[-2.4, 1.4, -2.6]} intensity={1.1} color="#c9d6e8" />
      <directionalLight position={[0, -2.5, 1.5]} intensity={0.35} color="#f4ede2" />
      <Suspense fallback={null}>
        <ChampionModel reduced={reduced} onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}

function ChampionModel({
  reduced,
  onReady,
}: {
  reduced: boolean;
  onReady?: () => void;
}) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(MODEL_URL, false);
  const invalidate = useThree((s) => s.invalidate);

  /*
   * Normalise rather than eyeball: centre the mesh and scale its largest
   * dimension to FIT, so a re-export at a different unit scale cannot silently
   * crop the hero. Then the model STANDS — its feet drop to a fixed floor line
   * instead of hovering at the bounding-box centre, which is what lets the
   * page draw a contact shadow that actually touches.
   */
  const model = useMemo(() => {
    const clone = scene.clone(true);
    const box = new Box3().setFromObject(clone);
    const size = box.getSize(new Vector3());
    const scale = FIT / (Math.max(size.x, size.y, size.z) || 1);
    const center = box.getCenter(new Vector3());
    clone.scale.setScalar(scale);
    clone.position.set(
      -center.x * scale,
      -box.min.y * scale - FIT / 2 + 0.03,
      -center.z * scale,
    );
    return clone;
  }, [scene]);

  useEffect(() => {
    onReady?.();
    if (reduced) invalidate();
  }, [onReady, reduced, invalidate]);

  const t = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });

  // Reads from the window, not the canvas, so the lean begins as the cursor
  // crosses the hero rather than only inside the transparent canvas box.
  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced]);

  useFrame((_, delta) => {
    if (!group.current) return;
    if (reduced) {
      group.current.rotation.y = BASE_YAW;
      group.current.rotation.x = 0;
      return;
    }
    /*
     * Clamped, because this loop is stopped and restarted — every scroll
     * freezes it (see LandingShark). R3F reports the true gap since the last
     * rendered frame, so an unclamped delta would advance the sway by however
     * long the visitor spent scrolling and the shark would resume mid-lurch.
     * Clamping means the idle simply pauses and continues.
     */
    const dt = Math.min(delta, 1 / 30);
    t.current += dt;

    // Idle on two incommensurate periods, so the loop never visibly repeats:
    // breath in the chest, weight in the stance.
    const sway = Math.sin((t.current / SWAY_PERIOD_S) * Math.PI * 2) * SWAY;
    const breathe = Math.sin(t.current * 1.15) * 0.012;

    // The lean chases the pointer softly. A direct mapping reads as head
    // tracking; the damped version reads as attention.
    const targetYaw = BASE_YAW + sway + pointer.current.x * POINTER_YAW;
    const targetPitch = pointer.current.y * POINTER_PITCH;
    const k = Math.min(1, dt * 4);
    group.current.rotation.y += (targetYaw - group.current.rotation.y) * k;
    group.current.rotation.x += (targetPitch - group.current.rotation.x) * k;
    group.current.position.y = breathe;
  });

  return (
    <group ref={group}>
      <primitive object={model} />
    </group>
  );
}
