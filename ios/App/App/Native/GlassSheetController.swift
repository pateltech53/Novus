import UIKit

// ── What the web layer asks for ──────────────────────────────────────────────

struct SheetChoice {
    let label: String
    /// The known part of the tradeoff — "Cash −3S", "Rev −8% (1Q)". A financial
    /// figure, which is why the row it sits on is never glass.
    let cost: String?
    /// This choice opens the camera. Marked, because it is not a tap-out.
    let camera: Bool
}

struct SheetNote {
    let term: String
    let text: String
}

struct SheetSpec {
    /// The event id. Echoed back with every answer so a reply that arrives
    /// after the card has moved on is discarded rather than applied to the
    /// wrong month.
    let id: String
    let eyebrow: String
    /// "market" wears the dateline treatment instead of a category tag.
    let eyebrowStyle: String
    let eyebrowDetail: String?
    let title: String
    let body: String
    let notes: [SheetNote]
    let hintTitle: String?
    let hintText: String?
    let choices: [SheetChoice]
    /// The single call to action shown when an event has no choices at all.
    let actionLabel: String?
    let actionCamera: Bool
    let dismissible: Bool
    let theme: String
}

/**
 A decision, presented by UIKit.

 ── Why this is native at all ────────────────────────────────────────────────

 The scrim. design.md lists modal scrims among the five surfaces that are
 allowed to be glass, and a web scrim cannot be one: `backdrop-filter` inside
 the webview can only blur other web content, and the thing worth blurring —
 the whole game — is what the sheet is covering. Presenting natively puts a
 real system material between the player and the board, composited by the OS.

 Everything else follows from being here anyway: real sheet physics, a real
 drag-to-dismiss, real scroll deceleration, and the grabber and header that
 the same design law already sanctions as glass.

 ── What is deliberately NOT glass ───────────────────────────────────────────

 The body and the choice rows. design.md is explicit — decision sheets, cards
 and list rows are content, and *money is read on solid ground*. Every choice
 row here can carry a cash figure, so every choice row is opaque. The glass in
 this file is the backdrop, the grabber and the header, and stops there. That
 is also what keeps it inside the "max two glass surfaces at once" budget:
 backdrop plus header, with the tab bar withdrawn while a sheet is open.
 */
final class GlassSheetController: UIViewController, UIScrollViewDelegate {

    var onChoose: ((String, Int) -> Void)?
    var onAction: ((String) -> Void)?
    var onDismissed: ((String) -> Void)?

    private let spec: SheetSpec
    private var answered = false
    private var rowGlass: [Int: UIView] = [:]

    private let backdrop = GlassKit.backdrop()
    private let panel = UIView()
    private let panelGlass = GlassKit.panel(corner: 0, interactive: false, tint: nil)
    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private let grabber = GlassKit.panel(corner: 2.5, interactive: false, tint: nil)
    private let header = GlassKit.panel(corner: 0, interactive: false, tint: nil)
    private let headerLabel = UILabel()
    private let selection = UISelectionFeedbackGenerator()

    private enum Metric {
        /// Matches `--radius-sheet` in app/globals.css. The DOM and the
        /// native sheet are the same object on two platforms; a 28pt corner
        /// beside a 22px one is a difference the player can see when they
        /// switch device.
        static let corner: CGFloat = 22
        static let side: CGFloat = 20
        /// Matches `--radius-row`. A choice row lives inside the sheet, so
        /// it is one step tighter than it — concentric corners, the rule the
        /// whole budget is built on.
        static let rowCorner: CGFloat = 10
        static let headerHeight: CGFloat = 52
        static let maxHeightFraction: CGFloat = 0.92
    }

    init(spec: SheetSpec) {
        self.spec = spec
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a storyboard") }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        // The web app's theme is its own; the sheet has to agree with the game
        // behind it rather than with the phone's setting.
        overrideUserInterfaceStyle = spec.theme == "dark" ? .dark : .light

        buildBackdrop()
        buildPanel()
        buildContent()
        buildHeader()
        selection.prepare()
    }

