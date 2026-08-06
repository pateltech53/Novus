import SwiftUI
import WidgetKit

/**
 The Books, on the home screen.

 The company's three scores and what it is worth, drawn on solid ground,
 because `design.md` §0 is unambiguous about it: glass is a material for the
 control layer, and **money is read on solid ground**. A widget is content.
 There is no glass anywhere in this bundle and that is a rule, not an omission.

 ── What the small size leads with, and why it is not a money figure ─────────

 The three scores: Brand, Quality, Morale. `components/StatRings.tsx` calls
 them "the three levers a founder actually steers, and the ones most events
 move", and that is the whole argument — a money figure between sessions is a
 consequence, and these three are the causes. They also answer a question a
 glance can act on: cash going down is a fact, morale at 31 is a thing to go
 and fix.

 There is a second reason and it is the stronger one. `weakestCategory()` in
 lib/engine/events.ts biases the next event draw toward whichever of the five
 visible stats is lowest, once it falls under 45. So the lowest of these is not
 a statistic — it is what the game is about to do to you, and the card says so.

 The medium size keeps the money on it, because The Books is what it is called
 and cash and valuation are what it is: three figures across the top, the three
 scores under them, the fiscal year along the bottom.
 */
struct TheBooksWidget: Widget {
    static let kind = "com.novuspitch.widget.books"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            TheBooksView(snapshot: entry.snapshot)
                .containerBackground(Nv.bg, for: .widget)
        }
        .configurationDisplayName("The Books")
        .description("Brand, Quality and Morale — and what the company is worth.")
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

            Spacer(minLength: 9)

            // Stacked rather than three columns: at this width three side by
            // side leaves each label about eleven points wide, and "QUALITY"
            // does not fit in eleven points without going under the 12px floor
            // design.md sets for type.
            VStack(alignment: .leading, spacing: 7) {
                ForEach(company.headlineScores, id: \.label) { score in
                    ScoreMeter(
                        score: score,
                        pressured: company.underPressure && score.label == company.weakest?.label)
                }
            }

            Spacer(minLength: 9)

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
                FigureCell(label: "VALUATION", figure: company.valuation, alignment: .trailing)
            }

            Spacer(minLength: 10)

            /*
             Three money figures, then the three causes of them.

             The valuation sparkline used to sit here and it lost the slot on
             purpose: a twelve-month line under a valuation figure says which
             way the company went, and Brand, Quality and Morale say WHY it
             went that way and what to do about it. One of them is a chart of
             the past and the other three are the levers.
             */
            ScoreRow(company: company)

            SegmentBar(fill: Double(company.monthsElapsed) / 12, tint: company.accent, height: 3)
                .padding(.top, 9)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "\(OutsideStore.scheme)://\(company.atGate ? "gate" : "play")"))
    }
}
