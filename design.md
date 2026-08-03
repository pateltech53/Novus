# NOVUS · Design System

**Status: locked.** From Phase 1 onward this file overrides improvisation. If a screen needs a
value that is not here, add it here first as a named token, then reference it.

Authority order: `Novus_Brand_Identity_v2.pdf` → this file → component code.
Brand hues are **not** open for redesign. Everything else in here is.

---

## 0 · The one law that resolves the brief

The brief asks for *"liquid glass morphism + 3D"* and *"minimize gradients"* in the same
sentence. Those are in tension — liquid glass **is** stacked specular gradients over a blur.
Apple's own guidance is the resolution:

> **Glass is a material for the control layer. It is never a material for
> content. And it is the iOS app's, and nowhere else's.**

### Glass ships on iOS only

Liquid Glass is a material iOS renders. Everywhere else it is an approximation
of one — and an approximation of a lens is not a cheaper lens, it is a
different and worse thing that invites the one comparison it cannot win. So on
Android and on the web the material is off, and those platforms get the solid,
shadowed, well-lit panels this design system had before any of it: flat fill,
real elevation, no blur, no crest, no sheen.

Nothing else changes with it. Every layout, every tap target, every ink colour
and every state is identical on all three platforms — the gate in
`globals.css` moves two properties, the backdrop and the fill, and touches
nothing that could make a screen behave differently depending on where it is
running.

`[data-platform="ios"]` is written on `<html>` by a blocking script in
`<head>`, so a browser never paints a frame of glass before finding out it
should not have. The tables below describe **the iOS app**; read them as
"solid surface" anywhere else.

| Layer | What is in it | Material |
|---|---|---|
| **Content** | cards, The Books, lists, the ledger, closet grids, anything carrying a figure | Opaque solid. Flat fill, no gradient, no blur, no transparency. Depth from shadow and elevation only. |
| **Controls** | every button, chip, row control, segmented control, field and toggle in the app | Liquid glass. The material, not a colour on a rectangle. |
| **Chrome** | tab bar, the advance capsule and the month badge beside it, screen toolbars and docks, sheet grabber, toasts, year-gate banner, phone status bar + dock, modal scrims | Liquid glass. |
| **The decision sheet** | its own surface, its choice rows, its explainer boxes and its one action button | Liquid glass, on iOS only. **The named exception**, below. |
| **Stage** | mascot, panel room | Real 3D, real lighting. Depth from geometry and light. |

**Money is read at full strength.** This rule used to say *on solid ground* —
that any element carrying a financial figure was content and never glass. It
has changed, deliberately and with the cost known.

What it was protecting was never the opacity. It was the number: a runway of
3mo has to be as readable as a runway of 14mo, on a phone, at arm's length, in
sunlight. A ledger tile on a lens is fine at that bar; a ledger tile on a lens
whose figure was dropped to a secondary colour to "sit better on the material"
is not, and that is the failure this clause now names.

So the ledger, the dossier's cash panel and its stat tiles are glass, and the
figures inside them keep the ink they had:

- a figure is `--text` / `--solvency` / `--alert` at full strength, never a
  secondary or tertiary step, and never a colour chosen to harmonise with a
  tint;
- `tnum` stays, so a changing number does not shift a pixel;
- a tone's own mix is a legibility floor, not a taste setting — `--gc-mix` is
  68% on dark and 88% on light because white ink on `#e35f00` at 68% over a
  near-white page lands at 2.6:1 and fails AA outright.

The decision sheet's choice rows keep their cost chip in `label` semibold for
the same reason, which is where this reasoning was first written down.

### The controls row is a widening, and it is deliberate

Until this revision "the control layer" was read as *the chrome* — five named
surfaces — and every one of the app's ~170 buttons was a flat fill. That was a
misreading of the law that survived because it was never written down either
way: a button is the control layer. It is the *only* thing in the app that is
unambiguously a control.

So the law is unchanged and the reading is corrected. What follows from it:

