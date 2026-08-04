"use client";

import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
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
 *
 * ── Why the lighting is authored and not fetched ────────────────────────────
 *
 * This used to hang `<Environment preset="city" />` under the Suspense below.
 * A drei preset is not a local asset: it resolves to
 * `raw.githack.com/pmndrs/drei-assets/.../potsdamer_platz_1k.hdr` and is pulled
 * over the network the moment the shark mounts. Three things were wrong with
 * that, in increasing order of seriousness.
 *
 * It is a third-party request, which this app forbids — the same rule that
 * turned useDraco off twelve lines down rather than let drei attach a Google
 * CDN decoder, and the same rule the landing shark was rebuilt around
 * (components/landing/LandingSharkCanvas.tsx). It is a request made from the
 * one screen that has the player's camera open, on a product for minors.
 *
 * The shipped app boots with no network at all by design (capacitor.config.ts
 * — "Nothing is loaded over the network at boot"), so on a phone the fetch had
 * nothing to reach.
 *
 * And when it failed it did not degrade, it threw. The loader's rejection
 * propagates out of Suspense with no boundary under it, so /play died outright
 * — "Application error: a client-side exception has occurred" — and this is
 * the ONLY place the mascot is mounted: PerformScreen and PitchScore, which is
 * to say the pitch. Twelve months of a company played fine and the year gate
 * was a white screen, offline, on a school network that blocks the CDN, or in
 * the app.
 *
 * So the rig below stands in for the HDRI: the key and the brand rim are the
 * ones that were always here, plus the cool fill and floor bounce the image
 * was quietly providing. Same shape as the landing rig, which was authored for
 * the same reason.
 */

const BASE_Y = -0.06;
const MODEL_SCALE = 1.1;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Only these two states genuinely need a continuous fast loop. */
const isLive = (s: SharkState) => s === "listening" || s === "celebrate";

/**
 * A touch-first device. On these, the mascot never gets the unthrottled 60fps
 * loop: during a pitch the phone is ALSO running the camera, the recorder, the
 * recogniser and the delivery models, and a 3MB mesh at 60fps with 2× DPR and
 * antialiasing was competing with all of it for the GPU. Live states tick at
 * 15fps through <Heartbeat/> instead — indistinguishable on a mascot a couple
 * of hundred pixels tall, and a large slice of the reported pitch-screen lag.
 */
const coarsePointer = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/*
 * Resolved once per module rather than once per render.
 *
 * `coarsePointer()` is a live `matchMedia` read, and it was being called in the
 * render body — a synchronous media-query evaluation on the pitch screen's
 * hottest component. It also fed three object literals below, so every render
 * produced a new `camera`, `gl` and `dpr`, which is the shape R3F is least able
 * to ignore.
 *
 * A pointer does not change type mid-session in any way this app has to answer
 * for: a phone does not become a desktop, and the one real transition — a
 * keyboard attached to a tablet — is a page load away from mattering.
 */
const MOBILE = coarsePointer();
const CAMERA = { position: [0, 0.15, 3.1] as const, fov: 34 };
const GL = { alpha: true, antialias: !MOBILE };
const DPR: [number, number] = MOBILE ? [1, 1.5] : [1, 2];
const CANVAS_STYLE = { background: "transparent" };

export default function SharkCanvas({
  state,
  levelRef,
  reduced,
  tint,
  suitTint,
}: {
  state: SharkState;
  levelRef?: RefObject<number>;
  reduced: boolean;
  tint?: string;
  suitTint?: string;
}) {
  const mobile = MOBILE;
  return (
    <Canvas
      camera={CAMERA}
      gl={GL}
      style={CANVAS_STYLE}
      dpr={DPR}
      // Idle/thinking/verdict render on demand and are ticked slowly by
      // <Heartbeat/>, so a shark the player is not talking to does not burn
      // the battery at 60fps while they read a decision sheet. On phones even
      // the live states go through the heartbeat, at a faster tick.
      frameloop={isLive(state) && !reduced && !mobile ? "always" : "demand"}
    >
      <Heartbeat live={isLive(state)} reduced={reduced} mobile={mobile} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[2.5, 3, 3]} intensity={1.5} />
      {/* Brand orange rim light — the mascot's signature edge, and the honest
          version of the CSS bloom that used to fake it. */}
      <directionalLight position={[-3, 1, -2]} intensity={0.9} color={BRAND_ACTION} />
      {/* The two the HDRI was standing in for: a cool fill low on the front
          left, so the shadow side opens without the suit going flat, and a dim
          floor bounce so its underside and the tail keep their form. */}
      <directionalLight position={[-2.6, 0.6, 2.8]} intensity={0.55} color="#dfe8f2" />
      <directionalLight position={[0, -2.5, 1.5]} intensity={0.3} color="#f4ede2" />
      <Suspense fallback={null}>
        <SharkModel
          state={state}
          levelRef={levelRef}
          reduced={reduced}
          tint={tint}
          suitTint={suitTint}
        />
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
function Heartbeat({
  live,
  reduced,
  mobile,
}: {
  live: boolean;
  reduced: boolean;
  mobile: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (live && !reduced && !mobile) return; // "always" loop is already running
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
      // 15fps for a live state on a phone, 12fps idle; nothing backgrounded.
      const period = live ? 66 : 83;
      id = window.setInterval(tick, document.visibilityState === "visible" ? period : 1000);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", start);
    };
  }, [live, reduced, mobile, invalidate]);

  return null;
}

