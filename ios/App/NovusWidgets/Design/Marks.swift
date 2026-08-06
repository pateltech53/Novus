import SwiftUI

/**
 The four marks every surface out here is built from.

 They are small on purpose. A widget is redrawn by the system on its own
 schedule, in a process with a hard memory ceiling and no animation, so the
 vocabulary that survives contact with it is: a bar, a dial, a line, and a
 figure with a label over it. Everything in this extension is one of those
 four, arranged differently.

 All four are drawn from the same tokens the app draws itself from, and none of
 them formats a number — `OutsideFigure` carries the app's own string and that
 is what gets rendered. See `NovusPalette.swift`.
 */

// ── The twelve-segment bar ──────────────────────────────────────────────────

/**
 A fiscal year, or a year of runway, as twelve discrete steps.

 Discrete rather than continuous, and that is the whole point: this game is
 played one month at a time, and a smooth progress bar would say the year is
 65% done when the honest statement is that seven of twelve months are behind
 you. The Books draws runway on exactly this scale — a full bar is a fiscal
 year of it — so the two bars are directly comparable, which is the question a
 player actually has in month nine.
 */
struct SegmentBar: View {
    /// 0…1. Anything above one stays full.
    let fill: Double
    var segments: Int = 12
    var tint: Color = Nv.action
    var height: CGFloat = 5

    private var lit: Int {
        // Ceil rather than round: a company with two weeks of runway left has
        // some, and a bar that reads empty says something the numbers do not.
        max(0, min(segments, Int(ceil(fill * Double(segments)))))
    }

    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(0..<segments, id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(index < lit ? tint : Nv.hairline)
            }
        }
        .frame(height: height)
    }
}

// ── The dial ────────────────────────────────────────────────────────────────

/**
 The same twelve steps, as a ring, with room in the middle for what they are
 counting.

 Ticks rather than an arc for the reason above, and a gap at the top rather
 than a closed ring: a closed ring reads as a completed thing, and a fiscal
 year that has not been pitched is the opposite of complete.
 */
struct MonthDial<Center: View>: View {
    /// How many of the twelve are behind you. Clamped by the caller.
    let elapsed: Int
    var tint: Color = Nv.action
    var lineWidth: CGFloat = 3.5
    @ViewBuilder var center: () -> Center

    private let segments = 12

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            ZStack {
                ForEach(0..<segments, id: \.self) { index in
                    Capsule(style: .continuous)
                        .fill(index < elapsed ? tint : Nv.hairline)
                        .frame(width: lineWidth, height: side * 0.11)
                        // Twelve o'clock is month one, and the year runs
                        // clockwise, which is the only direction a year has
                        // ever run on a dial.
                        .offset(y: -(side / 2 - side * 0.055))
                        .rotationEffect(.degrees(Double(index) / Double(segments) * 360))
                }
                center()
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// ── The line ────────────────────────────────────────────────────────────────

/**
 Twelve months of one figure, as the shape it made.

 No axis, no grid, no labels — the number it ends on is printed beside it and
 the line exists to say which way the company has been going. Normalised to its
 own range rather than to zero, because a valuation that moved from $4.0M to
 $4.1M is a line with a slope on it and a flat line drawn from zero.

 Draws nothing below two points. The ledger makes that distinction
 deliberately (see `SPARK_MIN_POINTS` in lib/engine/ledger.ts) and a lone dot
 pretending to be a trend is worse than an empty space.
 */
struct Sparkline: Shape {
    let points: [Double]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard points.count >= 2 else { return path }

        let low = points.min() ?? 0
        let high = points.max() ?? 0
        let span = high - low
        // A perfectly flat series is a real state — a company that did not
        // move — and dividing by its zero range is not. It draws down the
        // middle, which is what flat looks like.
        let y = { (value: Double) -> CGFloat in
            let t = span > 0 ? (value - low) / span : 0.5
            return rect.maxY - CGFloat(t) * rect.height
        }
        let step = rect.width / CGFloat(points.count - 1)

        path.move(to: CGPoint(x: rect.minX, y: y(points[0])))
        for (index, value) in points.enumerated().dropFirst() {
            path.addLine(to: CGPoint(x: rect.minX + CGFloat(index) * step, y: y(value)))
        }
        return path
    }
}

/// The line, its tint, and the wash under it. One view so no caller has to
/// remember that the fill needs the line closed to the baseline and the stroke
/// does not.
struct SparklineMark: View {
    let points: [Double]
    var tint: Color = Nv.solvency
    var lineWidth: CGFloat = 1.5

