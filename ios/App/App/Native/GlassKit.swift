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

    /**
     A group of glass elements that behave as one.

     iOS 26's container effect is what makes neighbouring glass merge and
     separate as they move, instead of reading as several unrelated panes
     sitting near each other. Only worth it where there is genuinely more than
     one — a container around a single control is a wasted compositing pass.

     Returns nil before iOS 26, where the caller should just add the elements
     directly and get the older material.
     */
    static func container(spacing: CGFloat) -> UIVisualEffectView? {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let effect = UIGlassContainerEffect()
            effect.spacing = spacing
            let view = UIVisualEffectView(effect: effect)
            view.translatesAutoresizingMaskIntoConstraints = false
            return view
        }
        #endif
        return nil
    }

    /**
     A glass button, made the way Apple makes one.

     `UIButton.Configuration.glass()` and `.prominentGlass()` are iOS 26's own
     Liquid Glass button configurations — the real material, with the real
     specular edge, the real interactive deformation, and the system's own
     metrics for how much padding a capsule of a given size wants. Reaching for
     them rather than putting a plain button on top of a `panel()` matters for
     one reason beyond fidelity: the system knows how a glass button behaves
     when it is next to another one, when it is disabled, and when the phone is
     in an accessibility contrast mode, and every one of those is a behaviour
     that would otherwise have to be reimplemented and would be reimplemented
     slightly wrong.

     Before iOS 26 the configurations do not exist, so it falls back to the
     same thing every other surface here falls back to: a real
     `.systemThinMaterial` view with a plain button over it. Older material,
     never a hand-rolled one.

     - Parameters:
        - prominent: the filled, tinted variant — a screen's one call to
          action. Plain glass for everything else, because a screen with three
          prominent buttons on it has no call to action at all.
     */
    static func button(prominent: Bool, tint: UIColor?, ink: UIColor?) -> GlassControl {
        GlassControl(prominent: prominent, tint: tint, ink: ink)
    }

    /**
     A full-bleed backdrop.

     Deliberately NOT `UIGlassEffect`. Liquid Glass is a material for discrete
     controls — Apple's own guidance, and stretching it edge to edge is how you
     get a wash rather than a lens. A modal scrim is the one glass surface in
     design.md that is measured in screens rather than in points, and
     `.systemThinMaterial` is what the system itself puts behind a sheet.

     What it blurs is the webview: the game frosts over behind whatever just
     opened, composited by the OS rather than by `backdrop-filter`.
     */
    static func backdrop() -> UIVisualEffectView {
        let view = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }
}

/**
 One glass button, on both sides of iOS 26.

 A view rather than a `UIButton` because the two paths are genuinely different
 shapes: on iOS 26 the button IS the glass and there is nothing behind it; on
 anything older the material is a `UIVisualEffectView` and the button is a
 transparent tap target laid over it. Wrapping both in one type is what lets
 every caller write the same four lines and never branch on the OS again.

 The press is animated here rather than left to the configuration, so a
 pre-26 button and an iOS 26 one respond to a finger identically — and so the
 whole app presses on the same 0.96 the web build uses on its own controls.
 */
final class GlassControl: UIView {

    let button = UIButton(type: .system)
    /// The material, on the fallback path only. nil on iOS 26, where the
    /// button is the material.
    private var backing: UIVisualEffectView?
    private let prominent: Bool
    private var tint: UIColor?
    private var ink: UIColor?

    /// What a tap means. Set by the caller; the id is what crosses the bridge.
    var onTap: (() -> Void)?

    /// Per-control rather than shared. A generator is not `Sendable`, and a
    /// static one is a concurrency diagnostic waiting for the day this target
    /// moves to Swift 6 — for a saving of a few bytes on a view that already
    /// owns a compositing pass.
    private let feedback = UIImpactFeedbackGenerator(style: .light)

    init(prominent: Bool, tint: UIColor?, ink: UIColor?) {
        self.prominent = prominent
        self.tint = tint
        self.ink = ink
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false

        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            var config = prominent
                ? UIButton.Configuration.prominentGlass()
                : UIButton.Configuration.glass()
            config.cornerStyle = .capsule
            if let tint { config.baseBackgroundColor = tint }
            if let ink { config.baseForegroundColor = ink }
            button.configuration = config
        } else {
            installBacking()
        }
        #else
        installBacking()
        #endif

