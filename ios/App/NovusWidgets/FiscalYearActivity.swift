import ActivityKit
import SwiftUI
import WidgetKit

/**
 The fiscal year, on the Lock Screen and in the Dynamic Island.

 ── What this surface is FOR ─────────────────────────────────────────────────

 Novus has one rule above all the others: time moves only when you tap, and a
 fiscal year does not close until you have pitched it out loud to a panel that
 asks questions back. Everything else in the game is downstream of that.

 A Live Activity is the only surface in the operating system that can carry
 that rule while the app is shut. So this is not a status readout with a logo
 on it — it is the game's clock, stopped, with the number that decides whether
 there is a company left when you next pick the phone up. Three states, and
 they are ordered by how loudly they need to be said:

 · **Ordinary.** Month, runway, the twelve ticks. Quiet, and correct.
 · **Redline.** Under three months of runway. Alert red, and the runway figure
   is what the Dynamic Island shows in its compact form.
 · **The gate.** Month twelve. Prestige gold, and the whole card changes what
   it is about: the number stops being runway and becomes an instruction.

 ── Why the compact form is runway and not the month ─────────────────────────

 The compact trailing slot is about four characters wide and it is what a
 player sees a hundred times a day without meaning to. "M7" is trivia. "2mo" is
 the thing that would make somebody open the app, which is the only reason a
 lock screen is allowed to hold onto four characters of anyone's attention.
 */
@available(iOS 16.2, *)
struct FiscalYearActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FiscalYearAttributes.self) { context in
            FiscalYearCard(company: context.state.company)
                .padding(14)
                .activityBackgroundTint(background(context.state.company))
                .activitySystemActionForegroundColor(
                    context.state.company.atGate ? Nv.onPrestige : Nv.action)
        } dynamicIsland: { context in
            let company = context.state.company

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(company.name.uppercased())
                            .font(NvType.label(12, weight: .black))
                            .tracking(0.5)
                            .foregroundStyle(Nv.primary)
                            .lineLimit(1)
                        Text(company.statusLine)
                            .font(NvType.label(9, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(company.accent)
                    }
                }

                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(company.atGate ? "FY\(company.year)" : company.runway.text)
                            .font(NvType.figure(17, weight: .bold))
                            .foregroundStyle(company.atGate ? Nv.prestige : Nv.primary)
                        Text(company.atGate ? "CLOSING" : "RUNWAY")
                            .font(NvType.label(8, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(Nv.tertiary)
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        SegmentBar(
                            fill: Double(company.monthsElapsed) / 12,
                            tint: company.accent, height: 4)

                        HStack(alignment: .top, spacing: 0) {
                            FigureCell(label: "CASH", figure: company.cash, size: 15)
                            Spacer(minLength: 6)
                            FigureCell(label: "BURN / MO", figure: company.burn, size: 15)
                            Spacer(minLength: 6)
                            FigureCell(
                                label: "VALUATION", figure: company.valuation, size: 15,
                                alignment: .trailing)
                        }

                        if company.atGate {
                            Text("The year will not close until you have pitched it.")
                                .font(NvType.label(11, weight: .semibold))
                                .foregroundStyle(Nv.prestige)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.top, 2)
                }
            } compactLeading: {
                Image(systemName: company.atGate ? "video.fill" : company.symbol)
                    .foregroundStyle(company.accent)
            } compactTrailing: {
                Text(company.atGate ? "FY\(company.year)" : company.runway.text)
                    .font(NvType.figure(13, weight: .bold))
                    .foregroundStyle(company.accent)
            } minimal: {
                // The minimal slot is a circle about eleven points across and
                // it is shared with whatever else is running. A ring, because
                // at that size a ring is legible and three characters are not.
                Gauge(value: company.atGate ? 1 : min(company.runwayFill, 1)) {
                    EmptyView()
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(company.accent)
            }
            .widgetURL(URL(string: "\(OutsideStore.scheme)://\(company.atGate ? "gate" : "play")"))
            .keylineTint(company.accent)
        }
    }

    /**
     The card's ground.

     Nil everywhere except the gate, and that is deliberate: `nil` lets the
     system pick its own material, which is what a Live Activity is supposed to
     look like eleven months of the year. The gate is the one moment the app
     overrides the system, because gold is how this game says "this is the
     thing" and it is worth exactly one moment a year.
     */
    private func background(_ company: OutsideCompany) -> Color? {
        company.atGate ? Nv.prestige : nil
    }
}

// ── The Lock Screen card ────────────────────────────────────────────────────

@available(iOS 16.2, *)
private struct FiscalYearCard: View {
    let company: OutsideCompany

    /// At the gate the card is gold, so every piece of ink on it has to be the
    /// dark one. White on gold fails contrast at any size worth reading.
    private var ink: Color { company.atGate ? Nv.onPrestige : Nv.primary }
    private var quiet: Color { company.atGate ? Nv.onPrestige.opacity(0.72) : Nv.tertiary }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 6) {
                Image(systemName: company.atGate ? "video.fill" : company.symbol)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(company.atGate ? Nv.onPrestige : Nv.action)

                Text(company.name.uppercased())
                    .font(NvType.label(11, weight: .black))
                    .tracking(0.7)
                    .foregroundStyle(ink)
                    .lineLimit(1)

                Spacer(minLength: 6)

                // The app's own capsule, verbatim — "JUL → AUG", or
                // "DEC → FY4" at the gate. Where the year is, and where one
                // tap takes it.
                Text(company.badge)
                    .font(NvType.figure(11, weight: .bold))
                    .foregroundStyle(quiet)
                    .lineLimit(1)
            }

            if company.atGate {
                Text("PITCH DUE")
                    .font(NvType.label(24, weight: .black))
                    .tracking(-0.3)
                    .foregroundStyle(Nv.onPrestige)

                Text("The fiscal year does not close until you have pitched it, on camera, to the panel.")
                    .font(NvType.label(11, weight: .semibold))
                    .foregroundStyle(Nv.onPrestige.opacity(0.82))
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(alignment: .top, spacing: 0) {
                    FigureCell(label: "CASH", figure: company.cash, size: 16)
                    Spacer(minLength: 6)
                    FigureCell(label: "BURN / MO", figure: company.burn, size: 16)
                    Spacer(minLength: 6)
                    FigureCell(
                        label: "RUNWAY", figure: company.runway, size: 16,
                        tint: company.isRedline ? Nv.alert : Nv.primary)
                    Spacer(minLength: 6)
                    FigureCell(
                        label: "VALUATION", figure: company.valuation, size: 16,
                        alignment: .trailing)
                }
            }

            SegmentBar(
                fill: Double(company.monthsElapsed) / 12,
                tint: company.atGate ? Nv.onPrestige.opacity(0.55) : company.accent,
                height: 4)
        }
    }
}