- **A control is made of the material, not painted with it.** A tone colours
  layer 2 — `UIGlassEffect.tintColor` natively, `--gc-tint` on the web — which
  is why a tinted control is still a lens. An accent painted over the top gives
  a coloured rectangle that happens to have a blur behind it, which is the thing
  the whole material exists not to be.
- **The accent rule is not relaxed by there being more glass.** One `action`
  control per screen. `prestige` for the year gate and what the gold marks.
- **The "max two glass surfaces" budget is retired**, and is replaced by the
  thing it was protecting: a control never blurs what another glass surface has
  already blurred. Two stacked backdrops are a smudge, not deeper glass. On iOS
  that is `UIGlassContainerEffect`; on the web it is `.nv-ggroup` and
  `nv-flat`, and both mean the same thing — one pane of material with several
  controls cut out of it.
- **Never over live pixels.** A control inside a `data-live-3d` subtree goes
  opaque, because compositing a backdrop-filter over a running WebGL canvas
  re-rasterises the backdrop root every frame on exactly the phones that can
  least afford it.
- **Content did not move.** Cards, The Books, the ledger, the roster and every
  figure in the app are still opaque, and a control that carries a figure sets
  its ink to a full-strength label colour to pay for the material.

### The named exception: the decision sheet, on iOS

The month's decision is presented by UIKit (`GlassSheetController.swift`), and
its surface, choice rows, explainer boxes and action button are Liquid Glass,
cost chips and all. That is a product decision taken deliberately, not a rule
that eroded.

The explainer boxes and the action button joined it later and for one reason:
they were the only three opaque things left on a surface that is otherwise
glass end to end — `.secondarySystemBackground` slabs and a flat orange
rectangle in the middle of it, which read as unfinished rather than as
restrained. Neither carries a figure, so the "money on solid ground" half of
the law is untouched by them.

Three things keep it honest:

- **It is iOS-only.** The web and Android decision sheet is unchanged and stays
  opaque. This is not a licence for glass to spread to The Books, to cards, or
  to any list on any platform.
- **It is paid for.** Small monospaced text is the first thing a refractive
  material eats, so the cost chip moved from `secondaryLabel` regular to
  `label` semibold. A figure that cannot be read is worse than one on the
  wrong material.
- **It is one line to undo.** `panel.backgroundColor` and the row's material in
  `choiceRow` are the whole change. If it reads muddy on a device, put them
  back and the sheet keeps every other piece of glass it has.

With a card open there are three glass surfaces — backdrop, sheet, rows — and
the tab bar is withdrawn. More nesting than Apple's own guidance likes.
Recorded here rather than left to be discovered.

### The gradient ledger — exactly three, named

1. The specular sheen inside a glass element — the lit crest that makes a pane
   read as a solid with thickness. One mechanism, at two scales: `.nv-glass` on
   a panel, `.nv-gc` and `.nv-ggroup` on a control. Every instance of it is
   this entry; a control is not a fourth gradient for having an edge.
2. The mascot-stage vignette (one radial, over solid `--n-0`).
3. The scrim fade at the bottom of a scrollable sheet.

Every other gradient is deleted, including the current `--stage: linear-gradient(...)`.
Count them before calling a phase done.

---

## 1 · Colour

### 1.1 Brand constants — locked by Brand Identity v2

```css
--color-action:   #FF6B00;  /* the ONLY colour that asks you to do something */
--color-solvency: #3DDC97;  /* financial upside ONLY — never a CTA */
--color-prestige: #FFC24B;  /* IPO gold, year gate, badges. Rare by design. */
--color-alert:    #FF3333;  /* filler words + financial damage */
```

Light theme needs a deeper action orange to hold contrast on white: `--color-action-light: #E85F00`.

### 1.2 Neutral ramp — 12 steps, OKLCH

Replaces every `rgb(11 30 54 / 0.xx)` in the codebase. Hue held at 250; **chroma kept ≤ 0.022**
so the ground reads as considered graphite-navy rather than saturated "AI dark mode blue."