    var body: some View {
        ZStack {
            Sparkline(points: points)
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
        }
        .opacity(points.count >= 2 ? 1 : 0)
    }
}

// ── The figure ──────────────────────────────────────────────────────────────

/**
 One number as The Books draws it: a small label above, the figure, and the
 month-over-month change under it.

 `value` and `delta` are strings the app produced. Nothing here formats
 anything — see the note at the top of lib/outside/snapshot.ts for why that is
 a rule rather than a convenience.
 */
struct FigureCell: View {
    let label: String
    let figure: OutsideFigure
    var size: CGFloat = 17
    var tint: Color = Nv.primary
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        VStack(alignment: alignment, spacing: 1) {
            Text(label)
                .font(NvType.label(9, weight: .bold))
                .tracking(0.6)
                .foregroundStyle(Nv.tertiary)
                .lineLimit(1)

            Text(figure.text)
                .font(NvType.figure(size, weight: .bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            // Absent, not "+$0", when there is nothing to compare against. The
            // ledger draws that distinction and flattening it here would make
            // a fresh company look like a stalled one.
            if let delta = figure.deltaText {
                Text(delta)
                    .font(NvType.figure(9, weight: .semibold))
                    .foregroundStyle(Nv.tone(figure.deltaTone))
                    .lineLimit(1)
            }
        }
    }
}

// ── The eyebrow ─────────────────────────────────────────────────────────────

/// Which company, and where in its year. Every surface out here opens with it.
struct CompanyEyebrow: View {
    let company: OutsideCompany
    var trailing: String?

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: company.symbol)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(company.atGate ? Nv.prestige : Nv.action)

            Text(company.name.uppercased())
                .font(NvType.label(10, weight: .bold))
                .tracking(0.7)
                .foregroundStyle(Nv.secondary)
                .lineLimit(1)

            if let trailing {
                Spacer(minLength: 4)
                Text(trailing)
                    .font(NvType.figure(10, weight: .semibold))
                    .foregroundStyle(Nv.tertiary)
                    .lineLimit(1)
            }
        }
    }
}

// ── The state a company is in ───────────────────────────────────────────────

extension OutsideCompany {
    /**
     The one colour this company is currently about.

     Three states and a strict order of precedence, because they can all be
     true at once and only one of them can be the colour of the card:

     · **Gone** — grey. A dead company is a record, not an alarm.
     · **At the gate** — prestige gold. Month twelve, and the fiscal year does
       not close without a scored camera performance.
     · **Redline** — alert. Under three months of runway.
     · Otherwise the action orange, which is the app's own answer to "this is
       the thing that wants you".
     */
    var accent: Color {
        if !alive { return Nv.tertiary }
        if atGate { return Nv.prestige }
        if isRedline { return Nv.alert }
        return Nv.action
    }

    /// What the card says it is, in two or three words. Never a sentence.
    var statusLine: String {
        if !alive {
            switch endedBy {
            case "chapter7": return "CHAPTER 7"
            case "acquired": return "ACQUIRED"
            case "ipo": return "PUBLIC"
            default: return "CLOSED"
            }
        }
        if atGate { return "PITCH DUE" }
        if isRedline { return "RUNWAY SHORT" }
        return stageName.uppercased()
    }
}
