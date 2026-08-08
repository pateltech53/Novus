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
    /**
     The short line on the capsule beside the button — "M4 → M5".

     It replaced a twelve-tick meter above the button and a caption below it.
     Both said the same thing the badge says, in two more elements and two more
     materials, and neither of them was glass.
     */
    let badge: String
    /// What the badge reads as out loud. The web layer owns every string in
    /// this app, including the ones only VoiceOver hears.
    let badgeLabel: String
    /// "action" for the orange month button, "prestige" for the gold year gate.
    let style: String
    let enabled: Bool
    let locked: Bool
}

/**
 The one thing worth doing, floated over the board.

 Nothing on the shelf, nobody employed, or room the team has already paid for
 — computed in the engine (`lib/engine/nudges.ts`), which owns every word of
 it. This is chrome by the same test the term-on-first-use note passes: it
 explains the board rather than being part of it, and it is gone the moment
 the company stops being short of the thing it names.

 It is here rather than in the web layer because of where the web layer's
 bottom is. The play document on a phone is taller than the phone, so anything
 the flow puts after The Books and the log row is off the screen — the card
 spent two revisions being moved around inside a document that had no room for
 it. UIKit has room: it composites over the webview, above the deck, and it is
 real Liquid Glass rather than the solid fallback the CSS material resolves to
 on every platform now.
 */
struct ChromeNudge {
    /// `no-product`, `no-team`, … — the engine's own id. Sent back with every
    /// tap so the web layer knows which nudge was answered, and used here to
    /// tell "the same one, restated" from "a different one has taken its
    /// place": only the second is worth animating in again.
    let id: String
    let title: String
    let body: String
    /// The label on the line that opens the tab — "ADD YOUR FIRST".
    let action: String
}

struct ChromeState {
    let mode: String  // "full" | "hidden" | "coach"
    let theme: String  // "light" | "dark"
    let tabs: [ChromeTab]
    let activeTab: String?
    let cta: ChromeCta?
    let controls: [ChromeControl]
    /// The floating nudge, or nil when the company is not missing anything —
    /// which is most of a healthy run.
    let nudge: ChromeNudge?
    /**
     Which surface the guided first play is teaching right now.

     "advance", "tabs", or a control id — or nil when the step is teaching
     something in the web layer instead. Only read in "coach" mode.
     */
    let coach: String?
}

/// Reserved space, in points, that the web layout must leave empty. One point
/// is one CSS pixel in this webview, so these cross the bridge unconverted.
struct ChromeInsets {
    var top: CGFloat = 0
    var bottom: CGFloat = 0
    var tabBar: CGFloat = 0
    /**
     Where the spotlit control actually is, for the coachmark card to sit
     beside.

     The web layer cannot measure a UIKit view — there is no element to call
     getBoundingClientRect on — so the one thing it needs about it comes back
     with the insets, on the same layout pass and by the same route. nil
     whenever nothing is being spotlit.
     */
    var coach: CGRect?
}

