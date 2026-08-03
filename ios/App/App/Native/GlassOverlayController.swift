import UIKit

// ── What the web layer asks for ──────────────────────────────────────────────

/// One control in an overlay's chrome. The same shape wherever it appears —
/// a circle in the top cluster, a capsule in the bottom dock — because the
/// difference between those is where it was put, not what it is.
struct OverlayButton {
    let id: String
    /// Shown when there is room for words. A dock button always has one.
    let title: String?
    /// SF Symbol. The whole content of a top-cluster circle.
    let symbol: String?
    /// What it reads as out loud. Required: a glyph is not a name.
    let label: String
    /// "plain" | "prominent" | "prestige" | "destructive"
    let style: String
    let enabled: Bool
}

struct OverlaySegment {
    let id: String
    let title: String
}

struct OverlayState {
    /// "shown" | "hidden"
    let mode: String
    let theme: String
    /// The screen's name, on a glass plate between the two clusters.
    let title: String?
    /// A small line above it. Company is the caller that has one.
    let eyebrow: String?
    let leading: [OverlayButton]
    let trailing: [OverlayButton]
    let segments: [OverlaySegment]
    let activeSegment: String?
    /// The floating dock at the bottom. One prominent control at most.
    let actions: [OverlayButton]
}

/// What the overlay reserves, in points — one CSS pixel each in this webview.
struct OverlayInsets {
    var top: CGFloat = 0
    var bottom: CGFloat = 0
}

/**
 The chrome for everything that is not the play screen.

 ── Why this exists ─────────────────────────────────────────────────────────

 `GlassChromeController` draws the play screen: a tab bar, the capsule that
 moves time, and the cluster over the masthead. It is the system's own Liquid
 Glass and it is the best thing in the app.

 And it was the only thing in the app. Every screen this game has — the six
 activity screens, the closet, settings, the in-fiction phone, the panel room,
 onboarding, the year-end statement — is a full-screen web overlay, and a
 native view always composites above the webview, so the moment one opened the
 chrome had to go away (`mode: "hidden"`). Which meant: the further into the
 app a player got, the less Liquid Glass there was, until there was none. The
 material was a feature of one screen rather than a property of the app.

 This is the other half. Same three rules as the play chrome, same measured
 insets, same degradation — a floating glass toolbar at the top, a segmented
 control under it where a screen has one, and a floating glass dock at the
 bottom for what the screen is asking you to do. All of it real
 `UIGlassEffect`, all of it composited by the OS, none of it approximated.

 ── What the web layer keeps ────────────────────────────────────────────────

 Its content, and all of it. This owns the chrome — the way out, the title, the
 filter, the primary action — and reports what it took so the screen underneath
 reserves exactly that and nothing is occluded. A screen that declares no
 chrome gets none and pays nothing.
 */
final class GlassOverlayController: NSObject {

    // ── Callbacks ────────────────────────────────────────────────────────────

    var onAction: ((String) -> Void)?
    var onSegment: ((String) -> Void)?
    var onInsetsChanged: ((OverlayInsets) -> Void)?

    // ── Views ────────────────────────────────────────────────────────────────

    private let host = PassthroughView()

    /// The top row: a cluster, a title plate, a spacer, a cluster.
    private let topRow = PassthroughStackView()
    private let leadingStack = PassthroughStackView()
    private let trailingStack = PassthroughStackView()
    private var leadingGroup: UIVisualEffectView?
    private var trailingGroup: UIVisualEffectView?

    private var titlePlate: UIVisualEffectView?
    private let titleColumn = UIStackView()
    private let eyebrowLabel = UILabel()
    private let titleLabel = UILabel()

    /// Takes whatever width the two clusters and the title do not.
    private let spacer = UIView()

    private let segmentStack = PassthroughStackView()
    private var segmentGroup: UIVisualEffectView?

    private let dock = PassthroughStackView()
    private var dockGroup: UIVisualEffectView?

    // ── State ────────────────────────────────────────────────────────────────

