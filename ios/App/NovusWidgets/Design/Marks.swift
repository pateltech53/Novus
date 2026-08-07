import SwiftUI

/**
 The four marks every surface out here is built from.

 They are small on purpose. A widget is redrawn by the system on its own
 schedule, in a process with a hard memory ceiling and no animation, so the
 vocabulary that survives contact with it is: a segmented bar for months, a
 dial for the same, a figure with a label over it, and a meter for a score.
 Everything in this extension is one of those four, arranged differently.

 All four are drawn from the same tokens the app draws itself from, and none of
 them formats a number — `OutsideFigure` carries the app's own string and that
 is what gets rendered. See `NovusPalette.swift`.
 */

// ── Where the corners are ───────────────────────────────────────────────────

/**
 How far in from the edge content has to start to clear a rounded corner.

 ── The geometry ─────────────────────────────────────────────────────────────

 A rounded rectangle does not lose the corner point — it loses everything
 outside an arc, and the deepest bite is along the 45° diagonal. For a corner
 radius `r` the boundary there sits `r − r/√2 ≈ 0.29r` in from the corner on
 both axes, so a straight-edge inset of `p` only clears the corner when
 `p > 0.29r`.

 The expanded Dynamic Island is a very round shape — call it a 44-point radius
 — which puts its diagonal boundary about **13 points** in from each corner.
 SwiftUI adds no inset of its own, and every corner of this layout has a word
 in it, so the first and last glyphs get bitten off at all four.

 ── Why twelve ───────────────────────────────────────────────────────────────

 The clipped region is a quarter-disc, not a square, so a horizontal inset buys
 vertical clearance too. At 12 points in from the left edge the arc has already
 fallen to about 15 points down from the top, and the leading and trailing
 regions sit lower than that anyway — they flank the sensor housing rather than
 starting at the island's ceiling.

 Twelve is also the ceiling on generosity. Each of those regions is only around
 a hundred points wide; take much more and a company's name starts truncating,
 which trades a clipped glyph for a missing one.

 **This is calculated rather than measured** — there is no way to render a
 Dynamic Island outside Xcode. If a corner still bites, this constant is the
 one thing to change, and it is deliberately in one place for that reason.

 The Lock Screen banner is a far gentler shape (about a 22-point radius, so a
 6-point diagonal bite) and its own 13 points of padding already clears it.
 */
enum NvIsland {
    /// Horizontal inset for every expanded region. See above for the 0.29r.
    static let inset: CGFloat = 12
    /// The bottom region sits against the island's lower edge as well.
    static let bottomInset: CGFloat = 4
}

// ── The twelve-segment bar ──────────────────────────────────────────────────

/**
 A fiscal year, as twelve discrete steps.

 Discrete rather than continuous, and that is the whole point: this game is
 played one month at a time, and a smooth progress bar would say the year is
 65% done when the honest statement is that seven of twelve months are behind
 you.

 It is deliberately NOT what a score is drawn with. A stat is a magnitude on a
 hundred-point scale with no steps in it — `ScoreMeter` uses a continuous bar —
 and drawing the two the same way would say they were the same kind of thing.
 */
struct SegmentBar: View {
    /// 0…1. Anything above one stays full.
    let fill: Double
    var segments: Int = 12
    var tint: Color = Nv.action
    var height: CGFloat = 5

