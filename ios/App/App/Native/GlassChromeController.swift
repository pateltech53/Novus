import UIKit

// ── What the web layer asks for ──────────────────────────────────────────────

struct ChromeTab {
    let id: String
    let title: String
    let symbol: String
}

struct ChromeControl {
    let id: String
    let symbol: String?
    let text: String?
    let label: String
    let style: String
    let leading: Bool
}

struct ChromeCta {
    let title: String
    let caption: String
    let progress: Int
    let total: Int
    /// "action" for the orange month button, "prestige" for the gold year gate.
    let style: String
    let enabled: Bool
    let locked: Bool
}

struct ChromeState {
    let mode: String  // "full" | "hidden"
    let theme: String  // "light" | "dark"
    let tabs: [ChromeTab]
    let activeTab: String?
    let cta: ChromeCta?
    let controls: [ChromeControl]
}

/// Reserved space, in points, that the web layout must leave empty. One point
/// is one CSS pixel in this webview, so these cross the bridge unconverted.
struct ChromeInsets {
    var top: CGFloat = 0
    var bottom: CGFloat = 0
    var tabBar: CGFloat = 0
}

/**
 The native chrome.

 Three surfaces, all real UIKit, all composited by the OS over the webview:

   · a system `UITabBar` at the bottom, which on iOS 26 is Liquid Glass with no
     configuration at all — the system's own tab bar is not something worth
     re-implementing, and any re-implementation would be visibly not it
   · a tinted `UIGlassEffect` capsule carrying the one control that moves time,
     with the year meter above it and its caption below
   · a cluster of circular glass controls floating over the masthead

 Two rules hold the whole thing together.

 **Nothing is ever occluded.** The web layer is never told a height; it is told
 the height that was measured after layout ran. If a tab bar comes out 4pt
 taller on some device than any constant would have predicted, the content
 above it moves by 4pt and nothing is hidden. Guessing is what puts a menu bar
 on top of a button.

 **Anything that overlays the game hides all of it.** Every sheet and screen in
 this app is a full-screen web overlay, and a native view always draws above
 the webview — so the moment one opens, the chrome goes away. There is no
 arrangement in which a native tab bar sits on top of a modal.
 */
final class GlassChromeController: NSObject, UITabBarDelegate {

    // ── Callbacks ────────────────────────────────────────────────────────────

    var onTab: ((String) -> Void)?
    var onPrimary: (() -> Void)?
    var onControl: ((String) -> Void)?
    var onInsetsChanged: ((ChromeInsets) -> Void)?

    // ── Views ────────────────────────────────────────────────────────────────

    private let host = PassthroughView()
    private let tabBar = UITabBar()
    private let deck = PassthroughStackView()
    private let meter = PassthroughStackView()
    private let caption = UILabel()
    private var ctaGlass: UIVisualEffectView?
    private let ctaButton = UIButton(type: .system)
    private let leadingControls = PassthroughStackView()
    private let trailingControls = PassthroughStackView()

    private var meterTicks: [UIView] = []
    private var tabIds: [String] = []
    private var controlIds: [Int: String] = [:]
    private var installed = false
    private var lastInsets = ChromeInsets()
    private var currentState: ChromeState?

    private let tapFeedback = UIImpactFeedbackGenerator(style: .light)

    // ── Metrics ──────────────────────────────────────────────────────────────
    // Named because they are referenced from more than one constraint, not
    // because they are tuning knobs. The measured insets are what the layout
    // actually reserves; these only decide where things sit inside that.

    private enum Metric {
        static let sideMargin: CGFloat = 16
        static let controlSize: CGFloat = 36
        static let controlInset: CGFloat = 20
        static let controlTop: CGFloat = 8
        static let ctaHeight: CGFloat = 56
        static let deckSpacing: CGFloat = 10
        static let deckBottomGap: CGFloat = 10
        static let meterHeight: CGFloat = 3
    }

    // ── Install ──────────────────────────────────────────────────────────────