```css
--n-0:  oklch(0.14 0.020 250);  /* deepest ground — the mascot stage */
--n-1:  oklch(0.18 0.022 250);  /* app background — the default world */
--n-2:  oklch(0.22 0.022 250);  /* raised surface */
--n-3:  oklch(0.26 0.021 250);  /* card */
--n-4:  oklch(0.31 0.020 250);  /* card, elevated */
--n-5:  oklch(0.38 0.018 250);  /* hairline / divider */
--n-6:  oklch(0.47 0.016 250);
--n-7:  oklch(0.58 0.014 250);  /* tertiary text */
--n-8:  oklch(0.68 0.012 250);  /* secondary text */
--n-9:  oklch(0.80 0.008 250);
--n-10: oklch(0.91 0.005 250);  /* primary text */
--n-11: oklch(0.97 0.003 250);  /* pure emphasis */
```

**The calibrated risk, stated so it can be judged:** this ramp is slightly desaturated and
warm-shifted relative to the flat `#0B1E36`. That single move is what stops the orange fighting a
saturated blue and lets it sit on graphite instead. Phase 1 must build it, screenshot it beside
the old value, and keep whichever is better — the comparison is mandatory, the outcome is not
pre-decided.

### 1.3 Semantic aliases — components reference these, never the ramp

```css
--bg:               var(--n-1);
--surface:          var(--n-2);
--surface-elevated: var(--n-3);
--surface-overlay:  var(--n-4);
--hairline:         var(--n-5);
--text-tertiary:    var(--n-7);
--text-secondary:   var(--n-8);
--text-primary:     var(--n-10);
```

### 1.4 Dark is the default world

Ship dark as default. Light is a **full parallel token set**, not an inversion — shadows get
lighter and tighter, hairlines get darker, and the accent deepens to `#E85F00`. Never
`filter: invert()`.

### 1.5 The accent budget — the single strictest rule here

`--color-action` may appear on **at most one element per screen**: the primary CTA. Nothing else.

Not a heading colour. Not an icon tint. Not a border. Not a chart colour. Not a tab indicator.
Not a focus ring on a non-primary control.

Baseline is 70 usages across 26 files, painting 5 elements at once on `/play`. That count — not
the hue — is what reads as generated.

### 1.6 Zero inline colour

`grep -rn "#[0-9a-fA-F]\{6\}" components/ app/` returns **only** the token block. The in-fiction
phone-app tints (`phone/Phone.tsx`) stay deliberately outside the Novus palette but must still be
named tokens. The cosmetic swatch hexes in `lib/engine/avatar.ts` are data, not UI colour — leave them.

---

## 2 · Elevation — depth without gradients

Five steps. Each is **two shadows**: a tight contact shadow and a wide ambient one. This is the
honest version of the "3D" the brief asks for.

```css
--e0: none;
--e1: 0 1px 2px oklch(0 0 0 / 0.24), 0 1px 3px  oklch(0 0 0 / 0.12);
--e2: 0 2px 4px oklch(0 0 0 / 0.22), 0 4px 12px oklch(0 0 0 / 0.16);
--e3: 0 4px 8px oklch(0 0 0 / 0.24), 0 12px 32px oklch(0 0 0 / 0.20);
--e4: 0 8px 16px oklch(0 0 0 / 0.26), 0 24px 56px oklch(0 0 0 / 0.26);
```

- Elevation is **monotonic with z-order** — a sheet above a card has a strictly higher `--e`.
- A pressed element drops one step.
- **Never animate `box-shadow`.** Animate a pseudo-element's `opacity` instead.

---

## 3 · Glass

One component: `components/ui/Glass.tsx`. Nobody hand-rolls `backdrop-filter` anywhere else.

Four layers, in order:

