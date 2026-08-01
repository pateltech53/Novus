import UIKit

/**
 The material, and nothing else.

 Every glass surface in this app comes out of this file, so there is exactly
 one place that decides what "glass" means. On iOS 26 that is `UIGlassEffect`
 — the system's own Liquid Glass, with its real refraction, its specular edge
 and its interactive deformation under a finger. It is not approximated here
 and it must never be: a hand-rolled blur-plus-gradient is recognisably not
 the system material the moment it sits next to one.

 Before iOS 26 there is no Liquid Glass to ask for, so these fall back to the
 closest real material Apple ships (`.systemThinMaterial`). That is still a
 native vibrancy effect, still composited by the OS, and still not an
 imitation — it is simply the older material.

 `#if compiler(>=6.2)` guards the iOS 26 symbols so the project still compiles
 on an Xcode that predates the SDK they live in. `#available` then guards the
 runtime. Both are needed; neither is sufficient alone.
 */
enum GlassKit {

    // ── Brand ────────────────────────────────────────────────────────────────
    // Locked by Brand Identity v2, and the same values lib/brand.ts carries for
    // the consumers on the web side that cannot read a CSS custom property.

    /// The only colour that asks you to do something.
    static let action = UIColor(red: 1.00, green: 0.42, blue: 0.00, alpha: 1)
    /// IPO gold: the year gate, stage-ups and badges. Rare by design.
    static let prestige = UIColor(red: 1.00, green: 0.76, blue: 0.29, alpha: 1)
    /// Ink for text sitting on prestige gold.
    static let onPrestige = UIColor(red: 0.22, green: 0.16, blue: 0.05, alpha: 1)

    /// True where the real material exists. Drives the `liquidGlass` flag the
    /// web side reports, so a bug report can say which material was on screen.
    static var hasLiquidGlass: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    /**
     A glass panel.

     - Parameters:
        - corner: corner radius in points. Pass half the height for a capsule.
        - interactive: whether the material deforms under a finger. True for
          anything tappable, false for a passive backdrop — an interactive
          effect on a surface nobody touches is a wasted compositor pass.
        - tint: colours the glass itself rather than painting over it, which is
          what makes a tinted glass button read as glass and not as a coloured
          rectangle with a blur behind it.
     */
    static func panel(corner: CGFloat, interactive: Bool = false, tint: UIColor? = nil)
        -> UIVisualEffectView
    {
        let view: UIVisualEffectView

        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect()
            effect.isInteractive = interactive
            if let tint { effect.tintColor = tint }
            view = UIVisualEffectView(effect: effect)
        } else {
            view = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))
            if let tint { view.contentView.backgroundColor = tint.withAlphaComponent(0.9) }
        }
        #else
        view = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))
        if let tint { view.contentView.backgroundColor = tint.withAlphaComponent(0.9) }
        #endif

        // Masking rather than `cornerConfiguration`: clipping a visual effect
        // view is supported on every version this app runs on, and the shape
        // is identical. One less API that has to exist for the build to work.
        view.layer.cornerRadius = corner
        view.layer.cornerCurve = .continuous
        view.clipsToBounds = true
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }
}

/**
 A container that is invisible to touches.

 The chrome is a full-screen layer sitting over the webview, so every point of
 it that is not a control has to let the touch through — otherwise the top half
 of the game stops responding and the cause is a transparent view nobody can
 see. Returning nil for a hit on the container itself is the whole trick.
 */
final class PassthroughView: UIView {
    var onLayout: (() -> Void)?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }
}

/// The same rule for a stack: the gaps between the meter, the button and the
/// caption belong to the web layer underneath, not to the stack view.
final class PassthroughStackView: UIStackView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}