    private var enteredOnce = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        syncHeader()
        guard !enteredOnce else { return }
        enteredOnce = true
        // Presented without animation so the two halves can be choreographed:
        // the backdrop fades while the panel springs, which is what a sheet
        // over a live screen does and what a plain cover-vertical does not.
        view.layoutIfNeeded()
        panel.transform = CGAffineTransform(translationX: 0, y: panel.bounds.height)
        UIView.animate(
            withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.88, initialSpringVelocity: 0.4,
            options: [.allowUserInteraction]
        ) {
            self.panel.transform = .identity
        }
    }

    private func buildBackdrop() {
        backdrop.alpha = 0
        view.addSubview(backdrop)
        NSLayoutConstraint.activate([
            backdrop.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            backdrop.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            backdrop.topAnchor.constraint(equalTo: view.topAnchor),
            backdrop.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        // Tapping the blurred game behind the sheet closes it, the same way the
        // web scrim does — but only for a card that is allowed to be dismissed.
        if spec.dismissible {
            let tap = UITapGestureRecognizer(target: self, action: #selector(backdropTapped))
            backdrop.contentView.addGestureRecognizer(tap)
        }

        UIView.animate(withDuration: 0.22) { self.backdrop.alpha = 1 }
    }

    private func buildPanel() {
        panel.translatesAutoresizingMaskIntoConstraints = false
        // Clear, with the glass added as the first subview rather than as the
        // panel itself: everything else in this file already lays out against
        // `panel`, and swapping its class would move every one of those
        // constraints onto a contentView for no gain.
        panel.backgroundColor = .clear
        panel.layer.cornerRadius = Metric.corner
        panel.layer.cornerCurve = .continuous
        panel.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        panel.clipsToBounds = true
        view.addSubview(panel)

        let top = panel.topAnchor.constraint(
            greaterThanOrEqualTo: view.safeAreaLayoutGuide.topAnchor, constant: 24)
        top.priority = .required

        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            panel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            panel.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            top,
            panel.heightAnchor.constraint(
                lessThanOrEqualTo: view.heightAnchor, multiplier: Metric.maxHeightFraction),
        ])

        /*
         * The sheet's own surface, now Liquid Glass.
         *
         * Three materials end up stacked here — the blurred backdrop, this,
         * and the choice rows — which is more nesting than Apple's guidance
         * likes. It is a deliberate call, recorded in design.md §0 rather than
         * left as an accident: reverting is `panel.backgroundColor =
         * .secondarySystemBackground` and deleting these eight lines.
         */
        panelGlass.isUserInteractionEnabled = false
        panel.insertSubview(panelGlass, at: 0)
        NSLayoutConstraint.activate([
            panelGlass.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            panelGlass.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            panelGlass.topAnchor.constraint(equalTo: panel.topAnchor),
            panelGlass.bottomAnchor.constraint(equalTo: panel.bottomAnchor),
        ])

        // The grabber. Glass, and one of the five surfaces design.md names.
        grabber.isUserInteractionEnabled = false
        panel.addSubview(grabber)
        NSLayoutConstraint.activate([
            grabber.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
            grabber.topAnchor.constraint(equalTo: panel.topAnchor, constant: 8),
            grabber.widthAnchor.constraint(equalToConstant: 38),
            grabber.heightAnchor.constraint(equalToConstant: 5),
        ])

    }

    private func buildContent() {
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.delegate = self
        scroll.alwaysBounceVertical = true
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        panel.addSubview(scroll)

        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)

        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: panel.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: panel.bottomAnchor),

            stack.leadingAnchor.constraint(
                equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: Metric.side),
            stack.trailingAnchor.constraint(
                equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -Metric.side),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 22),
            stack.bottomAnchor.constraint(
                equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -20),
            stack.widthAnchor.constraint(
                equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -Metric.side * 2),
        ])

        // ── Eyebrow ──────────────────────────────────────────────────────────
        if spec.eyebrowStyle == "market" {
            stack.addArrangedSubview(marketDateline())
        } else {
            stack.addArrangedSubview(
                label(
                    spec.eyebrow.uppercased(), size: 12, weight: .bold, kern: 1.7,
                    color: .tertiaryLabel))
        }

        let eyebrow = stack.arrangedSubviews[stack.arrangedSubviews.count - 1]
        stack.addArrangedSubview(
            label(spec.title, size: 22, weight: .heavy, kern: -0.2, color: .label, lines: 0))
        // The title belongs to its eyebrow, not to the list.
        stack.setCustomSpacing(6, after: eyebrow)

        stack.addArrangedSubview(
            label(spec.body, size: 15, weight: .regular, kern: 0, color: .secondaryLabel, lines: 0))

        // ── Rookie Mode's plain-English layer ────────────────────────────────
        if !spec.notes.isEmpty {
            let box = explainerBox()

            let inner = UIStackView()
            inner.axis = .vertical
            inner.spacing = 6
            inner.translatesAutoresizingMaskIntoConstraints = false
            for note in spec.notes {
                let line = NSMutableAttributedString(
                    string: note.term.uppercased(),
                    attributes: [
                        .font: UIFont.systemFont(ofSize: 13, weight: .bold),
                        .foregroundColor: UIColor.label,
                    ])
                line.append(
                    NSAttributedString(
                        string: " — \(note.text)",
                        attributes: [
                            .font: UIFont.systemFont(ofSize: 13, weight: .regular),
                            .foregroundColor: UIColor.secondaryLabel,
                        ]))
                let l = UILabel()
                l.attributedText = line
                l.numberOfLines = 0
                inner.addArrangedSubview(l)
            }
            fill(box, with: inner)
            stack.addArrangedSubview(box)
        }

        // ── The once-only "how to read this" ────────────────────────────────
        if let hintTitle = spec.hintTitle, let hintText = spec.hintText {
            let box = explainerBox()

            let inner = UIStackView()
            inner.axis = .vertical
            inner.spacing = 6
            inner.translatesAutoresizingMaskIntoConstraints = false
            inner.addArrangedSubview(
                label(
                    hintTitle.uppercased(), size: 12, weight: .bold, kern: 1.9,
                    color: .tertiaryLabel))
            inner.addArrangedSubview(
                label(hintText, size: 14, weight: .regular, kern: 0, color: .secondaryLabel, lines: 0))
            fill(box, with: inner)
            stack.addArrangedSubview(box)
        }

        // ── The choices ─────────────────────────────────────────────────────
        //
        // Grouped, where the OS can group them. A column of separate glass
        // panes is exactly the thing UIGlassContainerEffect exists to stop:
        // inside one, the rows merge and separate as a set.
        let rows = spec.choices.enumerated().map { choiceRow($0.element, index: $0.offset) }
        if !rows.isEmpty, let group = GlassKit.container(spacing: 8) {
            let column = UIStackView(arrangedSubviews: rows)
            column.axis = .vertical
            column.spacing = 8
            column.translatesAutoresizingMaskIntoConstraints = false
            group.contentView.addSubview(column)
            NSLayoutConstraint.activate([
                column.leadingAnchor.constraint(equalTo: group.contentView.leadingAnchor),
                column.trailingAnchor.constraint(equalTo: group.contentView.trailingAnchor),
                column.topAnchor.constraint(equalTo: group.contentView.topAnchor),
                column.bottomAnchor.constraint(equalTo: group.contentView.bottomAnchor),
            ])
            stack.addArrangedSubview(group)
        } else {
            rows.forEach { stack.addArrangedSubview($0) }
        }

        // ── Or the one thing there is to do ─────────────────────────────────
        //
        // Tinted glass, the same MATERIAL as the capsule that moves time on
        // the play screen. It was a flat orange rectangle, which made the one
        // card with no choices on it the one card whose primary control was
        // not the same material as everything around it.
        //
        // Not the same SHAPE, though, and that is deliberate: the advance
        // capsule is chrome floating over the app, while this is a full-width
        // control sitting inside a 22pt sheet. At 27 it was rounder than the
        // thing containing it, which is the one arrangement the radius budget
        // rules out. 14 is `--radius-card`, which is what its DOM twin in
        // components/DecisionSheet.tsx now draws.
        if let actionLabel = spec.actionLabel {
            let glass = GlassKit.panel(corner: 14, interactive: true, tint: GlassKit.action)
            glass.heightAnchor.constraint(equalToConstant: 54).isActive = true

            let button = UIButton(type: .system)
            button.translatesAutoresizingMaskIntoConstraints = false
            button.backgroundColor = .clear
            button.setAttributedTitle(
                NSAttributedString(
                    string: spec.actionCamera ? "\u{1F4F9}  \(actionLabel)" : actionLabel,
                    attributes: [
                        .font: UIFont.systemFont(ofSize: 16, weight: .heavy),
                        .foregroundColor: UIColor.white,
                        .kern: 0.7,
                    ]),
                for: .normal)
            button.addTarget(self, action: #selector(actionTapped), for: .touchUpInside)
            glass.contentView.addSubview(button)
            NSLayoutConstraint.activate([
                button.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor),
                button.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor),
                button.topAnchor.constraint(equalTo: glass.contentView.topAnchor),
                button.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor),
            ])
            stack.addArrangedSubview(glass)
        }

        /*
         * Clear of the home indicator, always.
         *
         * Added to the stack BEFORE the constraint is activated, and the order
         * is not cosmetic. This relates the footer's height to a distance
         * measured on `view`, so the two must already share an ancestor when
         * the constraint goes live — activating it a line earlier, while the
         * footer is still parentless, throws "no common ancestor" and takes the
         * sheet down with it.
         *
         * The button above gets away with the other order because
         * `equalToConstant:` involves nothing but itself. That difference is
         * invisible at the call site, which is exactly why it is written down.
         */
        let footer = UIView()
        footer.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(footer)
        footer.heightAnchor.constraint(
            equalTo: view.safeAreaLayoutGuide.bottomAnchor.anchorWithOffset(
                to: view.bottomAnchor)
        ).isActive = true
    }

    /**
     The header that appears once content scrolls under it.

     One of the five sanctioned glass surfaces, and the one that earns its
     place: it is the only thing telling you what you are still answering once
     the title has scrolled away.
     */
    private func buildHeader() {
        header.alpha = 0
        panel.addSubview(header)
        headerLabel.translatesAutoresizingMaskIntoConstraints = false
        headerLabel.attributedText = NSAttributedString(
            string: spec.title,
            attributes: [
                .font: UIFont.systemFont(ofSize: 15, weight: .bold),
                .foregroundColor: UIColor.label,
            ])
        headerLabel.lineBreakMode = .byTruncatingTail
        header.contentView.addSubview(headerLabel)

        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            header.topAnchor.constraint(equalTo: panel.topAnchor),
            header.heightAnchor.constraint(equalToConstant: Metric.headerHeight),
            headerLabel.leadingAnchor.constraint(
                equalTo: header.contentView.leadingAnchor, constant: Metric.side),
            headerLabel.trailingAnchor.constraint(
                equalTo: header.contentView.trailingAnchor, constant: -Metric.side),
            headerLabel.bottomAnchor.constraint(
                equalTo: header.contentView.bottomAnchor, constant: -12),
        ])
        // The grabber rides above the header, so it never disappears under it.
        panel.bringSubviewToFront(grabber)
    }

    // ── Pieces ───────────────────────────────────────────────────────────────

    /**
     The two explanatory boxes inside a card — Rookie Mode's plain English and
     the once-only "how to read this".

     Glass, like everything else on this sheet. They were `.secondarySystemBackground`
     rectangles, which is a system grey that belongs to no theme this app has,
     sitting on a glass panel between two sets of glass rows — two opaque slabs
     in the middle of the one surface design.md lets go all the way. They carry
     no figure, which is what makes this the easy half of the named exception:
     they explain the board, they are not part of it.
     */
    private func explainerBox() -> UIVisualEffectView {
        GlassKit.panel(corner: Metric.rowCorner, interactive: false, tint: nil)
    }

    /// Inset a box's one child by the padding every box in this sheet uses.
    /// Effect views host their children in `contentView`; adding to the view
    /// itself puts them above the material rather than inside it.
    private func fill(_ box: UIVisualEffectView, with content: UIView) {
        box.contentView.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: box.contentView.leadingAnchor, constant: 14),
            content.trailingAnchor.constraint(
                equalTo: box.contentView.trailingAnchor, constant: -14),
            content.topAnchor.constraint(equalTo: box.contentView.topAnchor, constant: 12),
            content.bottomAnchor.constraint(equalTo: box.contentView.bottomAnchor, constant: -12),
        ])
    }

    private func label(
        _ text: String, size: CGFloat, weight: UIFont.Weight, kern: CGFloat, color: UIColor,
        lines: Int = 1
    ) -> UILabel {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.numberOfLines = lines
        l.attributedText = NSAttributedString(
            string: text,
            attributes: [
                .font: UIFont.systemFont(ofSize: size, weight: weight),
                .foregroundColor: color,
                .kern: kern,
            ])
        return l
    }

    private func marketDateline() -> UIView {
        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.backgroundColor = UIColor(red: 0.04, green: 0.12, blue: 0.21, alpha: 1)
        bar.layer.cornerRadius = 14 // --radius-card
        bar.layer.cornerCurve = .continuous

        let left = label(
            spec.eyebrow.uppercased(), size: 12, weight: .bold, kern: 1.9, color: GlassKit.prestige)
        let right = label(
            (spec.eyebrowDetail ?? "").uppercased(), size: 12, weight: .regular, kern: 1.2,
            color: UIColor.white.withAlphaComponent(0.45))
        right.textAlignment = .right
        right.adjustsFontSizeToFitWidth = true
        right.minimumScaleFactor = 0.7

        bar.addSubview(left)
        bar.addSubview(right)
        NSLayoutConstraint.activate([
            left.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 14),
            left.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            right.leadingAnchor.constraint(greaterThanOrEqualTo: left.trailingAnchor, constant: 8),
            right.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -14),
            right.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            bar.heightAnchor.constraint(equalToConstant: 38),
        ])
        left.setContentCompressionResistancePriority(.required, for: .horizontal)
        return bar
    }

    /**
     One choice, on glass.

     This is the deliberate exception to design.md §0. The rule was *money is
     read on solid ground*, and a cost chip — "Cash −3S" — is money. It was
     changed on purpose, and the doc was changed with it rather than left to
     disagree with the code.

     What the change costs is legibility budget, so it is paid back here: the
     cost chip is `label` and semibold rather than `secondaryLabel` and regular,
     because small monospaced text is the first thing a refractive material
     eats. If this reads muddy on a device, the honest fix is to put the rows
     back on `.tertiarySystemBackground` — one line, and the sheet keeps every
     other piece of glass it has.
     */
    private func choiceRow(_ choice: SheetChoice, index: Int) -> UIView {
        let glass = GlassKit.panel(corner: Metric.rowCorner, interactive: true, tint: nil)
        rowGlass[index] = glass

        let button = UIButton(type: .custom)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.tag = index
        button.backgroundColor = .clear
        button.isAccessibilityElement = true
        button.accessibilityLabel = choice.cost.map { "\(choice.label), \($0)" } ?? choice.label
        button.addTarget(self, action: #selector(choiceTapped(_:)), for: .touchUpInside)
        button.addTarget(self, action: #selector(rowDown(_:)), for: .touchDown)
        button.addTarget(
            self, action: #selector(rowUp(_:)),
            for: [.touchUpInside, .touchUpOutside, .touchCancel])

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.numberOfLines = 0
        let text = NSMutableAttributedString(
            string: choice.label,
            attributes: [
                .font: UIFont.systemFont(ofSize: 15, weight: .semibold),
                .foregroundColor: UIColor.label,
            ])
        if choice.camera {
            text.append(
                NSAttributedString(
                    string: "   ON CAMERA",
                    attributes: [
                        .font: UIFont.systemFont(ofSize: 11, weight: .bold),
                        .foregroundColor: GlassKit.action,
                        .kern: 1.2,
                    ]))
        }
        title.attributedText = text
        glass.contentView.addSubview(title)

        var trailing = title.trailingAnchor.constraint(
            equalTo: glass.contentView.trailingAnchor, constant: -16)

        if let cost = choice.cost {
            let chip = UILabel()
            chip.translatesAutoresizingMaskIntoConstraints = false
            chip.attributedText = NSAttributedString(
                string: cost,
                attributes: [
                    // The ledger's own face, monospaced, so a column of costs
                    // lines up the way it does everywhere else in this game —
                    // and a weight up from the old secondary grey, because it
                    // is now being read through a refractive material.
                    .font: UIFont.monospacedSystemFont(ofSize: 12, weight: .semibold),
                    .foregroundColor: UIColor.label,
                ])
            chip.setContentCompressionResistancePriority(.required, for: .horizontal)
            chip.setContentHuggingPriority(.required, for: .horizontal)
            glass.contentView.addSubview(chip)
            NSLayoutConstraint.activate([
                chip.trailingAnchor.constraint(
                    equalTo: glass.contentView.trailingAnchor, constant: -16),
                chip.topAnchor.constraint(equalTo: glass.contentView.topAnchor, constant: 16),
            ])
            trailing = title.trailingAnchor.constraint(
                lessThanOrEqualTo: chip.leadingAnchor, constant: -12)
        }

        glass.contentView.addSubview(button)
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(
                equalTo: glass.contentView.leadingAnchor, constant: 16),
            title.topAnchor.constraint(equalTo: glass.contentView.topAnchor, constant: 14),
            title.bottomAnchor.constraint(
                equalTo: glass.contentView.bottomAnchor, constant: -14),
            trailing,
            button.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor),
            button.topAnchor.constraint(equalTo: glass.contentView.topAnchor),
            button.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor),
            glass.heightAnchor.constraint(greaterThanOrEqualToConstant: 56),
        ])
        return glass
    }

    // ── Scroll ───────────────────────────────────────────────────────────────

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        syncHeader()

        /*
         * Pull-to-dismiss, driven by the scroll view rather than by a pan
         * recogniser on the panel.
         *
         * A second pan competing with the scroll view's own is the usual way
         * to build this, and it means a drag anywhere in the content either
         * scrolls or dismisses depending on which recogniser won — which is
         * exactly the ambiguity a player feels as the sheet being unreliable.
         * Overscroll is unambiguous: past the top there is nothing left to
         * scroll, so the sheet takes the gesture.
         */
        guard spec.dismissible, !answered else { return }
        let pull = max(-scrollView.contentOffset.y, 0)
        panel.transform = CGAffineTransform(translationX: 0, y: pull)
        backdrop.alpha = 1 - min(pull / 400, 0.55)
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        guard spec.dismissible, !answered else { return }
        let pull = max(-scrollView.contentOffset.y, 0)
        if pull > 110 {
            backdropTapped()
            return
        }
        UIView.animate(
            withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0
        ) {
            self.panel.transform = .identity
            self.backdrop.alpha = 1
        }
    }

    private func syncHeader() {
        // Fades in across the 24 points after the title's baseline has gone
        // under the bar, which is short enough to feel like a consequence of
        // the scroll rather than a separate animation.
        let progress = min(max((scroll.contentOffset.y - 34) / 24, 0), 1)
        header.alpha = progress
    }

    // ── Input ────────────────────────────────────────────────────────────────

    @objc private func choiceTapped(_ sender: UIButton) {
        guard !answered else { return }
        answered = true
        selection.selectionChanged()
        let index = sender.tag
        dismissSelf { [weak self] in
            guard let self else { return }
            self.onChoose?(self.spec.id, index)
        }
    }

    /// The same 0.985 the DOM rows use. A choice row is the one control in
    /// this game a player presses without already knowing what it costs, so it
    /// has to answer the finger before it answers the question.
    @objc private func rowDown(_ sender: UIButton) {
        guard let row = rowGlass[sender.tag] else { return }
        UIView.animate(
            withDuration: 0.12, delay: 0, options: [.curveEaseOut, .allowUserInteraction]
        ) {
            row.transform = CGAffineTransform(scaleX: 0.985, y: 0.985)
        }
    }

    @objc private func rowUp(_ sender: UIButton) {
        guard let row = rowGlass[sender.tag] else { return }
        UIView.animate(
            withDuration: 0.16, delay: 0, options: [.curveEaseOut, .allowUserInteraction]
        ) {
            row.transform = .identity
        }
    }

    @objc private func actionTapped() {
        guard !answered else { return }
        answered = true
        dismissSelf { [weak self] in
            guard let self else { return }
            self.onAction?(self.spec.id)
        }
    }

    @objc private func backdropTapped() {
        guard spec.dismissible, !answered else { return }
        answered = true
        dismissSelf { [weak self] in
            guard let self else { return }
            self.onDismissed?(self.spec.id)
        }
    }

    /// Always fires its completion, including when the dismissal is what tore
    /// the controller down — a swallowed completion here is a card the game
    /// thinks is still open.
    private func dismissSelf(_ then: @escaping () -> Void) {
        guard let presenter = presentingViewController else {
            then()
            return
        }
        UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseIn]) {
            self.backdrop.alpha = 0
            self.panel.transform = CGAffineTransform(
                translationX: 0, y: self.panel.bounds.height)
        } completion: { _ in
            presenter.dismiss(animated: false) { then() }
        }
    }

    /// Closed by the game rather than by the player — the run ended, a year
    /// closed, the card was resolved somewhere else.
    func closeWithoutAnswering() {
        answered = true
        presentingViewController?.dismiss(animated: true)
    }
}