1. `backdrop-filter: blur(24px) saturate(180%)`
2. a semi-transparent tint fill — `--n-2` @ 62% dark, `--n-11` @ 68% light
3. a 1 px specular top edge — top-aligned linear-gradient `white/14% → transparent` *(gradient #1)*
4. an inset hairline ring — `box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.06)`

**Allowed:** floating tab bar / bottom nav · the advance capsule and the month badge beside it ·
sheet grabber and sheet header when content scrolls under it · toasts, the term-on-first-use note
and the year-gate banner · the in-game phone's status bar and dock · modal scrims.

**"When content scrolls under it" is a requirement, not a description.** Every one of the six
activity screens now pins its header (`ScreenSheet`, and RobinGhood's own) *inside* the scroll
container, so the roster, the ledger and the tape genuinely pass beneath a pane. Where a header is
a `shrink-0` sibling that reserves its own height, nothing ever travels under it and the glass
refracts a flat fill — a tinted rectangle wearing the material's cost. RobinGhood's header was
exactly that and moved into the scroller to earn it.

**Tint.** `Glass.tsx` takes `tone="action" | "prestige"`, which colours layer 2 rather than
painting a fill over the stack — the web's half of `UIGlassEffect.tintColor`. It adds no gradient:
the specular edge is still gradient #1, brightened to clear a saturated pane. The accent rule is
unchanged by it. `action` belongs to the one control that moves time and to nothing else.

**Not the scroll edge.** A glass bar that faded in behind the masthead controls as the mascot
scrolled past used to be here, on the "sheet header once content scrolls under it" clause. It is
deleted. Those controls are already Liquid Glass floating over the stage; a second pane arriving
behind them on scroll is glass behind glass, which is a smudge rather than a layer.

**The budget, spent.** §0's "max two visible at once" is a real limit and `/play` now sits at its
ceiling: the masthead cluster and the bottom deck, where the deck's two capsules are one grouped
surface (`UIGlassContainerEffect`) rather than two. The term-on-first-use note makes a third for
the seconds it is up, which is the same allowance a toast has always had. Recorded here rather
than left to be discovered.

**Forbidden:** The Books · cards · list rows · closet grids · anything over the
WebGL canvas · anything containing a financial figure — **except** the native
iOS decision sheet and its choice rows, per the named exception in §0. On the
web and on Android the decision sheet is opaque, unchanged.

`Glass.tsx` must ship a `@supports not (backdrop-filter: blur(1px))` fallback to solid
`--surface-overlay`, and accept a `solid` prop that forces that fallback for use near the canvas.

> **iOS guard rail.** `backdrop-filter` compositing over a live WebGL canvas is a known jank
> source on iOS Safari. Never place glass over `<Canvas>`. If a glass element must overlap the
> mascot stage, swap it to solid under the `@supports` fallback and while the stage animates.

---

## 4 · Typography

### 4.1 Two faces

| Role | Face | Why |
|---|---|---|
| **UI / display** | **Urbanist** (already installed) | Keep it. It is fine and it is the brand's. |
| **Ledger** | **IBM Plex Mono** | The money's own voice. |

**Why IBM Plex Mono, over the alternatives named in the brief:**

- **Söhne Mono / Berkeley Mono** give the best "terminal ledger" read, but both are commercial.
  Licensing cost and audit risk are not worth it for a product distributed to minors through
  schools, and licensability could not be verified.
- **IBM Plex Mono** is OFL — free, redistributable, self-hostable via `next/font/google`, so it
  adds **no external request** (which matters for the installable PWA and for §12.4's
  no-third-party-fingerprinting stance). It has true tabular figures, a real 700 weight, and is
  narrower than Roboto Mono so long currency strings hold without wrapping. Its slightly
  institutional character suits an investor panel.
- **Roboto Mono** is the safe fallback and the least characterful. Only if Plex fails a test.

```css
--font-ledger: var(--font-ibm-plex-mono), ui-monospace, monospace;
font-feature-settings: "tnum" 1, "ss01" 1;
```

### 4.2 The signature move

Financial figures are set in the ledger face at a **fixed optical width**, so when runway drops
from `14 mo` to `3 mo` the digits do not shift a single pixel — the number just changes
underneath you. Costs nothing; it is what makes an interface feel built rather than assembled.

`.tnum` already exists in `globals.css`. Make it **universal on every figure** and pair it with
the ledger face. Use it in The Books, the year-end statement, RobinGhood, offer terms, and every
currency or percentage in the app.

### 4.3 Scale

Keep the existing `--text-*` ramp. **Enforce it** — the baseline has 171 arbitrary
`text-[…rem]` declarations that bypass it.

**Hard floor: nothing below 12px, anywhere.** Baseline has 117 sub-12px declarations across 20
files, smallest at 8px — including The Books' own labels. `--text-2xs` is currently 11px and must
be raised to 12px or retired.

**No italic headings, ever.** Emphasis is carried by weight or colour. Italic display type is one
of the most reliable AI tells. Italic survives only as body-copy emphasis inside running paragraphs.

Exactly two faces. No third display face.

---

## 5 · Motion

- **Enter ~280 ms, exit ~180 ms.** Exits are faster than entrances (~0.66×).
- **Only `transform` and `opacity` animate.** Never `width`, `height`, `top`, `left`,
  `box-shadow`, or `backdrop-filter`. (Baseline violates this: `globals.css` transitions
  `background-color` and `color`; `AdvanceButton` ships an animated `box-shadow` keyframe.)
- **Spring physics** on anything that models a physical object — sheets, cards, the phone.
  Easing curves on everything else. Sheets use `stiffness ≈ 380, damping ≈ 34`, not a duration.
- Three named easings only: `--ease-out`, `--ease-in`, `--ease-in-out`. Never the browser default.
- **`prefers-reduced-motion` genuinely respected** — replaced with a cut where motion carries no
  information, not merely shortened. The current CSS-only override does not reach Framer Motion;
  fix that.
- **One orchestrated motion moment per screen**, not five scattered ones.
- Focus rings appear **instantly**. Never animate a focus ring.

---

## 6 · iOS-native feel

Behaviours, not a texture. All required.

| Behaviour | Implementation |
|---|---|
| Fullscreen PWA | `apple-mobile-web-app-capable`, `status-bar-style: black-translucent`, full icon set incl. 180×180, `manifest.json` with `display: standalone`. Verify: add to home screen → no Safari chrome. |
| No body rubber-band | `overscroll-behavior-y: none` on the scroll container. The **body never scrolls**; an inner container does. Sheets keep their own momentum. |
| No tap highlight / callout | `-webkit-tap-highlight-color: transparent`, `-webkit-touch-callout: none` on **interactive elements only** — never globally, it breaks text selection. |
| No double-tap zoom | `touch-action: manipulation` on all buttons. |
| Real safe areas | `env(safe-area-inset-*)` on every fixed element, top and bottom. Test with the home indicator present. |
| Sheet physics | Spring, drag-dismissible, velocity-aware snap — a fast flick dismisses from a short drag. Framer `drag="y"` + `dragConstraints` + `onDragEnd` velocity check. |
| Scroll-linked headers | Large title collapses to inline on scroll. Scroll-position-driven, not time-driven. |
| Press, not hover | `scale(0.97)` + elevation drop on `:active` within 50 ms. Hover only behind `@media (hover: hover)`. |
| Haptics | `navigator.vibrate` 8–12 ms on: choice committed, year closed, deal signed, Chapter 7. Feature-detect. |
| Keyboard avoidance | `interactive-widget=resizes-content` in the viewport meta; `dvh` throughout. |
| `dvh` not `vh` | Sweep for any remaining `vh`. |

---

## 7 · Responsive floor

Verify at **320 / 375 / 414 / 768 / 1280**.

- `overflow-x: clip` on `html` and `body`. Never `hidden`. *(baseline: already correct)*
- Image-bearing grid tracks use `minmax(0, 1fr)`, never bare `1fr`.
- Long headings wrap inside words: `overflow-wrap: anywhere; min-width: 0`.
- Safe-area insets on every fixed element.
- **No horizontal scroll at any width.**
- **No two-line clickable text** — buttons, nav links, tabs, CTAs — at any breakpoint.
  *(baseline: `/found` fails — "Fashion / Streetwear", "Toys & Collectibles")*

### Desktop is not a stretched phone

At ≥1024 px the play surface **centres at a max-width**, the mascot stage is promoted to a
persistent left column, and The Books docks to a right rail. Same components, different
composition.

Baseline fails this in the opposite direction from the usual: it goes **full-bleed**, so The Books
becomes a 1280 px band with 8 px labels and ADVANCE MONTH becomes an 800 px orange slab.
Neither a stretched sheet nor a 375 px column in a void is acceptable.

---

## 8 · Honesty

- **No invented metrics, no fabricated testimonials, no "trusted by N users."** Anywhere — app or
  marketing surface.
- **No "✨ Powered by AI" badges.** Never narrate the implementation in the UI.
- Empty states give **direction**, not mood. Errors say what happened and how to fix it, and
  **never apologise**.
- Every control's label says what happens: **"Close the year"**, not "Continue". The verb survives
  into the result toast.
- Only claim what the app can evidence. If Fluency can't cite what raised it, don't raise it.

### Vocabulary

Real words only: **burn rate · runway · dilution · gross margin · Chapter 7**. Never coins,
energy, gems, or XP. Rookie Mode **adds** a plain-English gloss beside the real term; it never
replaces it.

---

## 9 · Anti-slop gates — run as a checklist, not a vibe

Every screen passes before it is called done. Verify against **screenshots**, not against code.

**Structure & restraint**
- [ ] No screen uses hero → 3-cards → CTA. Screens differ **structurally**, not just in content.
- [ ] Structural devices encode something true. Numbered markers only where the content is a sequence.
- [ ] No decorative icon beside a label that already says the thing.
- [ ] **Chanel test:** find the one element that could be removed with no loss. Remove it.

**Typography**
- [ ] No italic headings.
- [ ] Exactly two faces + optional utility face.
- [ ] No text below 12px. No two-line buttons or nav links at any breakpoint.

**Colour & material**
- [ ] Every colour references a named token. Zero inline hex / `rgb()` / `oklch()` outside the token block.
- [ ] Exactly three gradients in the app. Count them.
- [ ] Accent appears **once** per screen.
- [ ] AA on all text; **AAA on any figure in The Books**.

**Motion**
- [ ] Exits ~0.66× entrances.
- [ ] Only `transform` / `opacity`.
- [ ] Springs for physical objects, easings for everything else.
- [ ] `prefers-reduced-motion` replaced-not-shortened where motion carries no information.
- [ ] One orchestrated moment per screen.

**Responsive** — at 320 / 375 / 414 / 768 / 1280
- [ ] `overflow-x: clip` on html and body.
- [ ] `minmax(0, 1fr)` on image-bearing tracks.
- [ ] `overflow-wrap: anywhere; min-width: 0` on long headings.
- [ ] Safe areas honoured top and bottom.
- [ ] No horizontal scroll.

**Honesty**
- [ ] No invented metrics or testimonials.
- [ ] Empty states direct; errors explain and don't apologise.
- [ ] Labels say what happens; the verb survives into the toast.

**Accessibility** (§12.2 — not optional, cheap if done as you go)
- [ ] Full keyboard nav with visible `:focus-visible`.
- [ ] Semantic landmarks; every icon-only control labelled.
- [ ] Live regions on The Books when figures change.
- [ ] **Every camera/mic moment has a text-input fallback**, scored on content only, stated plainly.

---

## 10 · Known measurement caveat

The browser pane used for verification runs with `document.visibilityState === "hidden"`, so
`requestAnimationFrame` is throttled and **Framer Motion entrance animations never complete** —
raw screenshots come back blank or half-faded. Until a first-class static-capture switch exists
(`?motion=off` / `MotionConfig initial={false}` + R3F `frameloop="demand"`), settle the page first:

```css
[style*="opacity"] { opacity: 1 !important }
[style*="transform"] { transform: none !important }
*, *::before, *::after { transition: none !important }
```

This is a crutch for reading layout and colour. It does **not** verify motion gates — those stay
unverified until the switch lands. See `docs/BASELINE.md` §7 B2.