    /// Idempotent: the plugin's `configure` can be called on every launch of
    /// the web layer, including a live reload, and must not stack two decks.
    @discardableResult
    func install(in parent: UIView) -> ChromeInsets {
        guard !installed else { return measure() }
        installed = true

        host.translatesAutoresizingMaskIntoConstraints = false
        host.backgroundColor = .clear
        host.isUserInteractionEnabled = true
        parent.addSubview(host)
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
            host.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
            host.topAnchor.constraint(equalTo: parent.topAnchor),
            host.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
        ])

        buildTabBar()
        buildDeck()
        buildControls()

        host.onLayout = { [weak self] in
            guard let self else { return }
            // Same rule as apply(): a hidden deck measures zero, and zero is
            // not news. Rotation and safe-area changes while a sheet is open
            // are re-measured when it closes.
            guard self.currentState?.mode == "full" else { return }
            let next = self.measure()
            guard
                abs(next.top - self.lastInsets.top) > 0.5
                    || abs(next.bottom - self.lastInsets.bottom) > 0.5
                    || abs(next.tabBar - self.lastInsets.tabBar) > 0.5
            else { return }
            self.lastInsets = next
            self.onInsetsChanged?(next)
        }

        setHidden(true)
        host.layoutIfNeeded()
        return measure()
    }

    private func buildTabBar() {
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        // Deliberately no custom appearance. On iOS 26 the default background
        // for a tab bar IS Liquid Glass; replacing it with a hand-built one is
        // how an app ends up with a bar that does not match the system's.
        tabBar.tintColor = .label
        tabBar.unselectedItemTintColor = .tertiaryLabel
        tabBar.isHidden = true
        host.addSubview(tabBar)
        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])
    }

    private func buildDeck() {
        meter.axis = .horizontal
        meter.distribution = .fillEqually
        meter.spacing = 3
        meter.translatesAutoresizingMaskIntoConstraints = false
        meter.heightAnchor.constraint(equalToConstant: Metric.meterHeight).isActive = true

        let glass = GlassKit.panel(corner: Metric.ctaHeight / 2, interactive: true, tint: GlassKit.action)
        ctaGlass = glass
        glass.heightAnchor.constraint(equalToConstant: Metric.ctaHeight).isActive = true

        ctaButton.translatesAutoresizingMaskIntoConstraints = false
        ctaButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .heavy)
        ctaButton.titleLabel?.adjustsFontSizeToFitWidth = true
        ctaButton.titleLabel?.minimumScaleFactor = 0.75
        ctaButton.titleLabel?.lineBreakMode = .byClipping
        ctaButton.setTitleColor(.white, for: .normal)
        ctaButton.backgroundColor = .clear
        ctaButton.addTarget(self, action: #selector(primaryTapped), for: .touchUpInside)
        ctaButton.addTarget(self, action: #selector(pressDown), for: .touchDown)
        ctaButton.addTarget(
            self, action: #selector(pressUp),
            for: [.touchUpInside, .touchUpOutside, .touchCancel])
        glass.contentView.addSubview(ctaButton)
        NSLayoutConstraint.activate([
            ctaButton.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor),
            ctaButton.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor),
            ctaButton.topAnchor.constraint(equalTo: glass.contentView.topAnchor),
            ctaButton.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor),
        ])

        caption.translatesAutoresizingMaskIntoConstraints = false
        caption.font = .systemFont(ofSize: 12, weight: .semibold)
        caption.textColor = .tertiaryLabel
        caption.textAlignment = .center
        caption.adjustsFontSizeToFitWidth = true
        caption.minimumScaleFactor = 0.85

        deck.axis = .vertical
        deck.alignment = .fill
        deck.spacing = Metric.deckSpacing
        deck.translatesAutoresizingMaskIntoConstraints = false
        deck.isHidden = true
        deck.addArrangedSubview(meter)
        deck.addArrangedSubview(glass)
        deck.addArrangedSubview(caption)
        // The caption sits closer to its button than the button does to the
        // meter: it is a label for the button, not a third element in a list.
        deck.setCustomSpacing(6, after: glass)

        host.addSubview(deck)
        NSLayoutConstraint.activate([
            deck.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: Metric.sideMargin),
            deck.trailingAnchor.constraint(
                equalTo: host.trailingAnchor, constant: -Metric.sideMargin),
            deck.bottomAnchor.constraint(
                equalTo: tabBar.topAnchor, constant: -Metric.deckBottomGap),
        ])
    }

    private func buildControls() {
        for (stack, leading) in [(leadingControls, true), (trailingControls, false)] {
            stack.axis = .horizontal
            stack.spacing = 8
            stack.alignment = .center
            stack.translatesAutoresizingMaskIntoConstraints = false
            stack.isHidden = true
            host.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.topAnchor.constraint(
                    equalTo: host.safeAreaLayoutGuide.topAnchor, constant: Metric.controlTop),
                leading
                    ? stack.leadingAnchor.constraint(
                        equalTo: host.leadingAnchor, constant: Metric.controlInset)
                    : stack.trailingAnchor.constraint(
                        equalTo: host.trailingAnchor, constant: -Metric.controlInset),
            ])
        }
    }

    // ── Apply ────────────────────────────────────────────────────────────────

    @discardableResult
    func apply(_ state: ChromeState) -> ChromeInsets {
        currentState = state

        // The web app's theme is its own, independent of the phone's. Forcing
        // the style here is what makes the system materials render against the
        // right ground: a dark game under a light-mode phone would otherwise
        // get a light tab bar bolted to the bottom of it.
        host.overrideUserInterfaceStyle = state.theme == "dark" ? .dark : .light

        applyTabs(state.tabs, active: state.activeTab)
        applyCta(state.cta)
        applyControls(state.controls)

        setHidden(state.mode != "full")
        host.layoutIfNeeded()

        /*
         * Hiding the chrome must not collapse what it reserved.
         *
         * Every "hidden" is a web sheet opening over the play screen, and the
         * play screen is still mounted underneath. Reporting zero would reflow
         * it behind the sheet and reflow it back on dismiss — a jump the
         * player sees at exactly the moment the sheet gets out of the way.
         * The reservation describes the chrome's footprint, not its visibility.
         */
        if state.mode == "full" {
            lastInsets = measure()
        }
        return lastInsets
    }

    private func setHidden(_ hidden: Bool) {
        tabBar.isHidden = hidden || tabBar.items?.isEmpty != false
        deck.isHidden = hidden || currentState?.cta == nil
        leadingControls.isHidden = hidden || leadingControls.arrangedSubviews.isEmpty
        trailingControls.isHidden = hidden || trailingControls.arrangedSubviews.isEmpty
    }

    private func applyTabs(_ tabs: [ChromeTab], active: String?) {
        let ids = tabs.map(\.id)
        if ids != tabIds {
            tabIds = ids
            tabBar.items = tabs.enumerated().map { index, tab in
                let item = UITabBarItem(
                    title: tab.title,
                    image: UIImage(systemName: tab.symbol),
                    tag: index)
                item.accessibilityLabel = tab.title
                return item
            }
        }
        if let active, let index = tabIds.firstIndex(of: active) {
            tabBar.selectedItem = tabBar.items?[index]
        } else {
            tabBar.selectedItem = nil
        }
    }

    private func applyCta(_ cta: ChromeCta?) {
        guard let cta else { return }

        let prestige = cta.style == "prestige"
        let tint = prestige ? GlassKit.prestige : GlassKit.action
        let ink: UIColor = prestige ? GlassKit.onPrestige : .white

        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect()
            effect.isInteractive = true
            effect.tintColor = cta.enabled ? tint : tint.withAlphaComponent(0.45)
            ctaGlass?.effect = effect
        } else {
            ctaGlass?.contentView.backgroundColor = tint.withAlphaComponent(cta.enabled ? 0.92 : 0.45)
        }
        #else
        ctaGlass?.contentView.backgroundColor = tint.withAlphaComponent(cta.enabled ? 0.92 : 0.45)
        #endif

        let title = cta.locked ? "\u{1F512}  \(cta.title)" : cta.title
        ctaButton.setAttributedTitle(
            NSAttributedString(
                string: title,
                attributes: [
                    .font: UIFont.systemFont(ofSize: 17, weight: .heavy),
                    .foregroundColor: cta.enabled ? ink : ink.withAlphaComponent(0.6),
                    .kern: 0.7,
                ]),
            for: .normal)
        ctaButton.isEnabled = cta.enabled
        ctaButton.accessibilityLabel = cta.title

        caption.attributedText = NSAttributedString(
            string: cta.caption,
            attributes: [
                .font: UIFont.systemFont(ofSize: 12, weight: .semibold),
                .foregroundColor: UIColor.tertiaryLabel,
                .kern: 1.3,
            ])

        applyMeter(progress: cta.progress, total: cta.total, atGate: prestige)
    }

    private func applyMeter(progress: Int, total: Int, atGate: Bool) {
        if meterTicks.count != total {
            meterTicks.forEach { $0.removeFromSuperview() }
            meterTicks = (0..<max(total, 0)).map { _ in
                let tick = UIView()
                tick.layer.cornerRadius = Metric.meterHeight / 2
                tick.translatesAutoresizingMaskIntoConstraints = false
                meter.addArrangedSubview(tick)
                return tick
            }
        }
        for (index, tick) in meterTicks.enumerated() {
            let isGate = index == total - 1
            if isGate {
                tick.backgroundColor =
                    atGate ? GlassKit.prestige : GlassKit.prestige.withAlphaComponent(0.35)
            } else {
                tick.backgroundColor = index < progress ? .secondaryLabel : .quaternaryLabel
            }
        }
    }

    private func applyControls(_ controls: [ChromeControl]) {
        leadingControls.arrangedSubviews.forEach { $0.removeFromSuperview() }
        trailingControls.arrangedSubviews.forEach { $0.removeFromSuperview() }
        controlIds.removeAll()

        for (index, control) in controls.enumerated() {
            let view = makeControl(control, tag: index)
            controlIds[index] = control.id
            (control.leading ? leadingControls : trailingControls).addArrangedSubview(view)
        }
    }

    /**
     One floating glass control.

     The content is a plain label or image view and the tap target is a
     borderless button laid over the whole capsule. Putting the text in the
     button's own title would mean reaching for `contentEdgeInsets` to pad it,
     which UIKit deprecated in iOS 15 and which fights any button
     configuration — a label with constraints says the same thing and will
     still compile in five years.
     */
    private func makeControl(_ control: ChromeControl, tag: Int) -> UIView {
        let isBadge = control.text != nil
        let height = Metric.controlSize
        let ink: UIColor = control.style == "prestige" ? GlassKit.onPrestige : .label
        let glass = GlassKit.panel(
            corner: height / 2,
            interactive: true,
            tint: control.style == "prestige" ? GlassKit.prestige : nil)

        let content: UIView
        var hPadding: CGFloat = 0

        if let text = control.text {
            let label = UILabel()
            label.attributedText = NSAttributedString(
                string: text,
                attributes: [
                    .font: UIFont.systemFont(ofSize: 12, weight: .bold),
                    .foregroundColor: ink,
                    .kern: 1.4,
                ])
            content = label
            hPadding = 12
        } else if let symbol = control.symbol, let image = UIImage(systemName: symbol) {
            let view = UIImageView(image: image)
            view.tintColor = ink
            view.contentMode = .scaleAspectFit
            content = view
        } else {
            // A symbol name the OS does not know must never leave an empty
            // circle the player cannot identify.
            let label = UILabel()
            label.text = String(control.label.prefix(1)).uppercased()
            label.font = .systemFont(ofSize: 15, weight: .bold)
            label.textColor = ink
            content = label
        }

        content.translatesAutoresizingMaskIntoConstraints = false
        glass.contentView.addSubview(content)

        let button = UIButton(type: .custom)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.tag = tag
        button.backgroundColor = .clear
        button.isAccessibilityElement = true
        button.accessibilityLabel = control.label
        button.addTarget(self, action: #selector(controlTapped(_:)), for: .touchUpInside)
        glass.contentView.addSubview(button)

        NSLayoutConstraint.activate([
            content.centerXAnchor.constraint(equalTo: glass.contentView.centerXAnchor),
            content.centerYAnchor.constraint(equalTo: glass.contentView.centerYAnchor),
            content.leadingAnchor.constraint(
                equalTo: glass.contentView.leadingAnchor, constant: hPadding),
            button.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor),
            button.topAnchor.constraint(equalTo: glass.contentView.topAnchor),
            button.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor),
            glass.heightAnchor.constraint(equalToConstant: height),
            glass.widthAnchor.constraint(greaterThanOrEqualToConstant: height),
        ])
        if !isBadge {
            glass.widthAnchor.constraint(equalToConstant: height).isActive = true
        }
        return glass
    }

    // ── Measurement ──────────────────────────────────────────────────────────

    /**
     What the web layer must leave empty, read off the laid-out frames.

     Everything here is measured rather than assumed. `top` runs from the top
     of the page to the bottom of the control cluster; `bottom` from the top of
     the deck to the bottom of the screen, safe area included.
     */
    private func measure() -> ChromeInsets {
        var insets = ChromeInsets()
        let height = host.bounds.height
        guard height > 0 else { return insets }

        if !leadingControls.isHidden || !trailingControls.isHidden {
            let controlsBottom = max(
                leadingControls.isHidden ? 0 : leadingControls.frame.maxY,
                trailingControls.isHidden ? 0 : trailingControls.frame.maxY)
            insets.top = controlsBottom + Metric.controlTop
        }

        if !tabBar.isHidden, tabBar.frame.height > 0 {
            insets.tabBar = height - tabBar.frame.minY
        }

        if !deck.isHidden, deck.frame.height > 0 {
            insets.bottom = height - deck.frame.minY + Metric.deckBottomGap
        } else {
            insets.bottom = insets.tabBar
        }

        return insets
    }

    // ── Toast ────────────────────────────────────────────────────────────────

    func toast(text: String, tone: String) {
        let glass = GlassKit.panel(corner: 22, interactive: false, tint: nil)
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = text
        label.font = .systemFont(ofSize: 14, weight: .semibold)
        label.textColor = tone == "bad" ? .systemRed : .label
        label.numberOfLines = 2
        label.textAlignment = .center
        glass.contentView.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor, constant: 18),
            label.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor, constant: -18),
            label.topAnchor.constraint(equalTo: glass.contentView.topAnchor, constant: 11),
            label.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor, constant: -11),
        ])

        glass.alpha = 0
        glass.isUserInteractionEnabled = false
        host.addSubview(glass)
        NSLayoutConstraint.activate([
            glass.centerXAnchor.constraint(equalTo: host.centerXAnchor),
            glass.topAnchor.constraint(equalTo: host.safeAreaLayoutGuide.topAnchor, constant: 56),
            glass.leadingAnchor.constraint(
                greaterThanOrEqualTo: host.leadingAnchor, constant: Metric.sideMargin),
        ])
        host.layoutIfNeeded()
        glass.transform = CGAffineTransform(translationX: 0, y: -12)

        UIView.animate(withDuration: 0.28, delay: 0, options: [.curveEaseOut]) {
            glass.alpha = 1
            glass.transform = .identity
        } completion: { _ in
            UIView.animate(withDuration: 0.18, delay: 2.2, options: [.curveEaseIn]) {
                glass.alpha = 0
                glass.transform = CGAffineTransform(translationX: 0, y: -12)
            } completion: { _ in
                glass.removeFromSuperview()
            }
        }
    }

    // ── Input ────────────────────────────────────────────────────────────────

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard item.tag >= 0, item.tag < tabIds.count else { return }
        tapFeedback.impactOccurred()
        onTab?(tabIds[item.tag])
    }

    @objc private func primaryTapped() {
        onPrimary?()
    }

    @objc private func controlTapped(_ sender: UIButton) {
        guard let id = controlIds[sender.tag] else { return }
        tapFeedback.impactOccurred()
        onControl?(id)
    }

    /// The same 0.97 the web build uses on its own buttons, so the two chrome
    /// layers do not feel like they came from different apps.
    @objc private func pressDown() {
        tapFeedback.prepare()
        UIView.animate(withDuration: 0.12, delay: 0, options: [.curveEaseOut, .allowUserInteraction])
        {
            self.ctaGlass?.transform = CGAffineTransform(scaleX: 0.97, y: 0.97)
        }
    }

    @objc private func pressUp() {
        UIView.animate(withDuration: 0.16, delay: 0, options: [.curveEaseOut, .allowUserInteraction])
        {
            self.ctaGlass?.transform = .identity
        }
    }
}
