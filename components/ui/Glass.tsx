"use client";

/**
 * The ONLY place `backdrop-filter` appears in this app.
 *
 * ── Status: the CSS material is retired ─────────────────────────────────────
 *
 * The gate in globals.css now applies the solid fallback on EVERY platform,
 * iOS included — the owner's call: the only Liquid Glass in the app is what
 * UIKit itself draws (the play chrome, overlay toolbars, the decision sheet),
 * and a CSS impression of that material sitting next to the real thing reads
 * as an impression. Everything below still describes the material these
 * components were built to render, because the components, their layout and
 * their vocabulary are unchanged — they all now resolve to the solid,
 * shadowed panels of the fallback path. Re-opening the material is the
 * `[data-css-glass]` attribute, deliberately written by nothing.
 *
 * Glass is a material for the control layer. It is never a material for
 * content — cards, The Books, the ledger, the roster and anything carrying a
 * financial figure sit on solid ground. Money is read on solid ground.
 *
 * Two halves, and the second one arrived late:
 *
 * **Panels** — `Glass` and `GlassScrim`, below. The tab bar, a sheet's grabber
 * and its header once content scrolls under it, toasts, the year-gate banner,
 * the in-game phone's status bar and dock, and modal scrims.
 *
 * **Controls** — `GlassButton` and the rest, further down. Every button, chip
 * and row control in the app. For a long time "the
 * control layer" was read as meaning *the chrome*, which left the app's ~170
 * buttons as flat fills sitting next to a material they were the clearest
 * example of. A button IS the control layer; see design.md §0.
 *
 * Four layers, in order, for both halves:
 *   1. backdrop-filter: blur + saturate
 *   2. a semi-transparent tint fill — where a tone colours the MATERIAL
 *   3. a 1px specular top edge      ← GRADIENT #1 OF 3
 *   4. an inset hairline ring
 *
 * and one thing only a control has: a press, which scales and brightens on the
 * curve UIKit animates `UIGlassEffect.isInteractive` on.
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

/* ══ Controls ═════════════════════════════════════════════════════════════
 *
 * Glass for the things a thumb lands on.
 *
 * `Glass` above is a panel — a tab bar, a sheet header, a scrim. That was the
 * whole vocabulary, which is why glass reached five surfaces in this app and
 * then stopped: there was no way to say "this button is made of the material"
 * without hand-rolling a blur, and a hand-rolled blur is exactly what the file
 * header forbids. So the material grew a control half, in the one file allowed
 * to own it.
 *
 * On iOS the play screen's chrome is still UIKit and still the system's own
 * Liquid Glass — nothing here replaces that, and the DOM does not render those
 * controls at all. This is every OTHER surface: the six activity screens, the
 * closet, settings, the phone, the panel, onboarding, the year-end statement,
 * Android, and the web.
 *
 * ── The tones ────────────────────────────────────────────────────────────
 *
 * A tone colours the material rather than painting over it, so a tinted
 * control is still a lens. Which one to reach for:
 *
 *   `neutral`   the default. Anything that is not the screen's one CTA.
 *   `action`    the ONE control on a screen that asks you to do something.
 *   `prestige`  the year gate, and what the gold marks. Rare by design.
 *   `alert`     a confirmed destructive action — red ground, white ink.
 *   `danger`    an unconfirmed one — red ink on glass. The first tap.
 *   `solvency`  financial upside, and never a CTA.
 *   `quiet`     a cancel beside a confirm. Present, not asking.
 */

export type GlassButtonTone =
  | "neutral"
  | "action"
  | "prestige"
  | "alert"
  | "danger"
  | "solvency"
  | "quiet";

/**
 * Shape presets, so a caller never has to remember which radius a shape takes.
 *
 * `block` is a full-width control at the bottom of a card, and it is NOT a
 * capsule any more — a full-bleed 999px button is the one place the pill was a
 * costume rather than a shape, so it takes `--radius-card` like every other
 * full-width control. `pill` keeps 999px because a chip sized to its own label
 * genuinely is one. `circle` is an icon on its own. `row` is a list row, which
 * is square-shouldered because it lives inside a `GlassGroup` that owns the
 * corner for the whole stack — and the group therefore takes the CARD token,
 * one step rounder than the rows it contains.
 */