/**
 The native chrome.

 Three surfaces, all real UIKit, all composited by the OS over the webview:

   · a system `UITabBar` at the bottom, which on iOS 26 is Liquid Glass with no
     configuration at all — the system's own tab bar is not something worth
     re-implementing, and any re-implementation would be visibly not it
   · one glass group at the bottom holding two capsules: the tinted control
     that moves time, and beside it the month it is moving from and to
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
    /// The nudge card was tapped: open the tab it names.
    var onNudgeAction: ((String) -> Void)?
    /// Its ✕ was tapped. Distinct from the above because they are opposite
    /// answers to the same card, and a dismiss routed through the action would
    /// open the tab the player just declined.
    var onNudgeDismiss: ((String) -> Void)?

    // ── Views ────────────────────────────────────────────────────────────────

    private let host = PassthroughView()
    private let tabBar = UITabBar()
    private let deck = PassthroughStackView()
    private var ctaGlass: UIVisualEffectView?
    private let ctaButton = UIButton(type: .system)
    private var monthGlass: UIVisualEffectView?
    private let monthLabel = UILabel()
    private let leadingControls = PassthroughStackView()
    private let trailingControls = PassthroughStackView()

    /// The nudge: one glass panel, three labels, and two taps that mean
    /// opposite things. Built once at install and reused, like the deck —
    /// a card rebuilt per push would restart its own entrance every time the
    /// month badge changed.
    private var nudgeGlass: UIVisualEffectView?
    private let nudgeTitleLabel = UILabel()
    private let nudgeBodyLabel = UILabel()
    private let nudgeActionLabel = UILabel()
    private let nudgeTapButton = UIButton(type: .system)
    private let nudgeCloseButton = UIButton(type: .system)

    /// The iOS 26 containers the clusters live in, when the OS has them. Held
    /// because hiding a cluster has to hide its container too — an empty glass
    /// group is a visible smudge over the mascot.
    private var leadingGroup: UIVisualEffectView?
    private var trailingGroup: UIVisualEffectView?
    /// The same, for the two capsules at the bottom. Inside one container the
    /// button and the month badge merge and separate as the button is pressed,
    /// which is what makes them read as one control rather than as two panes
    /// that happen to be adjacent.
    private var deckGroup: UIVisualEffectView?

    private var currentToast: Toast?
    /// What the nudge card is currently showing, or nil when it is not up.
    private var currentNudge: ChromeNudge?
    /// The deck's outermost box — the iOS 26 container when there is one, the
    /// stack itself when there is not. Held because the nudge hangs off its
    /// top edge and must not care which of the two it got.
    private var deckBox: UIView?
    private var tabIds: [String] = []
    private var controlIds: [Int: String] = [:]
    /// The other direction of controlIds: id → the capsule, so a coachmark can
    /// name a control and have exactly that one stay lit.
    private var controlViews: [String: UIView] = [:]
    private var coachSpotlight: String?
    private var coaching = false
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
        static let deckSpacing: CGFloat = 8
        static let deckBottomGap: CGFloat = 10
        /// Between the nudge card and the deck under it. The same 12 the web
        /// composition leaves at the foot of its flow, so a player who sees
        /// both builds sees one app.
        static let nudgeGap: CGFloat = 12
        /// The nudge's own inner padding and its ✕, which is the app's control
        /// size so the card's dismiss is the same target as every other round
        /// control in this chrome.
        static let nudgePadding: CGFloat = 14
        static let nudgeCloseSize: CGFloat = 36
        /// Breathing room either side of the month badge's label.
        static let badgePadding: CGFloat = 14
        /// What an un-spotlit surface fades to during the guided first play.
        /// Low enough to read as "not this one", high enough that the glass is
        /// still visibly glass rather than a grey hole.
        static let coachDim: CGFloat = 0.22
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
        // After the deck, which is what it hangs off, and after the tab bar,
        // which is what the deck hangs off. Order is a real dependency here,
        // not a preference.
        buildNudge()
        buildControls()

        host.onLayout = { [weak self] in
            guard let self else { return }
            // Same rule as apply(): a hidden deck measures zero, and zero is
            // not news. Rotation and safe-area changes while a sheet is open
            // are re-measured when it closes.
            guard self.currentState?.mode != "hidden" else { return }
            let next = self.measure()
            guard
                abs(next.top - self.lastInsets.top) > 0.5
                    || abs(next.bottom - self.lastInsets.bottom) > 0.5
                    || abs(next.tabBar - self.lastInsets.tabBar) > 0.5
                    // The coachmark card is positioned off this rect, so a
                    // control that moves and does not report has a card
                    // pointing at where it used to be.
                    || next.coach != self.lastInsets.coach
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

    /**
     The bottom deck: the button that moves time, and the month it moves.

     It used to be a column of three — a twelve-tick meter, the button, a
     caption reading MONTH 4 OF 12 — of which exactly one element was glass.
     The meter and the caption were the same fact drawn twice in two materials
     that are not the app's, stacked above and below the one control anybody
     touches. What replaces them is a second capsule of the same material,
     beside the button rather than around it, carrying the same fact in the
     form the fact is actually about: where you are and where the tap takes you.
     */
    private func buildDeck() {
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

        // The month badge. Untinted glass beside the tinted capsule, so the one
        // colour that asks you to do something stays on the one control that
        // does something.
        let badge = GlassKit.panel(corner: Metric.ctaHeight / 2, interactive: false, tint: nil)
        monthGlass = badge
        badge.heightAnchor.constraint(equalToConstant: Metric.ctaHeight).isActive = true
        // The button takes whatever width is left; the badge is exactly as wide
        // as what it says. Without both of these a long CTA title squeezes the
        // badge into an ellipsis, which is the one thing it cannot afford to be.
        badge.setContentHuggingPriority(.required, for: .horizontal)
        badge.setContentCompressionResistancePriority(.required, for: .horizontal)

        monthLabel.translatesAutoresizingMaskIntoConstraints = false
        monthLabel.isAccessibilityElement = true
        badge.contentView.addSubview(monthLabel)
        NSLayoutConstraint.activate([
            monthLabel.centerYAnchor.constraint(equalTo: badge.contentView.centerYAnchor),
            monthLabel.leadingAnchor.constraint(
                equalTo: badge.contentView.leadingAnchor, constant: Metric.badgePadding),
            monthLabel.trailingAnchor.constraint(
                equalTo: badge.contentView.trailingAnchor, constant: -Metric.badgePadding),
        ])

        deck.axis = .horizontal
        deck.alignment = .fill
        deck.distribution = .fill
        deck.spacing = Metric.deckSpacing
        deck.translatesAutoresizingMaskIntoConstraints = false
        deck.isHidden = true
        deck.addArrangedSubview(glass)
        deck.addArrangedSubview(badge)

        // Same treatment as the masthead cluster: a container where the OS has
        // one, so the two capsules behave as one piece of glass.
        let box: UIView
        if let group = GlassKit.container(spacing: Metric.deckSpacing) {
            deckGroup = group
            host.addSubview(group)
            group.contentView.addSubview(deck)
            NSLayoutConstraint.activate([
                deck.leadingAnchor.constraint(equalTo: group.contentView.leadingAnchor),
                deck.trailingAnchor.constraint(equalTo: group.contentView.trailingAnchor),
                deck.topAnchor.constraint(equalTo: group.contentView.topAnchor),
                deck.bottomAnchor.constraint(equalTo: group.contentView.bottomAnchor),
            ])
            box = group
        } else {
            host.addSubview(deck)
            box = deck
        }
        deckBox = box

        NSLayoutConstraint.activate([
            box.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: Metric.sideMargin),
            box.trailingAnchor.constraint(
                equalTo: host.trailingAnchor, constant: -Metric.sideMargin),
            box.bottomAnchor.constraint(
                equalTo: tabBar.topAnchor, constant: -Metric.deckBottomGap),
        ])
    }

    /**
     The nudge card.

     Deliberately NOT inside the deck's glass container. The container is what
     makes the advance capsule and the month badge read as one control, and a
     third pane joining it would make the thing that moves time look like part
     of a suggestion. This is its own panel, floating above that group with the
     same gap the web build uses — one glass surface for the seconds it is up,
     which is the allowance design.md §3 gives a toast.

     Two overlapping tap targets, and the order they are added is the whole of
     what keeps them apart: the full-card button first, the ✕ over it. A
     dismiss nested inside the card's own button is a tap that does both.
     */
    private func buildNudge() {
        let glass = GlassKit.panel(corner: 16, interactive: true, tint: nil)
        nudgeGlass = glass
        glass.isHidden = true
        glass.isUserInteractionEnabled = true
        glass.isAccessibilityElement = false

        let column = UIStackView()
        column.axis = .vertical
        column.spacing = 4
        column.alignment = .fill
        column.isUserInteractionEnabled = false
        column.translatesAutoresizingMaskIntoConstraints = false

        nudgeTitleLabel.numberOfLines = 2
        nudgeTitleLabel.font = .systemFont(ofSize: 15, weight: .bold)
        nudgeTitleLabel.textColor = .label
        column.addArrangedSubview(nudgeTitleLabel)

        nudgeBodyLabel.numberOfLines = 0
        nudgeBodyLabel.font = .systemFont(ofSize: 13, weight: .regular)
        nudgeBodyLabel.textColor = .secondaryLabel
        column.addArrangedSubview(nudgeBodyLabel)

        // The one line that says a tap does something. Kerned and upper-cased
        // to match the web card's own action line rather than dressed as a
        // second button — the card IS the button.
        nudgeActionLabel.numberOfLines = 1
        nudgeActionLabel.textColor = .label
        column.addArrangedSubview(nudgeActionLabel)
        column.setCustomSpacing(8, after: nudgeBodyLabel)

        glass.contentView.addSubview(column)

        nudgeTapButton.translatesAutoresizingMaskIntoConstraints = false
        nudgeTapButton.backgroundColor = .clear
        nudgeTapButton.addTarget(self, action: #selector(nudgeTapped), for: .touchUpInside)
        glass.contentView.addSubview(nudgeTapButton)

        nudgeCloseButton.translatesAutoresizingMaskIntoConstraints = false
        nudgeCloseButton.setImage(
            UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(
                pointSize: 12, weight: .bold)),
            for: .normal)
        nudgeCloseButton.tintColor = .tertiaryLabel
        nudgeCloseButton.accessibilityLabel = "Dismiss this suggestion"
        nudgeCloseButton.addTarget(self, action: #selector(nudgeDismissTapped), for: .touchUpInside)
        glass.contentView.addSubview(nudgeCloseButton)

        host.addSubview(glass)
        NSLayoutConstraint.activate([
            // The column stops short of the ✕ rather than running under it,
            // which is what keeps a two-line title off the glyph.
            column.leadingAnchor.constraint(
                equalTo: glass.contentView.leadingAnchor, constant: Metric.nudgePadding),
            column.trailingAnchor.constraint(
                equalTo: nudgeCloseButton.leadingAnchor, constant: -4),
            column.topAnchor.constraint(
                equalTo: glass.contentView.topAnchor, constant: Metric.nudgePadding),
            column.bottomAnchor.constraint(
                equalTo: glass.contentView.bottomAnchor, constant: -Metric.nudgePadding),

            nudgeCloseButton.topAnchor.constraint(equalTo: glass.contentView.topAnchor, constant: 4),
            nudgeCloseButton.trailingAnchor.constraint(
                equalTo: glass.contentView.trailingAnchor, constant: -4),
            nudgeCloseButton.widthAnchor.constraint(equalToConstant: Metric.nudgeCloseSize),
            nudgeCloseButton.heightAnchor.constraint(equalToConstant: Metric.nudgeCloseSize),

            nudgeTapButton.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor),
            nudgeTapButton.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor),
            nudgeTapButton.topAnchor.constraint(equalTo: glass.contentView.topAnchor),
            nudgeTapButton.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor),

            glass.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: Metric.sideMargin),
            glass.trailingAnchor.constraint(
                equalTo: host.trailingAnchor, constant: -Metric.sideMargin),
        ])

        // Above the deck when there is one to sit above, and above the tab bar
        // on the screens where the CTA is absent — the card is chrome either
        // way and must never be the thing the tab bar covers.
        if let deckBox {
            glass.bottomAnchor.constraint(
                equalTo: deckBox.topAnchor, constant: -Metric.nudgeGap).isActive = true
        } else {
            glass.bottomAnchor.constraint(
                equalTo: tabBar.topAnchor, constant: -Metric.nudgeGap).isActive = true
        }

        // The ✕ is added after the full-card button, so it wins the hit test
        // inside its own 36pt. Stated rather than left to insertion order,
        // because a later `addSubview` anywhere in this file would silently
        // take the corner back.
        glass.contentView.bringSubviewToFront(nudgeCloseButton)
    }

    private func buildControls() {
        for (stack, leading) in [(leadingControls, true), (trailingControls, false)] {
            stack.axis = .horizontal
            stack.spacing = 8
            stack.alignment = .center
            stack.translatesAutoresizingMaskIntoConstraints = false
            stack.isHidden = true

            /*
             * A glass container, where the OS has one.
             *
             * Without it three glass circles are three unrelated panes that
             * happen to be near each other. Inside one, iOS 26 merges and
             * separates them as they move and as they are pressed — the
             * behaviour that makes a cluster read as one control group rather
             * than as a row of buttons.
             */
            if let group = GlassKit.container(spacing: 8) {
                host.addSubview(group)
                group.contentView.addSubview(stack)
                NSLayoutConstraint.activate([
                    stack.leadingAnchor.constraint(equalTo: group.contentView.leadingAnchor),
                    stack.trailingAnchor.constraint(equalTo: group.contentView.trailingAnchor),
                    stack.topAnchor.constraint(equalTo: group.contentView.topAnchor),
                    stack.bottomAnchor.constraint(equalTo: group.contentView.bottomAnchor),
                    group.topAnchor.constraint(
                        equalTo: host.safeAreaLayoutGuide.topAnchor, constant: Metric.controlTop),
                    leading
                        ? group.leadingAnchor.constraint(
                            equalTo: host.leadingAnchor, constant: Metric.controlInset)
                        : group.trailingAnchor.constraint(
                            equalTo: host.trailingAnchor, constant: -Metric.controlInset),
                ])
                if leading { leadingGroup = group } else { trailingGroup = group }
                continue
            }

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
        let nudgeArriving = applyNudge(state.nudge)

        setHidden(state.mode == "hidden")
        applyCoach(mode: state.mode, spotlight: state.coach)
        host.layoutIfNeeded()

        // After layout, so the card springs from where it will actually be
        // rather than from wherever the constraints last put it. Only on a
        // genuinely new nudge: `setChrome` is pushed on every month, every tab
        // and every theme change, and a card that re-entered on each of those
        // would be the one thing on this screen that moves without being moved.
        if nudgeArriving, nudgeGlass?.isHidden == false { animateNudgeIn() }

        /*
         * Hiding the chrome must not collapse what it reserved.
         *
         * Every "hidden" is a web sheet opening over the play screen, and the
         * play screen is still mounted underneath. Reporting zero would reflow
         * it behind the sheet and reflow it back on dismiss — a jump the
         * player sees at exactly the moment the sheet gets out of the way.
         * The reservation describes the chrome's footprint, not its visibility.
         */
        if state.mode != "hidden" {
            lastInsets = measure()
        } else {
            // The reservation stands while a sheet is open, but the spotlight
            // does not: a stale rect would put the next coachmark card beside
            // a control that is no longer being taught.
            lastInsets.coach = nil
        }
        return lastInsets
    }

    /**
     Everything this controller draws, withdrawn, and its reservation with it.

     `apply(hidden)` deliberately keeps the reservation, because every hidden it
     sees is a web sheet opening over a play screen that is still mounted
     underneath and still laying out around the deck. A reset is the other case:
     the webview has thrown that screen away entirely, and there is nothing left
     to reserve for.

     Which happens on a document navigation. Several routes leave by
     `window.location` rather than by the router — signing out, deleting an
     account, the door out of Settings back to the islands — and a document
     navigation destroys the React tree without running one effect cleanup. The
     chrome is a subview of the view controller rather than of the page, so it
     outlives the code that knew how to take it down. `configure()` runs again
     on the new document, and this is what it calls.
     */
    @discardableResult
    func reset() -> ChromeInsets {
        currentToast?.dismissNow()
        apply(
            ChromeState(
                mode: "hidden",
                theme: currentState?.theme ?? "dark",
                tabs: [],
                activeTab: nil,
                cta: nil,
                controls: [],
                nudge: nil,
                coach: nil))
        lastInsets = ChromeInsets()
        return lastInsets
    }

    /**
     The nudge's content, and whether this is a card the player has not seen.

     Returns true only when the id changed — restating the same nudge with a
     new month in the badge beside it is not an arrival, and animating it as
     one is how a suggestion becomes a nag.
     */
    private func applyNudge(_ nudge: ChromeNudge?) -> Bool {
        guard let nudge else {
            currentNudge = nil
            return false
        }
        let arriving = currentNudge?.id != nudge.id
        currentNudge = nudge

        nudgeTitleLabel.text = nudge.title
        nudgeBodyLabel.text = nudge.body
        nudgeActionLabel.attributedText = NSAttributedString(
            string: "\(nudge.action.uppercased())  ▸",
            attributes: [
                .font: UIFont.systemFont(ofSize: 12, weight: .heavy),
                .foregroundColor: UIColor.label,
                .kern: 1.0,
            ])

        // One target, one sentence. VoiceOver reads the card as the button it
        // is rather than as three labels and a mystery control.
        nudgeTapButton.accessibilityLabel = "\(nudge.title) \(nudge.body) \(nudge.action)"
        return arriving
    }

    /// Up from under the deck, on the same spring the deck's own controls use.
    private func animateNudgeIn() {
        guard let glass = nudgeGlass else { return }
        glass.alpha = 0
        glass.transform = CGAffineTransform(translationX: 0, y: 10)
        UIView.animate(
            withDuration: 0.34, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0.3,
            options: [.allowUserInteraction]
        ) {
            glass.alpha = 1
            glass.transform = .identity
        }
    }

    private func setHidden(_ hidden: Bool) {
        tabBar.isHidden = hidden || tabBar.items?.isEmpty != false
        deck.isHidden = hidden || currentState?.cta == nil
        nudgeGlass?.isHidden = hidden || currentNudge == nil
        leadingControls.isHidden = hidden || leadingControls.arrangedSubviews.isEmpty
        trailingControls.isHidden = hidden || trailingControls.arrangedSubviews.isEmpty
        leadingGroup?.isHidden = leadingControls.isHidden
        trailingGroup?.isHidden = trailingControls.isHidden
        deckGroup?.isHidden = deck.isHidden
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

        // The badge takes the gold only at the gate, where the month it names
        // is the one the whole year is pointed at.
        monthLabel.attributedText = NSAttributedString(
            string: cta.badge,
            attributes: [
                .font: UIFont.systemFont(ofSize: 13, weight: .bold),
                .foregroundColor: prestige ? GlassKit.prestige : UIColor.label,
                .kern: 0.8,
            ])
        monthLabel.accessibilityLabel = cta.badgeLabel
        monthGlass?.isHidden = cta.badge.isEmpty
    }

    private func applyControls(_ controls: [ChromeControl]) {
        leadingControls.arrangedSubviews.forEach { $0.removeFromSuperview() }
        trailingControls.arrangedSubviews.forEach { $0.removeFromSuperview() }
        controlIds.removeAll()
        controlViews.removeAll()

        for (index, control) in controls.enumerated() {
            let view = makeControl(control, tag: index)
            controlIds[index] = control.id
            controlViews[control.id] = view
            (control.leading ? leadingControls : trailingControls).addArrangedSubview(view)
        }
    }

    // ── The guided first play ────────────────────────────────────────────────

    /**
     Teaches one native control without the chrome having to leave.

     ── Why this exists ─────────────────────────────────────────────────────

     The tutorial dims the screen, cuts a hole around one control and refuses
     every tap outside it. It does that with four DOM panels around a hole,
     which works perfectly for anything the web layer drew — and not at all for
     a UIKit view, because a native view composites ABOVE the webview. A web
     scrim cannot dim it and a web hole cannot expose it.

     So the whole native chrome used to stand down for the duration and the DOM
     chrome came back. The cost of that was not obvious until you watched
     someone play: the guided first run is a new player's entire first session,
     which meant the app's first impression contained no Liquid Glass at all.
     The one screen most worth showing it on was the one screen that never did.

     ── What it does instead ────────────────────────────────────────────────

     The chrome dims and disables itself. Alpha rather than a scrim view: glass
     fading toward the dimmed page behind it is what dimming glass looks like,
     and it needs no geometry kept in step with anything. `spotlight` names the
     one surface that stays lit and tappable — and tappable matters as much as
     lit, because a native control left live over a dimmed screen is a player
     advancing the month in the middle of being told what the month is.

     nil spotlight means the step is teaching something in the web layer: every
     native surface dims, and none of them respond.
     */
    private func applyCoach(mode: String, spotlight: String?) {
        let wasCoaching = coaching
        coaching = mode == "coach"
        coachSpotlight = coaching ? spotlight : nil

        guard coaching else {
            // Restore on the transition, not on a sampled alpha. Reading one
            // view's alpha to decide would miss the case where that view was
            // the spotlight and so never dimmed, leaving every other surface
            // stuck at a quarter strength for the rest of the run.
            if wasCoaching { restoreFromCoach() }
            return
        }

        func light(_ view: UIView, _ on: Bool) {
            view.alpha = on ? 1 : Metric.coachDim
            view.isUserInteractionEnabled = on
        }

        light(deck, spotlight == "advance")
        if let deckGroup { light(deckGroup, spotlight == "advance") }
        light(tabBar, spotlight == "tabs")
        // The nudge is never taught and is therefore never the spotlight: the
        // tutorial is the one moment the game already has the player's whole
        // attention, and a second suggestion competing for it is the exact
        // thing coach mode dims everything else to prevent.
        if let nudgeGlass { light(nudgeGlass, false) }

        // A group is lit only when it holds the spotlight, and its unlit
        // siblings dim inside it — alpha compounds, so a dimmed control in a
        // lit group lands in the same place as one in a dimmed group.
        for (id, view) in controlViews { light(view, spotlight == id) }
        let leadingHasIt = holdsSpotlight(leadingControls, spotlight)
        let trailingHasIt = holdsSpotlight(trailingControls, spotlight)
        light(leadingGroup ?? leadingControls, leadingHasIt)
        light(trailingGroup ?? trailingControls, trailingHasIt)
        if leadingGroup != nil { light(leadingControls, leadingHasIt) }
        if trailingGroup != nil { light(trailingControls, trailingHasIt) }
    }

    private func holdsSpotlight(_ stack: UIStackView, _ spotlight: String?) -> Bool {
        guard let spotlight, let view = controlViews[spotlight] else { return false }
        return stack.arrangedSubviews.contains(view)
    }

    /// Back to full strength. Every surface the dimming can reach, so a chrome
    /// that goes into coaching always comes back out of it whole.
    private func restoreFromCoach() {
        for view in [deck, tabBar, leadingControls, trailingControls] as [UIView] {
            view.alpha = 1
            view.isUserInteractionEnabled = true
        }
        for view in [leadingGroup, trailingGroup, deckGroup, nudgeGlass].compactMap({ $0 }) {
            view.alpha = 1
            view.isUserInteractionEnabled = true
        }
        for view in controlViews.values {
            view.alpha = 1
            view.isUserInteractionEnabled = true
        }
    }

    /// The spotlit view's box in host coordinates, for the coachmark card to
    /// sit beside. Points are CSS pixels here, so it crosses unconverted.
    private func coachRect() -> CGRect? {
        guard coaching, let spotlight = coachSpotlight else { return nil }
        let view: UIView?
        switch spotlight {
        case "advance": view = deck.isHidden ? nil : (deckGroup ?? deck)
        case "tabs": view = tabBar.isHidden ? nil : tabBar
        default: view = controlViews[spotlight]
        }
        guard let view, view.bounds.height > 0 else { return nil }
        let rect = view.convert(view.bounds, to: host)
        return rect.isNull || rect.isInfinite ? nil : rect
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
        } else if let symbol = control.symbol,
            let image = UIImage(
                systemName: symbol,
                // Stated rather than inherited: the default point size follows
                // the body text style, so a player at a large accessibility
                // size would get a glyph wider than the 36pt circle holding it.
                withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold))
        {
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
        content.setContentHuggingPriority(.required, for: .horizontal)
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
            button.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor),
            button.topAnchor.constraint(equalTo: glass.contentView.topAnchor),
            button.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor),
            glass.heightAnchor.constraint(equalToConstant: height),
            glass.widthAnchor.constraint(greaterThanOrEqualToConstant: height),
        ])

        if isBadge {
            // The capsule hugs its label plus padding. Pinning both edges is
            // what sizes it; the >= above only stops a two-character badge
            // from coming out narrower than the circles beside it.
            NSLayoutConstraint.activate([
                content.leadingAnchor.constraint(
                    equalTo: glass.contentView.leadingAnchor, constant: hPadding),
                content.trailingAnchor.constraint(
                    equalTo: glass.contentView.trailingAnchor, constant: -hPadding),
            ])
        } else {
            // A circle, and the symbol keeps its own size inside it. Pinning
            // the image's edges here would stretch a 17pt glyph to fill all
            // 36 and leave the control with no padding at all.
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

     The deck lost a meter and a caption and got shorter by roughly 30pt. That
     number appears nowhere: the log below simply gets 30pt more of itself,
     because the reservation has always been what UIKit measured rather than
     what anybody wrote down.
     */
    private func measure() -> ChromeInsets {
        var insets = ChromeInsets()
        let height = host.bounds.height
        guard height > 0 else { return insets }

        if !leadingControls.isHidden || !trailingControls.isHidden {
            // Measured off the container where there is one: the cluster's
            // frame is relative to the container, not to the host.
            let leadingBox = leadingGroup ?? leadingControls
            let trailingBox = trailingGroup ?? trailingControls
            let controlsBottom = max(
                leadingControls.isHidden ? 0 : leadingBox.frame.maxY,
                trailingControls.isHidden ? 0 : trailingBox.frame.maxY)
            insets.top = controlsBottom + Metric.controlTop
        }

        if !tabBar.isHidden, tabBar.frame.height > 0 {
            insets.tabBar = height - tabBar.frame.minY
        }

        // Off the container where there is one: inside a group the stack's own
        // frame is relative to that group, not to the host.
        let deckBox = deckGroup ?? deck
        if !deck.isHidden, deckBox.frame.height > 0 {
            insets.bottom = height - deckBox.frame.minY + Metric.deckBottomGap
        } else {
            insets.bottom = insets.tabBar
        }

        insets.coach = coachRect()
        return insets
    }

    // ── Toast ────────────────────────────────────────────────────────────────

    /**
     A glass note, floated in from the top.

     The last of the five surfaces design.md allows glass on, and the one the
     app had no use for until now: term-on-first-use. The shark defines a word
     the moment it first appears, and that definition is chrome — it explains
     the board, it is not part of it.

     It carries a live number, so it leaves on its own before that number can
     change, and a tap takes it away sooner. The dwell is proportional to how
     much there is to read rather than a constant that is wrong at both ends.
     */
    func toast(title: String, text: String, tone: String) {
        currentToast?.dismissNow()

        // A toast is a floating panel: `--radius-card`, not a sheet corner.
        let glass = GlassKit.panel(corner: 14, interactive: false, tint: nil)
        let column = UIStackView()
        column.axis = .vertical
        column.spacing = 3
        column.translatesAutoresizingMaskIntoConstraints = false

        if !title.isEmpty {
            let head = UILabel()
            head.attributedText = NSAttributedString(
                string: title.uppercased(),
                attributes: [
                    .font: UIFont.systemFont(ofSize: 12, weight: .bold),
                    .foregroundColor: UIColor.secondaryLabel,
                    .kern: 1.8,
                ])
            column.addArrangedSubview(head)
        }

        let body = UILabel()
        body.numberOfLines = 0
        body.attributedText = NSAttributedString(
            string: text,
            attributes: [
                .font: UIFont.systemFont(ofSize: 14, weight: .medium),
                .foregroundColor: tone == "bad" ? UIColor.systemRed : UIColor.label,
            ])
        column.addArrangedSubview(body)

        glass.contentView.addSubview(column)
        NSLayoutConstraint.activate([
            column.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor, constant: 16),
            column.trailingAnchor.constraint(
                equalTo: glass.contentView.trailingAnchor, constant: -16),
            column.topAnchor.constraint(equalTo: glass.contentView.topAnchor, constant: 12),
            column.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor, constant: -12),
        ])

        glass.alpha = 0
        host.addSubview(glass)
        NSLayoutConstraint.activate([
            glass.leadingAnchor.constraint(
                equalTo: host.leadingAnchor, constant: Metric.sideMargin),
            glass.trailingAnchor.constraint(
                equalTo: host.trailingAnchor, constant: -Metric.sideMargin),
            glass.topAnchor.constraint(
                equalTo: host.safeAreaLayoutGuide.topAnchor,
                constant: Metric.controlTop * 2 + Metric.controlSize + 8),
        ])
        host.layoutIfNeeded()
        glass.transform = CGAffineTransform(translationX: 0, y: -14)

        let note = Toast(view: glass)
        currentToast = note
        note.onGone = { [weak self, weak note] in
            if self?.currentToast === note { self?.currentToast = nil }
        }

        let tap = UITapGestureRecognizer(target: note, action: #selector(Toast.tapped))
        glass.contentView.addGestureRecognizer(tap)
        glass.isUserInteractionEnabled = true

        UIView.animate(
            withDuration: 0.34, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0.3,
            options: [.allowUserInteraction]
        ) {
            glass.alpha = 1
            glass.transform = .identity
        }

        // Roughly a comfortable reading speed, floored so a short line still
        // registers and capped so a long one is not a wall you cannot dismiss.
        let dwell = min(max(2.4, Double(text.count) / 16.0), 9.0)
        note.schedule(after: dwell)
    }

    /**
     One floated note and the timer that takes it away.

     A class rather than a closure so a second note can cancel the first: two
     definitions stacked on top of each other is worse than the one you missed.
     */
    final class Toast: NSObject {
        private let view: UIView
        private var work: DispatchWorkItem?
        var onGone: (() -> Void)?

        init(view: UIView) {
            self.view = view
            super.init()
        }

        func schedule(after seconds: Double) {
            let item = DispatchWorkItem { [weak self] in self?.dismissNow() }
            work = item
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
        }

        @objc func tapped() { dismissNow() }

        func dismissNow() {
            work?.cancel()
            work = nil
            guard view.superview != nil else { return }
            UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseIn]) {
                self.view.alpha = 0
                self.view.transform = CGAffineTransform(translationX: 0, y: -14)
            } completion: { _ in
                self.view.removeFromSuperview()
                self.onGone?()
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

    /**
     The card was tapped: open the tab it names.

     Nothing is animated away here, and that is deliberate. The web layer
     answers this by opening an activity, which is a full-screen overlay, which
     pushes `mode: "hidden"` and takes the whole chrome down with it. Fading
     the card out first would be a second, faster disappearance layered under
     the real one.
     */
    @objc private func nudgeTapped() {
        guard let id = currentNudge?.id else { return }
        tapFeedback.impactOccurred()
        onNudgeAction?(id)
    }

    /**
     The ✕: gone now, not gone when the round trip completes.

     The web layer owns whether this nudge comes back — dismissal is held for
     the current game month, in React — and it will push a state without it.
     But that push crosses a bridge, and a card that sits there for the length
     of a round trip after being closed is a card whose ✕ did not work. So the
     view leaves on the tap and the state push confirms it.

     `currentNudge` is cleared here too. Otherwise `setHidden` — which runs on
     every subsequent push — would read "there is a nudge" and put the hidden
     card straight back on screen before the web layer's own state caught up.
     */
    @objc private func nudgeDismissTapped() {
        guard let id = currentNudge?.id, let glass = nudgeGlass else { return }
        tapFeedback.impactOccurred()
        currentNudge = nil
        UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseIn]) {
            glass.alpha = 0
            glass.transform = CGAffineTransform(translationX: 0, y: 10)
        } completion: { _ in
            glass.isHidden = true
            // Left ready for the next card rather than at the end of this
            // one's exit: `animateNudgeIn` sets both again, but a card that is
            // re-shown WITHOUT arriving — a sheet opening and closing over a
            // nudge that never changed — would otherwise come back invisible.
            glass.alpha = 1
            glass.transform = .identity
        }
        onNudgeDismiss?(id)
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