    private var installed = false
    private var lastInsets = OverlayInsets()
    private var current: OverlayState?
    private var segmentControls: [String: GlassControl] = [:]
    /// What the row is currently built out of, so a selection change can
    /// re-light the existing controls instead of replacing them.
    private var segmentIds: [String] = []

    private enum Metric {
        static let sideMargin: CGFloat = 16
        static let clusterInset: CGFloat = 20
        static let topGap: CGFloat = 8
        static let circle: CGFloat = 40
        static let rowSpacing: CGFloat = 8
        static let segmentHeight: CGFloat = 38
        static let dockHeight: CGFloat = 52
        static let dockBottomGap: CGFloat = 12
        static let titlePadding: CGFloat = 14
    }

    // ── Install ──────────────────────────────────────────────────────────────

    /// Idempotent, for the same reason the play chrome's is: `configure` runs on
    /// every launch of the web layer, live reloads included, and must not end
    /// up with two docks stacked on each other.
    @discardableResult
    func install(in parent: UIView) -> OverlayInsets {
        guard !installed else { return measure() }
        installed = true

        host.translatesAutoresizingMaskIntoConstraints = false
        host.backgroundColor = .clear
        parent.addSubview(host)
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
            host.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
            host.topAnchor.constraint(equalTo: parent.topAnchor),
            host.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
        ])

        buildTopRow()
        buildSegments()
        buildDock()

        host.onLayout = { [weak self] in
            guard let self, self.current?.mode == "shown" else { return }
            let next = self.measure()
            guard
                abs(next.top - self.lastInsets.top) > 0.5
                    || abs(next.bottom - self.lastInsets.bottom) > 0.5
            else { return }
            self.lastInsets = next
            self.onInsetsChanged?(next)
        }

        setHidden(true)
        host.layoutIfNeeded()
        return measure()
    }

    private func buildTopRow() {
        for stack in [leadingStack, trailingStack] {
            stack.axis = .horizontal
            stack.spacing = Metric.rowSpacing
            stack.alignment = .center
            stack.translatesAutoresizingMaskIntoConstraints = false
        }

        // The title, on its own plate.
        //
        // A screen's name floating unbacked over its content is unreadable the
        // moment the content scrolls anything pale underneath it. A plate is
        // also what makes the row read as a toolbar rather than as two clusters
        // with a caption between them.
        let plate = GlassKit.panel(corner: Metric.circle / 2, interactive: false, tint: nil)
        titlePlate = plate

        titleColumn.axis = .vertical
        titleColumn.spacing = 0
        titleColumn.alignment = .leading
        titleColumn.translatesAutoresizingMaskIntoConstraints = false
        titleColumn.addArrangedSubview(eyebrowLabel)
        titleColumn.addArrangedSubview(titleLabel)
        plate.contentView.addSubview(titleColumn)
        NSLayoutConstraint.activate([
            titleColumn.leadingAnchor.constraint(
                equalTo: plate.contentView.leadingAnchor, constant: Metric.titlePadding),
            titleColumn.trailingAnchor.constraint(
                equalTo: plate.contentView.trailingAnchor, constant: -Metric.titlePadding),
            titleColumn.centerYAnchor.constraint(equalTo: plate.contentView.centerYAnchor),
            plate.heightAnchor.constraint(equalToConstant: Metric.circle),
        ])
        // The plate is as wide as its title and no wider, and it is the first
        // thing to give way when a screen declares more buttons than fit.
        plate.setContentHuggingPriority(.required, for: .horizontal)
        plate.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        titleLabel.lineBreakMode = .byTruncatingTail

        spacer.translatesAutoresizingMaskIntoConstraints = false
        spacer.backgroundColor = .clear
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        spacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        // A view with no intrinsic size in a `.center`-aligned stack is
        // otherwise ambiguous vertically. It is a gap, so the answer is zero.
        spacer.heightAnchor.constraint(equalToConstant: 0).isActive = true

        topRow.axis = .horizontal
        topRow.alignment = .center
        topRow.distribution = .fill
        topRow.spacing = Metric.rowSpacing
        topRow.translatesAutoresizingMaskIntoConstraints = false

        // Each cluster goes inside a container where the OS has one, so a row
        // of glass circles merges and separates as one control group rather
        // than reading as several unrelated panes near each other.
        let leadingBox = boxed(leadingStack)
        let trailingBox = boxed(trailingStack)
        leadingGroup = leadingBox.group
        trailingGroup = trailingBox.group

        // The spacer is the ONLY thing in this row allowed to grow.
        //
        // `.fill` hands the slack to whichever arranged subview hugs least, and
        // a cluster and a spacer both sitting at the default 250 is a tie the
        // stack breaks by index — which puts 200pt of empty glass on the left
        // of the toolbar and the close button somewhere near the middle.
        for box in [leadingBox.view, trailingBox.view] {
            box.setContentHuggingPriority(.required, for: .horizontal)
            box.setContentCompressionResistancePriority(.required, for: .horizontal)
        }
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)

        topRow.addArrangedSubview(leadingBox.view)
        topRow.addArrangedSubview(plate)
        topRow.addArrangedSubview(spacer)
        topRow.addArrangedSubview(trailingBox.view)

        host.addSubview(topRow)
        NSLayoutConstraint.activate([
            topRow.leadingAnchor.constraint(
                equalTo: host.leadingAnchor, constant: Metric.clusterInset),
            topRow.trailingAnchor.constraint(
                equalTo: host.trailingAnchor, constant: -Metric.clusterInset),
            topRow.topAnchor.constraint(
                equalTo: host.safeAreaLayoutGuide.topAnchor, constant: Metric.topGap),
        ])
    }

    /// Wraps a stack in a `UIGlassContainerEffect` where the OS has one, and
    /// hands back both the view to lay out and the container to hide with it —
    /// an empty glass group is a visible smudge over whatever is behind it.
    private func boxed(_ stack: UIStackView) -> (view: UIView, group: UIVisualEffectView?) {
        guard let group = GlassKit.container(spacing: Metric.rowSpacing) else {
            return (stack, nil)
        }
        group.contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: group.contentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: group.contentView.trailingAnchor),
            stack.topAnchor.constraint(equalTo: group.contentView.topAnchor),
            stack.bottomAnchor.constraint(equalTo: group.contentView.bottomAnchor),
        ])
        return (group, group)
    }

    private func buildSegments() {
        segmentStack.axis = .horizontal
        segmentStack.spacing = 4
        segmentStack.alignment = .fill
        segmentStack.distribution = .fillEqually
        segmentStack.translatesAutoresizingMaskIntoConstraints = false

        let wrapped = boxed(segmentStack)
        segmentGroup = wrapped.group
        let box = wrapped.view
        host.addSubview(box)
        NSLayoutConstraint.activate([
            box.leadingAnchor.constraint(
                equalTo: host.leadingAnchor, constant: Metric.clusterInset),
            box.trailingAnchor.constraint(
                equalTo: host.trailingAnchor, constant: -Metric.clusterInset),
            box.topAnchor.constraint(equalTo: topRow.bottomAnchor, constant: Metric.rowSpacing),
        ])
    }

    private func buildDock() {
        dock.axis = .horizontal
        dock.spacing = Metric.rowSpacing
        dock.alignment = .fill
        // Equal widths. A dock of two where one is 60% of the row is a
        // judgement about which matters more that the web layer has already
        // made by choosing which one is prominent.
        dock.distribution = .fillEqually
        dock.translatesAutoresizingMaskIntoConstraints = false

        let wrapped = boxed(dock)
        dockGroup = wrapped.group
        let box = wrapped.view
        host.addSubview(box)
        NSLayoutConstraint.activate([
            box.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: Metric.sideMargin),
            box.trailingAnchor.constraint(
                equalTo: host.trailingAnchor, constant: -Metric.sideMargin),
            box.bottomAnchor.constraint(
                equalTo: host.safeAreaLayoutGuide.bottomAnchor,
                constant: -Metric.dockBottomGap),
        ])
    }

    // ── Apply ────────────────────────────────────────────────────────────────

    @discardableResult
    func apply(_ state: OverlayState) -> OverlayInsets {
        current = state

        // The game's theme is its own, independent of the phone's. Without
        // this a dark screen under a light-mode phone gets a light toolbar
        // bolted to the top of it.
        host.overrideUserInterfaceStyle = state.theme == "dark" ? .dark : .light

        applyTitle(state.title, eyebrow: state.eyebrow)
        applyCluster(state.leading, into: leadingStack)
        applyCluster(state.trailing, into: trailingStack)
        applySegments(state.segments, active: state.activeSegment)
        applyDock(state.actions)

        setHidden(state.mode != "shown")

        // Above the play chrome, always. Both are subviews of the same parent
        // and the play chrome installs first, so without this a dock would
        // render underneath a tab bar that is on its way out.
        host.superview?.bringSubviewToFront(host)
        host.layoutIfNeeded()

        // Unlike the play chrome, a hidden overlay reserves nothing. Its
        // reservation exists for a screen that is on screen; when the screen
        // has gone there is nothing underneath still laying out around it.
        lastInsets = state.mode == "shown" ? measure() : OverlayInsets()
        return lastInsets
    }

    private func setHidden(_ hidden: Bool) {
        leadingStack.isHidden = hidden || leadingStack.arrangedSubviews.isEmpty
        trailingStack.isHidden = hidden || trailingStack.arrangedSubviews.isEmpty
        leadingGroup?.isHidden = leadingStack.isHidden
        trailingGroup?.isHidden = trailingStack.isHidden

        titlePlate?.isHidden = hidden || (titleLabel.text?.isEmpty ?? true)

        segmentStack.isHidden = hidden || segmentStack.arrangedSubviews.isEmpty
        segmentGroup?.isHidden = segmentStack.isHidden

        dock.isHidden = hidden || dock.arrangedSubviews.isEmpty
        dockGroup?.isHidden = dock.isHidden

        // The whole row goes when every part of it has: an empty stack view
        // still takes its spacing, and that spacing is measurable inset over
        // a screen that declared no chrome at all.
        topRow.isHidden =
            (leadingStack.isHidden) && (trailingStack.isHidden)
            && (titlePlate?.isHidden ?? true)
    }

    private func applyTitle(_ title: String?, eyebrow: String?) {
        let hasEyebrow = !(eyebrow ?? "").isEmpty
        eyebrowLabel.isHidden = !hasEyebrow
        if let eyebrow, hasEyebrow {
            eyebrowLabel.attributedText = NSAttributedString(
                string: eyebrow.uppercased(),
                attributes: [
                    .font: UIFont.systemFont(ofSize: 10, weight: .bold),
                    .foregroundColor: UIColor.tertiaryLabel,
                    .kern: 1.2,
                ])
        }

        titleLabel.attributedText = NSAttributedString(
            string: title ?? "",
            attributes: [
                .font: UIFont.systemFont(ofSize: hasEyebrow ? 14 : 15, weight: .bold),
                .foregroundColor: UIColor.label,
                .kern: -0.1,
            ])
    }

    private func applyCluster(_ buttons: [OverlayButton], into stack: UIStackView) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        for spec in buttons {
            let control = make(spec)
            // A circle when it is a glyph on its own, a capsule when it has
            // words in it. Both are `Metric.circle` tall, so a mixed cluster
            // sits on one baseline.
            control.heightAnchor.constraint(equalToConstant: Metric.circle).isActive = true
            if spec.title?.isEmpty ?? true {
                control.widthAnchor.constraint(equalToConstant: Metric.circle).isActive = true
            } else {
                control.widthAnchor
                    .constraint(greaterThanOrEqualToConstant: Metric.circle).isActive = true
            }
            control.set(
                title: spec.title, symbol: spec.symbol, size: 15,
                weight: .semibold)
            stack.addArrangedSubview(control)
        }
    }

    /**
     The filter row.

     Rebuilt only when the segments themselves change, never when the selection
     does — the same rule `applyTabs` follows on the play chrome, and here it is
     load-bearing rather than an optimisation. Choosing a segment pushes a new
     state back across the bridge with a new `activeSegment`, so a rebuild on
     every selection would destroy the very control the player still has a
     finger on, halfway through its press animation.
     */
    private func applySegments(_ segments: [OverlaySegment], active: String?) {
        let ids = segments.map(\.id)
        if ids != segmentIds {
            segmentIds = ids
            segmentStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            segmentControls.removeAll()

            for segment in segments {
                let control = GlassKit.button(prominent: false, tint: nil, ink: .secondaryLabel)
                control.heightAnchor
                    .constraint(equalToConstant: Metric.segmentHeight).isActive = true
                control.set(title: segment.title, symbol: nil, size: 13, weight: .semibold)
                control.setAccessibility(segment.title)
                control.onTap = { [weak self] in self?.onSegment?(segment.id) }
                segmentControls[segment.id] = control
                segmentStack.addArrangedSubview(control)
            }
        }

        // The selected segment is the lit one — a piece of material inside a
        // dimmer track, which is the distinction the system's own segmented
        // control draws. Never a colour swap: that would spend the accent on a
        // filter, and the accent belongs to the control that asks you to act.
        for (id, control) in segmentControls {
            let on = id == active
            control.setProminent(on, ink: on ? .label : .secondaryLabel)
            control.button.accessibilityTraits = on ? [.button, .selected] : [.button]
        }
    }

    private func applyDock(_ actions: [OverlayButton]) {
        dock.arrangedSubviews.forEach { $0.removeFromSuperview() }

        for spec in actions {
            let control = make(spec)
            control.heightAnchor.constraint(equalToConstant: Metric.dockHeight).isActive = true
            control.set(title: spec.title, symbol: spec.symbol, size: 16, weight: .bold)
            dock.addArrangedSubview(control)
        }
    }

    /// One control, whichever cluster it is going into. Style decides the
    /// material and the ink; everything else is where the caller puts it.
    private func make(_ spec: OverlayButton) -> GlassControl {
        let prominent = spec.style == "prominent" || spec.style == "prestige"
            || spec.style == "destructive"

        let tint: UIColor?
        let ink: UIColor?
        switch spec.style {
        case "prominent":
            tint = GlassKit.action
            ink = .white
        case "prestige":
            tint = GlassKit.prestige
            ink = GlassKit.onPrestige
        case "destructive":
            tint = .systemRed
            ink = .white
        default:
            tint = nil
            ink = .label
        }

        let control = GlassKit.button(prominent: prominent, tint: tint, ink: ink)
        control.setAccessibility(spec.label)
        control.setEnabled(spec.enabled)
        control.onTap = { [weak self] in self?.onAction?(spec.id) }
        return control
    }

    // ── Measurement ──────────────────────────────────────────────────────────

    /**
     What the screen underneath must leave empty, read off the laid-out frames.

     Measured, never assumed — the same rule the play chrome is built on, and
     for the same reason: a toolbar that comes out 4pt taller on some device
     than a constant predicted is a toolbar sitting on top of the first line of
     the screen it belongs to.
     */
    private func measure() -> OverlayInsets {
        var insets = OverlayInsets()
        let height = host.bounds.height
        guard height > 0 else { return insets }

        var top: CGFloat = 0
        if !topRow.isHidden, topRow.frame.height > 0 {
            top = topRow.frame.maxY
        }
        if !segmentStack.isHidden {
            let box = segmentGroup ?? segmentStack
            if box.frame.height > 0 { top = max(top, box.frame.maxY) }
        }
        if top > 0 { insets.top = top + Metric.topGap }

        if !dock.isHidden {
            let box = dockGroup ?? dock
            if box.frame.height > 0 {
                insets.bottom = height - box.frame.minY + Metric.dockBottomGap
            }
        }

        return insets
    }
}
