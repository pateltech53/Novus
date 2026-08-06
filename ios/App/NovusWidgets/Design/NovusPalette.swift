import SwiftUI
// Explicitly, not via SwiftUI: `UIColor(dynamicProvider:)` is the only thing
// that resolves light and dark correctly inside a widget snapshot, and SwiftUI
// re-exporting UIKit is not something to rely on.
import UIKit

/**
 The brand, for a process that cannot read a CSS custom property.

 Same job `lib/brand.ts` does for three.js and Next's viewport metadata, and
 the same rule: this file exists so the handful of consumers outside the
 cascade can reference a NAME instead of retyping a hex. Do not add to it to
 dodge that rule — there is nothing in this extension that can read
 `globals.css`, so everything drawn here goes through a token below.

 ── Where the numbers come from ──────────────────────────────────────────────

 Every value is one of the tokens in `app/globals.css`, converted from OKLCH to
 sRGB once. The token name is written beside each one, so a change to the
 palette has an obvious landing site here rather than a hunt.

 A note for anyone holding a widget next to the app: the dark ground below is
 `--n-1` (#101214), which is what the app's screens actually paint. It is NOT
 `THEME_COLOR_DARK` (#1c1d21) — that value is the browser chrome and the
 shell's pre-paint background, one step lighter, and it has always been the
 odd one out. The widget follows what a player looks at.

 ── Light and dark ───────────────────────────────────────────────────────────

 Widgets get no say in which one they are drawn in — the system decides, per
 device, and StandBy has a third mode of its own. So every colour here is
 declared for both and resolved by `UIColor(dynamicProvider:)`, which is the
 only mechanism that answers correctly inside a widget snapshot. `@Environment
 (\.colorScheme)` also works and would have to be threaded through every view
 that draws anything, which is how one of them ends up hardcoded.
 */
enum Nv {

    // ── The neutral ramp ────────────────────────────────────────────────────

    /// `--n-1` — the app background. What a widget is a piece of.
    static let bg = dynamic(dark: 0x10_12_14, light: 0xED_EB_E6)
    /// `--n-2` — a raised surface.
    static let surface = dynamic(dark: 0x18_19_1C, light: 0xF5_F3_F0)
    /// `--n-3` — a card. The ground a figure is read on.
    static let card = dynamic(dark: 0x21_23_25, light: 0xFF_FF_FF)
    /// `--n-4` — a card, elevated.
    static let elevated = dynamic(dark: 0x2C_2E_30, light: 0xFC_FC_FA)
    /// `--n-5` — the hairline. Also the empty half of every gauge here.
    static let hairline = dynamic(dark: 0x3C_3D_40, light: 0xDA_D9_D5)

    /// `--text-tertiary` (`--n-7`) — labels, units, the small print.
    static let tertiary = dynamic(dark: 0x79_7A_7D, light: 0x82_80_7B)
    /// `--text-secondary` (`--n-8`).
    static let secondary = dynamic(dark: 0x9D_9E_A0, light: 0x5F_5C_56)
    /// `--text-primary` (`--n-10`) — every figure.
    static let primary = dynamic(dark: 0xE5_E6_E7, light: 0x23_20_19)

    // ── The four that mean something ────────────────────────────────────────

    /**
     `--action` — the ONLY colour that asks you to do something.

     Two values, and that is a legibility floor rather than a taste call:
     #FF6B00 does not hold AA on a light ground, so the light theme darkens it.
     Brand Identity v2 locks both.
     */
    static let action = dynamic(dark: 0xFF_6B_00, light: 0xE3_5F_00)

    /// `--solvency` — financial upside ONLY. Never a call to action.
    static let solvency = dynamic(dark: 0x00_D1_8F, light: 0x00_80_4F)

    /// `--alert` — financial damage, and a runway about to run out.
    static let alert = dynamic(dark: 0xFF_52_51, light: 0xC2_17_25)

    /**
     `--color-prestige` — the year gate, stage-ups and badges. Rare by design.

     One value for both themes, because it is the same gold in both. `onPrestige`
     is the ink that sits on it: near-black, because gold is a light colour and
     white on it fails at any size worth reading.
     */
    static let prestige = Color(hex: 0xFF_C2_4B)
    static let onPrestige = Color(hex: 0x2A_1C_07)

    /// `--color-navy` — the brand anchor. Onboarding, the camera, the panel.
    static let navy = Color(hex: 0x0B_1E_36)

    // ── The archipelago ─────────────────────────────────────────────────────

    /// `--sea` / `--sea-crest`, for the Still Standing widget's ground.
    static let sea = dynamic(dark: 0x06_17_27, light: 0xBE_E7_FD)
    static let seaCrest = dynamic(dark: 0x53_6C_84, light: 0xF5_FF_FF)

    // ── Tones ───────────────────────────────────────────────────────────────

    /**
     The colour of a change.

     `OutsideTone` arrives already resolved for the direction that is GOOD —
     see `lib/outside/snapshot.ts` — so this never has to know that a rising
     burn is bad news and a rising cash figure is not.

     `flat` is deliberately not green. A change of zero is not upside.
     */
    static func tone(_ tone: OutsideTone?) -> Color {
        switch tone {
        case .up: return solvency
        case .down: return alert
        case .flat, .none: return tertiary
        }
    }

    // ── Plumbing ────────────────────────────────────────────────────────────

    private static func dynamic(dark: Int, light: Int) -> Color {
        Color(
            UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor(rgb: dark) : UIColor(rgb: light)
            })
    }
}

extension Color {
    fileprivate init(hex: Int) { self.init(UIColor(rgb: hex)) }
}

extension UIColor {
    fileprivate convenience init(rgb: Int) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1)
    }
}

// ── Type ────────────────────────────────────────────────────────────────────

/**
 The app's two typographic voices, in the faces a widget actually has.

 Novus sets its UI in Urbanist and its figures in IBM Plex Mono, and neither is
 in this bundle: both come from `next/font/google`, which self-hosts them into
 the web build as WOFF2 — a format iOS cannot load and a licence that would
 need re-checking to ship as a TTF in a binary. Embedding them is possible and
 is a deliberate later decision, not an oversight; see docs/WIDGETS.md.

 What is here instead is the same DISTINCTION drawn in the system face, which
 is what the platform expects a widget to be set in anyway:

 · `label` — SF, the UI voice.
 · `figure` — SF Mono, the ledger voice. Every number in this game is read in
   a fixed-width face, and the reason is not decoration: The Books is a column
   of figures that changes every month, and proportional digits make the
   column jitter as the values move.
 */
enum NvType {
    static func label(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight)
    }

    /// A figure. Monospaced by design; see above.
    static func figure(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}