    private var lit: Int {
        // Ceil rather than round: a fiscal year one day in has started, and a
        // bar that reads empty says something the calendar does not.
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

/**
 The same figure on one line, for the places that do not have three lines.

 ── Why this exists rather than a smaller `FigureCell` ───────────────────────

 The expanded Dynamic Island is capped at 160 points tall, and that ceiling is
 not a guideline: content past it is CLIPPED, silently, with no layout warning
 and nothing on screen to say a number was cut in half. `FigureCell` is three
 lines — label, figure, month-over-month — and two of them side by side cost
 about 42 points. Shrinking the type to fit would take the label under the 12px
 floor design.md sets.

 So the delta is what goes. It is the least of the three: on a surface a player
 glances at between sessions, "$412K" is the fact and "−$18K since last month"
 is a footnote that the app itself tells them properly the moment they open it.
 */
struct InlineFigure: View {
    let label: String
    let figure: OutsideFigure
    var size: CGFloat = 14
    var tint: Color = Nv.primary

    var body: some View {
        HStack(spacing: 5) {
            Text(label)
                .font(NvType.label(9, weight: .bold))
                .tracking(0.5)
                .foregroundStyle(Nv.tertiary)
                .lineLimit(1)
            Text(figure.text)
                .font(NvType.figure(size, weight: .bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

// ── The score ───────────────────────────────────────────────────────────────

/**
 One of the five, as a label, a number and a bar.

 ── Why the number is banded and the three are not hued ──────────────────────

 `components/StatRings.tsx` settled one half of this and the reasoning
 transfers verbatim: the three rings once carried the action orange, the
 solvency green and the prestige gold, which spent three brand colours on what
 is really one magnitude shown three times. The accent is the primary call to
 action and nothing else; solvency is financial upside only, and morale is not
 money. So Brand, Quality and Morale are never three different colours from
 each other — that rule holds here.

 What they DO carry is one scale applied to each of them, which is a different
 statement: not "this is the brand one", but "this one has fallen past the line
 the engine acts on". Under 45 is `alert` because that is where
 `weakestCategory()` in lib/engine/events.ts starts aiming events at a stat;
 above 70 is full-weight ink; between them is a step quieter. Three figures
 read as a shape rather than as arithmetic, which is the whole reason there are
 three of them.

 `OutsideScore.tint` is the single definition, shared with `ScoreChip` so that
 the same number is never a different colour in a meter than it is in the
 island.
 */
struct ScoreMeter: View {
    let score: OutsideScore
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 1 : 2) {
            HStack(spacing: 0) {
                Text(score.label)
                    .font(NvType.label(compact ? 8 : 9, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(Nv.tertiary)
                    .lineLimit(1)
                Spacer(minLength: 3)
                Text("\(score.value)")
                    .font(NvType.figure(compact ? 11 : 13, weight: .bold))
                    .foregroundStyle(score.tint)
            }

            // A continuous bar, not the twelve-tick one. A stat is a magnitude
            // on a hundred-point scale and has no steps in it; the segmented
            // bar means "months", and using it here would say the two were the
            // same kind of thing.
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule(style: .continuous)
                        .fill(Nv.hairline)
                    Capsule(style: .continuous)
                        .fill(score.tint)
                        .frame(width: max(2, geo.size.width * score.fill))
                }
            }
            .frame(height: compact ? 3 : 4)
        }
    }
}

// ── The score, at four characters ───────────────────────────────────────────

/**
 One score as an initial and a number — `B61` — for the compact Dynamic Island.

 ── Why an initial ───────────────────────────────────────────────────────────

 The compact trailing slot is about sixty points wide and it has to hold three
 of these. "BRAND" does not fit next to "QUALITY" and "MORALE" at any size that
 is still type. An initial does, and it is unambiguous in this set: B, Q and M
 share no first letter, and they are always drawn in that order, so the letter
 is a position as much as a name.

 ── The colour, and the one it is not ────────────────────────────────────────

 The number is banded, which is what makes three figures readable as a state
 rather than as arithmetic:

 · **under 45** — `alert`. Not a threshold picked for a widget: it is the line
   `weakestCategory()` draws in lib/engine/events.ts, below which the engine
   starts aiming events at that stat.
 · **45 to 69** — `secondary`. Fine, and not worth looking at.
 · **70 and up** — `primary`, at full weight. Strong.

 There is no green in that list and its absence is the design, not an omission.
 `design.md` gives solvency green to financial upside and nothing else, and a
 high morale score is not money. Red-to-grey-to-white is a real scale on the
 island's black ground — arguably a stronger one than a hue ramp, because the
 Lock Screen renders accessory content in `.vibrant` and hue is the first thing
 it takes away.
 */
struct ScoreChip: View {
    let score: OutsideScore
    var size: CGFloat = 12

    var body: some View {
        HStack(spacing: 0.5) {
            // The initial rides a step quieter than the number: it is the
            // label, and the figure is the news.
            Text(String(score.label.prefix(1)))
                .font(NvType.label(size - 3, weight: .black))
                .foregroundStyle(Nv.tertiary)
            Text("\(score.value)")
                .font(NvType.figure(size, weight: .bold))
                .foregroundStyle(score.tint)
        }
        .lineLimit(1)
    }
}

extension OutsideScore {
    /// The three-band scale. See `ScoreChip` for why there is no green in it.
    var tint: Color {
        if value < 45 { return Nv.alert }
        if value < 70 { return Nv.secondary }
        return Nv.primary
    }
}

/// The trio, side by side. Brand, Quality, Morale — the masthead's own three.
struct ScoreRow: View {
    let company: OutsideCompany
    var compact = false

    var body: some View {
        HStack(alignment: .top, spacing: compact ? 8 : 10) {
            ForEach(company.headlineScores, id: \.label) { score in
                ScoreMeter(score: score, compact: compact)
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
     · **Under pressure** — alert. The weakest of the five is below 45, which
       is where the engine starts aiming events at it.
     · Otherwise the action orange, which is the app's own answer to "this is
       the thing that wants you".
     */
    var accent: Color {
        if !alive { return Nv.tertiary }
        if atGate { return Nv.prestige }
        if underPressure { return Nv.alert }
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
        // Names the stat rather than saying "under pressure", because the
        // player can do something about "MORALE LOW" and nothing about a mood.
        if underPressure, let weakest { return "\(weakest.label) LOW" }
        return stageName.uppercased()
    }
}
