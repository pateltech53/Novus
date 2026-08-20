---
name: novus-brand
source: bespoke — derived verbatim from the Novus repo design system (design.md, locked) + favicon.svg
colors:
  # Brand constants — locked by Novus Brand Identity v2 (design.md §1.1)
  action: "#FF6B00"        # the ONLY colour that asks you to do something — one element per screen
  action-light: "#E85F00"  # action orange on light/white ground
  alert: "#FF3333"         # damage / danger
  prestige: "#FFC24B"      # rare gold
  solvency: "#3DDC97"      # upside only, never CTA
  # Neutral ramp (design.md §1.2, OKLCH hue 250 graphite-navy → sRGB)
  n0: "#0B0E15"            # deepest ground — the stage
  n1: "#12151D"            # background — the default world
  n2: "#191D27"            # raised surface
  n3: "#212631"            # card
  n5: "#3A404D"            # hairline
  n8: "#9AA1AD"            # secondary text
  n10: "#E2E4E9"           # primary text
  n11: "#F5F6F8"           # pure emphasis
  white: "#FFFFFF"         # CTA card ground (light world)
  ink: "#0A0A0A"           # CTA card text (black on white)
  logo-navy: "#131C2E"     # favicon ground
typography:
  display: "Urbanist"      # UI / display — the brand's face; 700–900 for display
  mono: "IBM Plex Mono"    # the ledger voice; chrome, small caps labels
  fallbacks: "Urbanist, system-ui, -apple-system, sans-serif / 'IBM Plex Mono', ui-monospace, monospace"
spacing:
  radius: "15px on marks (favicon rx≈15/64); content cards square-to-soft"
components:
  logo: "orange shark fin (path: M40 9 C46 16 48 26 48 38 L16 38 C20 22 30 12 40 9 Z) over white wave stroke, on #131C2E rounded square — from public/icons/favicon.svg"
---

# Novus — frame-scale brand

## Overview

Novus (novuspitch.com) is a Shark Tank-style pitch simulator: cartoon shark
investors, dark graphite-navy world, one orange accent. Dark is the default
world; light exists as a full parallel set where action deepens to #E85F00.

## Composition rules

- **Accent budget** — `#FF6B00` on **at most one element per scene**. Not a
  heading colour, not a border, not a decoration. In this video: scene 1 may
  spend it on the single hero word, scene 2 spends it on the novuspitch.com
  lockup / fin only.
- Ground is graphite-navy (n0/n1), never saturated blue, never pure black.
- Text ladder: n10 primary · n8 secondary; emphasis n11.
- Display type is Urbanist 700–900; chrome/labels are IBM Plex Mono uppercase.
- The CTA world flips to light: pure white ground, near-black #0A0A0A ink,
  action orange #E85F00 on the one CTA element.
- No gradients except a single radial stage vignette over solid n0.
- Depth from shadow and lighting, not blur or glass.
