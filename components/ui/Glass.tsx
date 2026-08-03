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

/**
 * The scrim behind a modal, and the tap target that closes it.
 *
 * One of the five sanctioned surfaces, and the one that spent the longest not
 * actually being glass: it was a flat fill, so the game behind a sheet went
 * dark rather than out of focus. On iOS the decision sheet has had the real
 * material since it was written — `GlassKit.backdrop()` frosting the whole
 * webview — and this is every other sheet in the app catching up.
 *
 * Two elements rather than one, because `Glass` renders the tags glass is
 * allowed on and `button` is deliberately not among them. The pane is
 * `aria-hidden`; the button over it carries the label and the tap.
 *
 * NEVER over the WebGL canvas — compositing a full-screen backdrop-filter on
 * top of a live canvas is the iOS Safari jank source design.md names. Every
 * caller here opens over `/play`, whose masthead is an `<Image>`.
 */
export function GlassScrim({
  label,
  onClose,
}: {
  /** What the tap does, for a screen reader. "Close the team screen". */
  label: string;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0">
      <Glass className="nv-scrim absolute inset-0" aria-hidden="true" />
      <button
        type="button"
        aria-label={label}
        onClick={onClose}
        className="absolute inset-0 h-full w-full"
      />
    </div>
  );
}

/*
 * The `.nv-glass` rules live in app/globals.css alongside the tokens they
 * consume. They were briefly a <style> block in this file, for co-location —
 * which shipped a component whose CSS was never mounted, so every glass
 * surface rendered as a plain transparent div.
 */
