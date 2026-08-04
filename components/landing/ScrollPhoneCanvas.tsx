"use client";

import { Suspense, useEffect, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoundedBox, useTexture } from "@react-three/drei";
import type { Group } from "three";

/**
 * The game, in hand: one real app screen on a 3D phone that turns as the page
 * scrolls.
 *
 * Built from geometry rather than a downloaded mockup — a rounded slab for the
 * body, a textured plane for the screen, a lens bump on the back — because a
 * generic GLB phone would arrive with its own materials, its own scale and a
 * megabyte of someone else's decisions. Thirty lines of primitives match the
 * app's own visual restraint and cost nothing.
 *
 * The rotation is not on a clock. `progress` is the section's scroll fraction
 * (written into a ref by the shell, read here per frame with a soft chase), so
 * the visitor DRIVES the turn: scroll down, the phone comes around to face
 * you; scroll back, it turns away. Reduced motion pins it at the presentation
 * angle and the page scrolls past a still object.
 *
 * Because the turn is driven and not timed, the render loop is `demand`: the
 * only reason to draw a frame is that the scroll moved or the chase has not
 * caught up yet. The shell asks for at most one frame per animation frame, the
 * chase asks for its own until it settles, and standing still beside the phone
 * — which is what a visitor does while reading the list next to it — costs
 * nothing at all. The previous `always` loop held 60fps for as long as any part
 * of a three-viewport section was on screen.
 */

const SCREEN_URL = "/landing/play.webp";

/** Body proportions, world units. Screen aspect matches the 640×1385 capture. */
const BODY_W = 1.06;
const BODY_H = 2.18;
const BODY_D = 0.085;

/** Where the turn starts and ends across the section's scroll. Begins facing
 *  away-left and lands slightly past square-on, so the finish feels presented
 *  rather than parked. */
const YAW_FROM = -2.35;
const YAW_TO = 0.12;

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

export default function ScrollPhoneCanvas({
  progressRef,
  reduced,
  invalidateRef,
}: {
  progressRef: MutableRefObject<number>;
  reduced: boolean;
  /** Filled in below with R3F's `invalidate`, so the shell can ask for a frame
   *  from the scroll handler without importing three.js to do it. */
  invalidateRef: MutableRefObject<(() => void) | null>;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0.02, 4.15], fov: 32 }}
      gl={GL}
      style={CANVAS_STYLE}
      dpr={DPR}
      frameloop="demand"
    >
      <FrameBridge invalidateRef={invalidateRef} />
      {/* Same studio family as the hero rig: warm key, cool fill, no CDN. */}
      <ambientLight intensity={0.75} />
      <directionalLight position={[2.4, 3, 2.5]} intensity={1.6} color="#fff4e6" />
      <directionalLight position={[-2.8, 0.8, 2.2]} intensity={0.6} color="#dfe8f2" />
      <directionalLight position={[0, 1.6, -2.8]} intensity={0.8} color="#f2ddc4" />
      <Suspense fallback={null}>
        <Phone progressRef={progressRef} reduced={reduced} />
      </Suspense>
    </Canvas>
  );
}

/**
 * Hands the shell the renderer's own `invalidate`. Lives outside the Suspense
 * boundary so the handle exists from the first commit rather than from
 * whenever the texture finishes loading.
 */
function FrameBridge({
  invalidateRef,
}: {
  invalidateRef: MutableRefObject<(() => void) | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidateRef.current = invalidate;
    invalidate();
    return () => {
      invalidateRef.current = null;
    };
  }, [invalidate, invalidateRef]);
  return null;
}

function Phone({
  progressRef,
  reduced,
}: {
  progressRef: MutableRefObject<number>;
  reduced: boolean;
}) {
  const group = useRef<Group>(null);
  const screen = useTexture(SCREEN_URL);
  const invalidate = useThree((s) => s.invalidate);

  /*
   * Start at the angle the scroll position already implies, rather than at
   * zero and chasing. It matters because the canvas now mounts on approach
   * instead of with the page: without this, arriving at the section — or
   * reloading halfway through it — would open on a phone sweeping in from
   * wherever the default happened to be.
   *
   * The texture also arrives after the first commit, and a demand loop has no
   * reason of its own to draw again, so this asks for the frame that shows it.
   */
  useEffect(() => {
    const p = Math.min(1, Math.max(0, progressRef.current));
    if (group.current) group.current.rotation.y = YAW_FROM + (YAW_TO - YAW_FROM) * p;
    invalidate();
  }, [invalidate, progressRef, screen]);

  useFrame(({ invalidate: askForAnother }, delta) => {
    if (!group.current) return;
    if (reduced) {
      group.current.rotation.y = -0.28;
      group.current.rotation.x = 0.02;
      return;
    }
    const p = Math.min(1, Math.max(0, progressRef.current));
    const target = YAW_FROM + (YAW_TO - YAW_FROM) * p;
    // Soft chase: the phone follows the scrollbar like a hand turning it, not
    // like a value snapped to it. Also erases scroll-jitter for free.
    // Delta is clamped because a demand loop can resume after an arbitrary
    // gap; without it the first frame back would be a snap rather than a turn.
    const k = Math.min(1, Math.min(delta, 0.1) * 7);
    group.current.rotation.y += (target - group.current.rotation.y) * k;
    // A whisper of tilt so the top edge catches the key light mid-turn.
    group.current.rotation.x = 0.03 + Math.sin(p * Math.PI) * 0.05;
    // Keep the loop alive only while there is still ground to cover. A
    // thousandth of a radian is a fifth of a pixel at this size.
    if (Math.abs(target - group.current.rotation.y) > 0.001) askForAnother();
  });

  return (
    <group ref={group}>
      {/* Body — near-black slab, slightly bluish like the app's navy chrome. */}
      <RoundedBox args={[BODY_W, BODY_H, BODY_D]} radius={0.075} smoothness={6}>
        <meshStandardMaterial color="#1b2130" metalness={0.35} roughness={0.4} />
      </RoundedBox>
      {/* Screen — the one real capture, floated a hair off the glass. */}
      <mesh position={[0, 0, BODY_D / 2 + 0.002]}>
        <planeGeometry args={[BODY_W * 0.925, BODY_H * 0.955]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
      {/* Camera plateau on the back, so the away-facing start reads as a phone
          rather than a blank domino. */}
      <mesh position={[-BODY_W * 0.27, BODY_H * 0.36, -(BODY_D / 2 + 0.004)]}>
        <boxGeometry args={[0.3, 0.3, 0.02]} />
        <meshStandardMaterial color="#242b3d" metalness={0.4} roughness={0.35} />
      </mesh>
      {[-0.06, 0.06].map((y) => (
        <mesh
          key={y}
          position={[-BODY_W * 0.27, BODY_H * 0.36 + y, -(BODY_D / 2 + 0.017)]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.035, 0.035, 0.012, 24]} />
          <meshStandardMaterial color="#0d1119" metalness={0.6} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}
