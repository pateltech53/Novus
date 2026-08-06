import SwiftUI
import WidgetKit

/**
 The fiscal year, on the home screen.

 One dial, twelve ticks, and the one sentence the game is actually about: the
 year does not close until you have pitched it out loud, on camera, to a panel
 that asks questions back.

 ── Why this is a separate widget from The Books ─────────────────────────────

 They answer different questions and only one of them is a call to action. The
 Books is a status board — four figures, read and put down. This is a countdown
 to the only moment in Novus that cannot be resolved by tapping, and at month
 twelve the whole card turns prestige gold and says so.

 That gold is rationed, deliberately. `design.md` gives it to the year gate,
 stage-ups and badges and nothing else, which is what makes it mean something
 eleven months of the year when it is absent.
 */
struct TheYearWidget: Widget {
    static let kind = "com.novuspitch.widget.year"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            TheYearView(snapshot: entry.snapshot)
                .containerBackground(background(entry.snapshot), for: .widget)
        }
        .configurationDisplayName("The Year")
        .description("Where you are in the fiscal year, and when the panel is waiting.")
        .supportedFamilies([.systemSmall])
    }

    /**
     The gate is the one state that repaints the whole card rather than a
     detail of it. A gold ring on the ordinary ground would be a decoration; a
     gold card is the app raising its voice once a year.
     */
    private func background(_ snapshot: OutsideSnapshot) -> Color {
        snapshot.company?.atGate == true && snapshot.company?.alive == true
            ? Nv.prestige : Nv.bg
    }
}

struct TheYearView: View {
    let snapshot: OutsideSnapshot

    var body: some View {
        if let company = snapshot.company {
            if company.atGate && company.alive {
                YearGate(company: company)
            } else {
                YearDial(company: company)
            }
        } else {
            NoCompany(compact: true)
        }
    }
}

// ── Eleven months of the year ───────────────────────────────────────────────

private struct YearDial: View {
    let company: OutsideCompany

    var body: some View {
        VStack(spacing: 0) {
            MonthDial(elapsed: company.monthsElapsed, tint: company.accent) {
                VStack(spacing: 0) {
                    Text("FY\(company.year)")
                        .font(NvType.figure(22, weight: .bold))
                        .foregroundStyle(Nv.primary)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                    Text("MONTH \(company.monthsElapsed)")
                        .font(NvType.label(8, weight: .bold))
                        .tracking(0.6)
                        .foregroundStyle(Nv.tertiary)
                }
            }
            .frame(maxHeight: .infinity)

            VStack(spacing: 1) {
                Text(company.name.uppercased())
                    .font(NvType.label(11, weight: .black))
                    .tracking(0.6)
                    .foregroundStyle(Nv.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Text(company.statusLine)
                    .font(NvType.label(9, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(company.alive ? Nv.secondary : Nv.tertiary)
                    .lineLimit(1)
            }
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetURL(URL(string: "\(OutsideStore.scheme)://play"))
    }
}

// ── Month twelve ────────────────────────────────────────────────────────────

/**
 The gate, and the one place in this extension where a card is loud.

 Ink is `onPrestige` throughout — near-black. White on gold fails contrast at
 every size worth reading, and this is the card that most needs to be read from
 across a room.
 */
private struct YearGate: View {
    let company: OutsideCompany

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: "video.fill")
                    .font(.system(size: 11, weight: .bold))
                Text(company.name.uppercased())
                    .font(NvType.label(10, weight: .black))
                    .tracking(0.7)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text("FY\(company.year)")
                    .font(NvType.figure(10, weight: .bold))
            }
            .foregroundStyle(Nv.onPrestige.opacity(0.75))

            Spacer(minLength: 6)

            Text("PITCH\nDUE")
                .font(NvType.label(28, weight: .black))
                .tracking(-0.5)
                .foregroundStyle(Nv.onPrestige)
                .minimumScaleFactor(0.7)

            Spacer(minLength: 6)

            Text("The year will not close until you have pitched it.")
                .font(NvType.label(10, weight: .semibold))
                .foregroundStyle(Nv.onPrestige.opacity(0.8))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            // All twelve lit, in the ink colour rather than the accent: the
            // card IS the accent now, and a gold bar on gold is not a bar.
            SegmentBar(fill: 1, tint: Nv.onPrestige.opacity(0.55), height: 3)
                .padding(.top, 7)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "\(OutsideStore.scheme)://gate"))
    }
}
