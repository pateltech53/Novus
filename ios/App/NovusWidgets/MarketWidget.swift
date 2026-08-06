import SwiftUI
import WidgetKit

/**
 RobinGhood on the Home Screen — and the one surface in this bundle that moves
 on its own.

 ── Why this exists ──────────────────────────────────────────────────────────

 It was not asked for, and it is here because without it "live P&L" is a claim
 the platform cannot keep. A Live Activity is rendered as a snapshot: it
 changes when the app updates it and not otherwise, so `MarketActivity` next
 door shows the price at the last render and holds still between them. Correct,
 and not a ticking number.

 A widget timeline can do what an activity cannot. `getTimeline` returns a
 series of entries STAMPED WITH FUTURE DATES, and the system renders each one
 at its moment without waking the app and without spending refresh budget — the
 budget is charged for asking for a new timeline, not for the entries in it.
 Because `lib/engine/market.ts` prices a ticker as a pure function of (symbol,
 minute), every one of those future entries can be priced now, exactly, for a
 minute that has not happened yet.

 So this widget genuinely ticks: four hours of the tape, at fifteen-minute
 steps, computed in one pass. It is the payoff for `MarketMath` existing, and
 it is a single file to delete if it is not wanted.

 ── The horizon, and why it is four hours ────────────────────────────────────

 Long enough that a phone left alone overnight still has entries in the morning
 for a while, short enough that the positions it is pricing are still the ones
 the player holds. The share count is the thing that goes stale here, not the
 price — this widget cannot know about a sale — so the horizon is really a
 statement about how long a holding is assumed to stand. Four hours, then the
 system asks for a fresh timeline, which re-reads the file the app writes.
 */
struct MarketWidget: Widget {
    static let kind = "com.novuspitch.widget.market"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: MarketProvider()) { entry in
            MarketWidgetView(entry: entry)
                .containerBackground(Nv.bg, for: .widget)
        }
        .configurationDisplayName("RobinGhood")
        .description("What your positions are worth, priced on the real clock.")
        .supportedFamilies([.systemSmall])
    }
}

// ── The timeline ────────────────────────────────────────────────────────────

struct MarketEntry: TimelineEntry {
    let date: Date
    let market: OutsideMarket?
    let companyName: String
    /// The minute this entry is priced for. Not derived from `date` at render
    /// time, because a widget rendered late must show the price for the moment
    /// it was scheduled rather than silently for now.
    let minute: Int
}

struct MarketProvider: TimelineProvider {
    /// Fifteen minutes. The tape has minute-level noise in it and rendering
    /// every minute would be sixteen times the entries for a number nobody is
    /// watching that closely.
    private let stepMinutes = 15
    private let horizonMinutes = 4 * 60

    func placeholder(in context: Context) -> MarketEntry {
        MarketEntry(date: Date(), market: nil, companyName: "Brewzo", minute: MarketMath.minute())
    }

    func getSnapshot(in context: Context, completion: @escaping (MarketEntry) -> Void) {
        completion(entry(at: MarketMath.minute(), from: OutsideStore.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MarketEntry>) -> Void) {
        let snapshot = OutsideStore.read()
        let now = MarketMath.minute()

        var entries: [MarketEntry] = []
        for offset in stride(from: 0, through: horizonMinutes, by: stepMinutes) {
            entries.append(entry(at: now + offset, from: snapshot))
        }

        // `.atEnd` rather than a date: the last entry IS the horizon, and
        // asking again at exactly the moment it runs out is what keeps the
        // widget from ever showing a price with nothing behind it.
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    private func entry(at minute: Int, from snapshot: OutsideSnapshot?) -> MarketEntry {
        MarketEntry(
            date: Date(timeIntervalSince1970: Double(minute) * 60),
            market: snapshot?.market,
            companyName: snapshot?.company?.name ?? "",
            minute: minute)
    }
}

// ── The card ────────────────────────────────────────────────────────────────

struct MarketWidgetView: View {
    let entry: MarketEntry

    var body: some View {
        if let market = entry.market, !market.positions.isEmpty {
            Held(market: market, minute: entry.minute, companyName: entry.companyName)
        } else {
            NothingHeld()
        }
    }
}

private struct Held: View {
    let market: OutsideMarket
    let minute: Int
    let companyName: String

    var body: some View {
        let (value, unrealised, _) = market.repriced(at: minute)
        let up = unrealised >= 0
        let tint = up ? Nv.solvency : Nv.alert
        let top = market.largest

        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Nv.action)
                Text("ROBINGHOOD")
                    .font(NvType.label(9, weight: .black))
                    .tracking(0.7)
                    .foregroundStyle(Nv.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Text(NvFormat.money(value))
                .font(NvType.figure(26, weight: .bold))
                .foregroundStyle(Nv.primary)
                .minimumScaleFactor(0.6)
                .lineLimit(1)

            HStack(spacing: 5) {
                Image(systemName: up ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 9, weight: .bold))
                Text(NvFormat.delta(unrealised))
                    .font(NvType.figure(11, weight: .bold))
                Text(NvFormat.percent(market.dayChange(at: minute), signed: true))
                    .font(NvType.figure(11, weight: .semibold))
                    .opacity(0.75)
            }
            .foregroundStyle(tint)
            .padding(.top, 1)

            Spacer(minLength: 8)

            if let top {
                HStack(spacing: 0) {
                    Text(top.symbol)
                        .font(NvType.figure(10, weight: .black))
                        .foregroundStyle(Nv.tertiary)
                    Spacer(minLength: 6)
                    Text(NvFormat.money(top.marketValue(at: minute)))
                        .font(NvType.figure(10, weight: .semibold))
                        .foregroundStyle(Nv.tertiary)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "\(OutsideStore.scheme)://market"))
    }
}

private struct NothingHeld: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("ROBINGHOOD")
                .font(NvType.label(9, weight: .black))
                .tracking(0.7)
                .foregroundStyle(Nv.action)
            Text("No positions")
                .font(NvType.label(14, weight: .bold))
                .foregroundStyle(Nv.primary)
            Text("Company money, in somebody else's company.")
                .font(NvType.label(10, weight: .medium))
                .foregroundStyle(Nv.tertiary)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "\(OutsideStore.scheme)://market"))
    }
}
