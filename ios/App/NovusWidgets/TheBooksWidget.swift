import SwiftUI
import WidgetKit

/**
 The Books, on the home screen.

 The same four figures the play screen carries — cash, monthly burn, runway,
 valuation — drawn on solid ground, because `design.md` §0 is unambiguous about
 it: glass is a material for the control layer, and **money is read on solid
 ground**. A widget is content. There is no glass anywhere in this bundle and
 that is a rule, not an omission.

 ── Why runway is the hero on the small size ─────────────────────────────────

 The small widget has room for one number and a supporting line, and the
 question a founder actually has between sessions is not "what is my company
 worth" — it is "how long have I got". Valuation is the number a run is scored
 on and runway is the number that decides whether there is a run left to score.
 So the small size leads with runway and its twelve-segment gauge, and hangs
 cash underneath as the thing runway is made of.

 The medium size has room for all four and the twelve-month line, which is The
 Books as the app draws it.
 */
struct TheBooksWidget: Widget {
    static let kind = "com.novuspitch.widget.books"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            TheBooksView(snapshot: entry.snapshot)
                .containerBackground(Nv.bg, for: .widget)
        }
        .configurationDisplayName("The Books")
        .description("Cash, burn, runway and valuation — and how long you have got.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct TheBooksView: View {
    let snapshot: OutsideSnapshot
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let company = snapshot.company {
            switch family {
            case .systemMedium: BooksMedium(company: company)
            default: BooksSmall(company: company)
            }
        } else {
            NoCompany(compact: family == .systemSmall)
        }
    }
}

// ── Small ───────────────────────────────────────────────────────────────────

private struct BooksSmall: View {
    let company: OutsideCompany

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CompanyEyebrow(company: company, trailing: "FY\(company.year)")

            Spacer(minLength: 8)

            Text("RUNWAY")
                .font(NvType.label(9, weight: .bold))
                .tracking(0.6)
                .foregroundStyle(Nv.tertiary)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(company.runway.text)
                    .font(NvType.figure(34, weight: .bold))
                    .foregroundStyle(company.isRedline ? Nv.alert : Nv.primary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)

                if let delta = company.runway.deltaText {
                    Text(delta)
                        .font(NvType.figure(11, weight: .semibold))
                        .foregroundStyle(Nv.tone(company.runway.deltaTone))
                }
            }

            SegmentBar(fill: company.runwayFill, tint: company.accent)
                .padding(.top, 6)

            Spacer(minLength: 8)

            HStack(spacing: 0) {
                Text("CASH")
                    .font(NvType.label(9, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(Nv.tertiary)
                Spacer(minLength: 6)
                Text(company.cash.text)
                    .font(NvType.figure(13, weight: .bold))
                    .foregroundStyle(Nv.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // The gate is a different destination from the board, even though both
        // land on the same screen: the link says why you were sent there.
        .widgetURL(URL(string: "\(OutsideStore.scheme)://\(company.atGate ? "gate" : "play")"))
    }
}

// ── Medium ──────────────────────────────────────────────────────────────────

private struct BooksMedium: View {
    let company: OutsideCompany

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                CompanyEyebrow(company: company)
                Spacer(minLength: 6)
                Text(company.statusLine)
                    .font(NvType.label(9, weight: .black))
                    .tracking(0.7)
                    .foregroundStyle(company.accent)
                Text("FY\(company.year)")
                    .font(NvType.figure(10, weight: .semibold))
                    .foregroundStyle(Nv.tertiary)
            }

            Spacer(minLength: 10)

            HStack(alignment: .top, spacing: 0) {
                FigureCell(label: "CASH", figure: company.cash)
                Spacer(minLength: 4)
                FigureCell(label: "BURN / MO", figure: company.burn)
                Spacer(minLength: 4)
                FigureCell(
                    label: "RUNWAY", figure: company.runway,
                    tint: company.isRedline ? Nv.alert : Nv.primary)
                Spacer(minLength: 4)
                FigureCell(label: "VALUATION", figure: company.valuation)
            }

            Spacer(minLength: 10)

            /*
             The line under the figures is VALUATION, not cash.

             Cash is already told twice above — the figure and its change — and
             it is the series that moves most per month, so a cash line under a
             cash figure is the same fact drawn twice in two materials. The
             valuation series is the only thing on this card that says which
             way the company as a whole has been going.
             */
            HStack(alignment: .bottom, spacing: 8) {
                SparklineMark(
                    points: company.valuationSeries,
                    tint: company.alive ? Nv.solvency : Nv.tertiary)
                    .frame(height: 26)

                VStack(alignment: .trailing, spacing: 1) {
                    Text("12 MONTHS")
                        .font(NvType.label(8, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(Nv.tertiary)
                    Text("PEAK \(company.peakValuationText)")
                        .font(NvType.figure(9, weight: .semibold))
                        .foregroundStyle(Nv.secondary)
                }
                .fixedSize()
            }

            SegmentBar(fill: Double(company.monthsElapsed) / 12, tint: company.accent, height: 3)
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "\(OutsideStore.scheme)://\(company.atGate ? "gate" : "play")"))
    }
}
