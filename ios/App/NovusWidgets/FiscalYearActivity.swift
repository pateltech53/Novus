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

 · **Ordinary.** Month, the three scores, the twelve ticks. Quiet, and correct.
 · **Under pressure.** The weakest of the five visible stats has fallen below
   45, which is where `weakestCategory()` in lib/engine/events.ts starts
   biasing the event draw toward that stat's category. Alert red, and that
   stat's number is what the Dynamic Island shows in its compact form.
 · **The gate.** Month twelve. Prestige gold, and the whole card changes what
   it is about: the numbers stop being scores and become an instruction.

 ── Why the compact form is the weakest score and not the month ──────────────

 The compact trailing slot is about four characters wide and it is what a
 player sees a hundred times a day without meaning to. "M7" is trivia. "31"
 next to a morale glyph is the thing the game is about to punish you for, which
 is the only reason a lock screen is allowed to hold onto four characters of
 anyone's attention.
 */
@available(iOS 16.2, *)
struct FiscalYearActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FiscalYearAttributes.self) { context in
            FiscalYearCard(company: context.state.company)
                // 13, not 14. The Lock Screen banner is capped at the same 160
                // points the expanded island is, and this card runs to about
                // 130 of them — close enough that a large Dynamic Type setting
                // is what would push it over.
                .padding(13)
                .activityBackgroundTint(background(context.state.company))
                .activitySystemActionForegroundColor(
                    context.state.company.atGate ? Nv.onPrestige : Nv.action)
        } dynamicIsland: { context in
            let company = context.state.company

            return DynamicIsland {
                /*
                 ── The 160-point ceiling ─────────────────────────────────────

                 An expanded Dynamic Island is capped at 160 points tall, and
                 anything past it is CLIPPED rather than scaled: no warning, no
                 scroll, just a number cut through the middle. The leading and
                 trailing regions and the bottom region stack, so the budget is
                 shared between all three and it is the bottom one that has to
                 give.

                 Everything below is therefore one line where it can be. The
                 leading and trailing regions are two short lines each, every
                 one of them limited and allowed to shrink; the bottom is a bar,
                 a row of meters and a single line of money. Nothing here is
                 three lines tall.
                 */
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(company.name.uppercased())
                            .font(NvType.label(12, weight: .black))
                            .tracking(0.5)
                            .foregroundStyle(Nv.primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        // "PUBLIC/UNICORN" is fourteen characters and the
                        // leading region is about a hundred points wide, so
                        // this one is allowed to shrink rather than wrap into
                        // a second line the layout has no room for.
                        Text(company.statusLine)
                            .font(NvType.label(9, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(company.accent)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    // The island's top-left corner takes a bite out of
                    // whatever is flush against it. See `NvIsland`.
                    .padding(.leading, NvIsland.inset)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(company.atGate ? "FY\(company.year)" : "\(company.weakest?.value ?? 0)")
                            .font(NvType.figure(16, weight: .bold))
                            .foregroundStyle(company.atGate ? Nv.prestige : Nv.primary)
                            .lineLimit(1)
                        Text(company.atGate ? "CLOSING" : (company.weakest?.label ?? "SCORE"))
                            .font(NvType.label(8, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(Nv.tertiary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .padding(.trailing, NvIsland.inset)
                }

                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 7) {
                        SegmentBar(
                            fill: Double(company.monthsElapsed) / 12,
                            tint: company.accent, height: 4)

                        ScoreRow(company: company, compact: true)

                        if company.atGate {
                            // At the gate the money is not the point and the
                            // sentence is. One or the other, never both — two
                            // of them is what put this region over the ceiling.
                            Text("The year will not close until you have pitched it.")
                                .font(NvType.label(11, weight: .semibold))
                                .foregroundStyle(Nv.prestige)
                                .lineLimit(2)
                                .minimumScaleFactor(0.85)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            HStack(spacing: 0) {
                                InlineFigure(label: "CASH", figure: company.cash)
                                Spacer(minLength: 8)
                                InlineFigure(label: "VALUE", figure: company.valuation)
                            }
                        }
                    }
                    .padding(.top, 2)
                    // Both lower corners, and the lower edge. The segment bar
                    // is inset with everything else: a twelve-tick bar missing
                    // its first and last tick reads as an eleven-month year.
                    .padding(.horizontal, NvIsland.inset)
                    .padding(.bottom, NvIsland.bottomInset)
                }
            } compactLeading: {
                /*
                 The wordmark, not a symbol.

                 The compact island is the app's smallest storefront and it is
                 seen more often than any screen in the game. An industry glyph
                 said which company; nothing said whose app it was. "NOVUS" in
                 the action orange does both jobs at a width the slot has —
                 five capitals at nine points, tracked tight, and allowed to
                 shrink rather than truncate on a narrower island.
                 */
                Text("NOVUS")
                    .font(NvType.label(9, weight: .black))
                    .tracking(0.4)
                    .foregroundStyle(company.atGate ? Nv.prestige : Nv.action)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            } compactTrailing: {
                /*
                 Three scores rather than one.

                 One number is a fact with no scale on it — 47 is meaningless
                 without knowing what the others are. Three is the smallest set
                 that reads as a SHAPE: `B61 Q74 M52` says at a glance that
                 morale is the soft one, and the banded colour says whether any
                 of them has crossed the line the engine acts on.

                 Still one thing at the gate. Month twelve is not a moment to
                 offer three numbers to think about.
                 */
                if company.atGate {
                    Text("FY\(company.year)")
                        .font(NvType.figure(13, weight: .bold))
                        .foregroundStyle(Nv.prestige)
                } else {
                    HStack(spacing: 3) {
                        ForEach(company.headlineScores, id: \.label) { score in
                            ScoreChip(score: score, size: 11)
                        }
                    }
                    .minimumScaleFactor(0.7)
                }
            } minimal: {
                // The minimal slot is a circle about eleven points across and
                // it is shared with whatever else is running. A ring, because
                // at that size a ring is legible and two characters are not.
                Gauge(value: company.atGate ? 1 : (company.weakest?.fill ?? 0)) {
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
        VStack(alignment: .leading, spacing: 8) {
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
                ScoreRow(company: company)

                HStack(alignment: .top, spacing: 0) {
                    FigureCell(label: "CASH", figure: company.cash, size: 16)
                    Spacer(minLength: 6)
                    FigureCell(label: "BURN / MO", figure: company.burn, size: 16)
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