function SharkModel({
  state,
  levelRef,
  reduced,
  tint,
  suitTint,
}: {
  state: SharkState;
  levelRef?: RefObject<number>;
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
    /*
     * Clamped, and the lerps are frame-rate corrected — the same reasoning as
     * LandingSharkCanvas.tsx:165, which this loop never got.
     *
     * Two separate problems. First, this canvas is stopped and restarted
     * constantly: `frameloop` drops to "demand" for every non-live state and on
     * every phone, so R3F reports the true wall-clock gap since the last
     * RENDERED frame — which can be seconds. Unclamped, the shark resumes
     * mid-lurch after a decision sheet closes or the tab regains focus.
     *
     * Second, the `lerp(a, b, 0.08)` calls below are per-frame constants, so
     * they converge in half the time on a 120 Hz phone as on a 60 Hz one. The
     * lean was literally twice as fast on newer hardware. `blend` rewrites the
     * constant as an exponential decay over elapsed time, which is the same
     * curve at any refresh rate.
     */
    const dt = Math.min(delta, 1 / 30);
    t.current += dt;
    const time = t.current;
    const blend = (per60: number) => 1 - Math.pow(1 - per60, dt * 60);

    if (reduced) {
      group.current.position.set(0, BASE_Y, 0);
      group.current.rotation.set(0, 0, 0);
      return;
    }

    switch (state) {
      case "listening": {
        // Leans toward the camera; the lean tracks how loud you actually are.
        // Read off the ref here, inside the frame loop — this is the full-rate
        // signal, not the 24-step quantised copy React was being told about.
        const level = levelRef?.current ?? 0;
        const lean = 0.1 + level * 0.14;
        group.current.rotation.x = lerp(group.current.rotation.x, lean, blend(0.08));
        group.current.rotation.y = Math.sin(time * 0.5) * 0.06;
        group.current.position.z = lerp(group.current.position.z, 0.22 + level * 0.12, blend(0.07));
        group.current.position.y = BASE_Y + Math.sin(time * 1.1) * 0.015;
        break;
      }
      case "thinking": {
        group.current.rotation.y = lerp(group.current.rotation.y, -0.3, blend(0.05));
        group.current.rotation.z = lerp(group.current.rotation.z, 0.07, blend(0.05));
        group.current.position.y = BASE_Y + Math.sin(time * 0.9) * 0.02;
        group.current.position.z = lerp(group.current.position.z, 0, blend(0.05));
        break;
      }
      case "celebrate": {
        group.current.position.y = BASE_Y + Math.abs(Math.sin(time * 4.2)) * 0.16;
        group.current.rotation.y = Math.sin(time * 3.4) * 0.22;
        group.current.rotation.z = Math.sin(time * 3.4 + 1) * 0.06;
        break;
      }
      case "verdict": {
        group.current.rotation.y = lerp(group.current.rotation.y, 0.12, blend(0.06));
        group.current.rotation.x = lerp(group.current.rotation.x, -0.04, blend(0.06));
        group.current.position.y = BASE_Y + Math.sin(time * 1.4) * 0.01;
        break;
      }
      default: {
        // Idle breath.
        group.current.rotation.y = Math.sin(time * 0.35) * 0.1;
        group.current.rotation.x = lerp(group.current.rotation.x, 0, blend(0.05));
        group.current.rotation.z = lerp(group.current.rotation.z, 0, blend(0.05));
        group.current.position.y = BASE_Y + Math.sin(time * 1.05) * 0.022;
        group.current.position.z = lerp(group.current.position.z, 0, blend(0.05));
      }
    }
  });

  return (
    <group ref={group} position={[0, BASE_Y, 0]}>
      <primitive object={model} scale={MODEL_SCALE} />
    </group>
  );
}