        button.translatesAutoresizingMaskIntoConstraints = false
        addSubview(button)
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: leadingAnchor),
            button.trailingAnchor.constraint(equalTo: trailingAnchor),
            button.topAnchor.constraint(equalTo: topAnchor),
            button.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        button.addTarget(self, action: #selector(tapped), for: .touchUpInside)
        button.addTarget(self, action: #selector(pressDown), for: .touchDown)
        button.addTarget(
            self, action: #selector(pressUp),
            for: [.touchUpInside, .touchUpOutside, .touchCancel])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// The pre-26 path: a real material with a transparent button over it.
    private func installBacking() {
        let view = GlassKit.panel(corner: 0, interactive: true, tint: prominent ? tint : nil)
        backing = view
        addSubview(view)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: leadingAnchor),
            view.trailingAnchor.constraint(equalTo: trailingAnchor),
            view.topAnchor.constraint(equalTo: topAnchor),
            view.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        var config = UIButton.Configuration.plain()
        config.baseForegroundColor = ink ?? .label
        button.configuration = config
    }

    /// Capsule on the fallback path, where the corner is this view's own
    /// rather than the configuration's. A no-op on iOS 26.
    override func layoutSubviews() {
        super.layoutSubviews()
        backing?.layer.cornerRadius = bounds.height / 2
    }

    // ── Content ──────────────────────────────────────────────────────────────

    /**
     What the button says and shows.

     Titles go through `AttributedString` so the app's own weight and tracking
     survive — a configuration's plain `title` picks up the system body font,
     which is not the font any other control in this app is set in.
     */
    func set(title: String?, symbol: String?, size: CGFloat, weight: UIFont.Weight) {
        var config = button.configuration ?? UIButton.Configuration.plain()

        if let title, !title.isEmpty {
            var text = AttributedString(title)
            text.font = .systemFont(ofSize: size, weight: weight)
            text.kern = 0.4
            config.attributedTitle = text
        } else {
            config.attributedTitle = nil
        }

        if let symbol, !symbol.isEmpty {
            config.image = UIImage(
                systemName: symbol,
                // Stated rather than inherited: an image configuration that
                // follows the body text style comes out wider than the circle
                // holding it at a large accessibility size.
                withConfiguration: UIImage.SymbolConfiguration(
                    pointSize: size, weight: .semibold))
            config.imagePadding = (title?.isEmpty == false) ? 6 : 0
        } else {
            config.image = nil
        }

        button.configuration = config
    }

    /**
     Lights or dims this control in place.

     For a segmented control, where the selected piece is prominent glass
     inside a dimmer track and the selection changes under a finger. Swapping
     the configuration keeps the same view — and keeping the same view is the
     point: rebuilding the row on every tap destroys the control the player is
     still touching, halfway through its own press animation.

     A no-op on the pre-26 path, where there is no prominent variant to swap
     to and the backing material is the same either way; the ink still changes,
     which is what carries the state there.
     */
    func setProminent(_ on: Bool, ink: UIColor?) {
        self.ink = ink

        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            var next = on
                ? UIButton.Configuration.prominentGlass()
                : UIButton.Configuration.glass()
            next.cornerStyle = .capsule
            if let tint { next.baseBackgroundColor = tint }
            if let ink { next.baseForegroundColor = ink }
            // Carried over rather than re-derived: the caller set these once,
            // and a configuration swap that dropped the title would blank the
            // segment it was meant to light.
            next.attributedTitle = button.configuration?.attributedTitle
            next.image = button.configuration?.image
            next.imagePadding = button.configuration?.imagePadding ?? 0
            button.configuration = next
            return
        }
        #endif

        var next = button.configuration ?? UIButton.Configuration.plain()
        next.baseForegroundColor = ink ?? .label
        button.configuration = next
    }

    func setEnabled(_ enabled: Bool) {
        button.isEnabled = enabled
        alpha = enabled ? 1 : 0.45
    }

    func setAccessibility(_ label: String) {
        button.accessibilityLabel = label
    }

    // ── Input ────────────────────────────────────────────────────────────────

    @objc private func tapped() {
        onTap?()
    }

    /// The same 0.96 the CSS control material presses on, so a native screen
    /// and a web one do not feel like they came from different apps.
    @objc private func pressDown() {
        feedback.prepare()
        UIView.animate(withDuration: 0.12, delay: 0, options: [.curveEaseOut, .allowUserInteraction])
        {
            self.transform = CGAffineTransform(scaleX: 0.96, y: 0.96)
        }
    }

    @objc private func pressUp() {
        feedback.impactOccurred()
        UIView.animate(withDuration: 0.16, delay: 0, options: [.curveEaseOut, .allowUserInteraction])
        {
            self.transform = .identity
        }
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

/// The same rule for a stack: the gaps between two capsules in a cluster belong
/// to the web layer underneath, not to the stack view.
final class PassthroughStackView: UIStackView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}
