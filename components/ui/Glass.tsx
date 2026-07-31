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
}

export function Glass({
  as: Tag = "div",
  solid = false,
  className = "",
  children,
  ...rest
}: GlassProps) {
  return (
    <Tag
      data-glass={solid ? "solid" : "blur"}
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
