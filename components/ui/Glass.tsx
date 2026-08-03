"use client";

/**
 * The ONLY place `backdrop-filter` appears in this app.
 *
 * Glass is a material for the control layer. It is never a material for
 * content — cards, The Books, decision sheets and anything carrying a financial
 * figure sit on solid ground. Money is read on solid ground.
 *
 * Sanctioned surfaces: the tab bar, a sheet's grabber and its header once
 * content scrolls under it, toasts, the year-gate banner, the in-game phone's
 * status bar and dock, and modal scrims. Nothing else.
 *
 * Four layers, in order:
 *   1. backdrop-filter: blur + saturate
 *   2. a semi-transparent tint fill
 *   3. a 1px specular top edge      ← GRADIENT #1 OF 3
 *   4. an inset hairline ring
 */

/**
 * What colours the material itself.
 *
 * `action` and `prestige` are the web's answer to `UIGlassEffect.tintColor`:
 * the tint goes into layer 2, so the pane is still a pane — lit edge, shadowed
 * underside, the content behind it still showing through. Painting the accent
 * over the top instead gives a coloured rectangle that happens to have a blur
 * behind it, which is the thing this whole file exists not to be.
 *
 * A tinted surface still counts against the two-glass-surfaces budget, and the
 * accent rule is unchanged: `action` belongs to the one control that asks you
 * to do something, and nothing else.
 */
export type GlassTone = "neutral" | "action" | "prestige";

interface GlassProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. `React.ElementType` widens props to `never`, so this
   *  is deliberately narrowed to the tags glass is actually allowed on. */
  as?: "div" | "nav" | "header" | "footer" | "aside" | "section";
  /**
   * Force the opaque fallback. Required for any surface that overlaps the
   * WebGL canvas — compositing backdrop-filter over a live canvas is a known
   * iOS Safari jank source, and it will not reproduce in a desktop browser.
   */
  solid?: boolean;
  tone?: GlassTone;
}

export function Glass({
  as: Tag = "div",
  solid = false,
  tone = "neutral",
  className = "",
  children,
  ...rest
}: GlassProps) {
  return (
    <Tag
      data-glass={solid ? "solid" : "blur"}
      // Absent rather than "neutral" for the default, so the attribute
      // selector in globals.css only ever matches a deliberate choice.
      data-tone={tone === "neutral" ? undefined : tone}
      className={`nv-glass ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/*
 * The `.nv-glass` rules live in app/globals.css alongside the tokens they
 * consume. They were briefly a <style> block in this file, for co-location —
 * which shipped a component whose CSS was never mounted, so every glass
 * surface rendered as a plain transparent div.
 */