export type GlassShape = "block" | "pill" | "circle" | "row" | "bare";

const SHAPE: Record<GlassShape, string> = {
  block: "h-12 w-full rounded-[var(--radius-card)] px-5",
  pill: "h-9 rounded-[var(--radius-pill)] px-4",
  circle: "h-10 w-10 rounded-full",
  row: "h-12 w-full px-4",
  bare: "",
};

interface GlassButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  tone?: GlassButtonTone;
  shape?: GlassShape;
  /** Force the opaque fallback. Mandatory over the WebGL canvas. */
  solid?: boolean;
  /**
   * This control is already sitting on glass.
   *
   * Keeps the tint, the crest and the press; drops the blur. Two stacked
   * backdrop-filters do not make deeper glass, they make a smudge — so a
   * button on a sheet header, on the phone's dock, or inside any `Glass`
   * panel passes this.
   */
  flat?: boolean;
  /** The equipped item, the chosen row — a control the player is on. */
  on?: boolean;
  /** `button` unless a form genuinely wants a submit. Never defaulted to
   *  "submit": a bare <button> inside a <form> submits it, which is how a
   *  cancel control ends up posting the thing it was cancelling. */
  type?: "button" | "submit";
}

/**
 * A button made of glass.
 *
 * The press is CSS (`.nv-gc:active`) rather than `nv-press`, because the
 * material brightens as it scales — `UIGlassEffect.isInteractive` deforms and
 * brightens the lens under a finger, and a scale alone is only half of it.
 */
export function GlassButton({
  tone = "neutral",
  shape = "block",
  solid = false,
  flat = false,
  on,
  type = "button",
  className = "",
  children,
  ...rest
}: GlassButtonProps) {
  return (
    <button
      type={type}
      data-glass={solid ? "solid" : undefined}
      data-flat={flat ? "true" : undefined}
      data-tone={tone === "neutral" ? undefined : tone}
      data-on={on ? "true" : undefined}
      className={`nv-gc inline-flex items-center justify-center gap-2 font-bold ${SHAPE[shape]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A cluster of controls that behave as one piece of material.
 *
 * The web's answer to `UIGlassContainerEffect`. A browser cannot merge two
 * backdrops the way iOS 26 does, but it can do the thing merging is for: one
 * pane of glass with several controls in it. The group carries the blur once
 * and its children carry a hairline, which is both what a list of rows should
 * look like and the reason a thirteen-row settings screen costs one compositor
 * pass rather than thirteen.
 */
export function GlassGroup({
  solid = false,
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { solid?: boolean }) {
  return (
    <div
      data-glass={solid ? "solid" : undefined}
      className={`nv-ggroup rounded-[var(--radius-card)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * A list row inside a `GlassGroup`. Label on the left, whatever the row is
 * telling you on the right, 48px tall because that is what a thumb is.
 */
export function GlassRow({
  label,
  detail,
  chevron = true,
  className = "",
  ...rest
}: Omit<GlassButtonProps, "shape" | "children"> & {
  label: React.ReactNode;
  /** The value, or a chevron's worth of "there is more through here". */
  detail?: React.ReactNode;
  chevron?: boolean;
}) {
  return (
    <GlassButton
      shape="row"
      className={`justify-between text-left text-sm ${className}`}
      {...rest}
    >
      <span className="min-w-0 truncate font-semibold">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {detail ? (
          <span className="truncate text-2xs font-bold text-[var(--text-tertiary)]">
            {detail}
          </span>
        ) : null}
        {chevron ? (
          <span aria-hidden className="text-[var(--text-tertiary)]">
            ›
          </span>
        ) : null}
      </span>
    </GlassButton>
  );
}

/*
 * The `.nv-glass` and `.nv-gc` rules live in app/globals.css alongside the
 * tokens they consume. They were briefly a <style> block in this file, for
 * co-location — which shipped a component whose CSS was never mounted, so
 * every glass surface rendered as a plain transparent div.
 */
