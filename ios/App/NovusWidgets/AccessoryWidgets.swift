import SwiftUI
import WidgetKit

/**
 The Lock Screen, and StandBy, and the Apple Watch-shaped slots on both.

 ── Why these are designed differently from the home screen ones ─────────────

 An accessory widget is not drawn in the colours it is written in. The system
 renders it in `.vibrant` — the content is flattened to a single luminance and
 composited against the wallpaper — so every brand colour in this file is a
 suggestion the OS is free to ignore, and mostly does. Fighting that produces a
 widget that looks wrong on somebody's photo of their dog.

 So the design here is about SHAPE and HIERARCHY rather than colour:

 · The circular slot is a `Gauge`, because a system gauge is the one control
   that keeps its ring in every rendering mode and on every wallpaper. It shows
   the WEAKEST of the five — see below.
 · The rectangular slot is three lines with a strict order: who, what is
   weakest, what the other two are. Reading order is the hierarchy when tint is
   not available.
 · The inline slot is one clause, and it goes beside the date. It gets a symbol
   and about thirty characters, and anything longer is truncated by the system
   rather than by a designer.

 ── Why the weakest, rather than a fixed stat ────────────────────────────────

 A Lock Screen slot is about eleven points across and a player sees it a
 hundred times a day without meaning to. Spending that on Brand every day —
 including the eleven months Brand is fine — wastes it.

 `weakestCategory()` in lib/engine/events.ts biases the next event draw toward
 whichever of the five visible stats is lowest, once it falls below 45. So the
 lowest one is not a statistic: it is what the game is about to do to you. That
 is worth eleven points, and it changes when the answer changes, which is the
 only way a glanceable surface earns being glanced at.

 `.widgetAccentable()` marks what should ride in the accent group when the
 player has picked a tinted Lock Screen. It is the only colour instruction here
 that the system honours reliably.
 */

// ── Circular ────────────────────────────────────────────────────────────────

struct WeakestCircularWidget: Widget {
    static let kind = "com.novuspitch.widget.weakest"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            WeakestCircularView(snapshot: entry.snapshot)
                .containerBackground(Color.clear, for: .widget)
        }
        .configurationDisplayName("Weakest")
        .description("Whichever of Brand, Quality, Morale, CSAT or Energy is lowest.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct WeakestCircularView: View {
    let snapshot: OutsideSnapshot

    var body: some View {
        if let company = snapshot.company, company.alive {
            if company.atGate {
                // At the gate the ring is not the question. A full circle and
                // the camera is, because the year is over and the only thing
                // between the player and next year is a pitch.
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Image(systemName: "video.fill")
                            .font(.system(size: 15, weight: .bold))
                        Text("PITCH")
                            .font(NvType.label(8, weight: .black))
                    }
                    .widgetAccentable()
                }
                .widgetURL(URL(string: "\(OutsideStore.scheme)://gate"))
            } else if let weakest = company.weakest {
                Gauge(value: weakest.fill) {
                    Image(systemName: weakest.symbol)
                } currentValueLabel: {
                    // The number without its label: the symbol IS the label,
                    // and "MORALE" at this diameter is six glyphs where two
                    // fit.
                    Text("\(weakest.value)")
                        .font(NvType.figure(15, weight: .bold))
                        .minimumScaleFactor(0.6)
                }
                .gaugeStyle(.accessoryCircular)
                .widgetURL(URL(string: "\(OutsideStore.scheme)://play"))
            }
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: snapshot.company == nil ? "plus" : "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .widgetAccentable()
            }
            .widgetURL(URL(string: "\(OutsideStore.scheme)://islands"))
        }
    }
}

// ── Rectangular ─────────────────────────────────────────────────────────────

struct BooksRectangularWidget: Widget {
    static let kind = "com.novuspitch.widget.books.rect"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            BooksRectangularView(snapshot: entry.snapshot)
                .containerBackground(Color.clear, for: .widget)
        }
        .configurationDisplayName("The Books")
        .description("The company and its three scores, on the Lock Screen.")
        .supportedFamilies([.accessoryRectangular])
    }
}

struct BooksRectangularView: View {
    let snapshot: OutsideSnapshot

    var body: some View {
        if let company = snapshot.company {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 3) {
                    Image(systemName: company.symbol)
                        .font(.system(size: 10, weight: .semibold))
                    Text(company.name.uppercased())
                        .font(NvType.label(11, weight: .black))
                        .lineLimit(1)
                    Text("FY\(company.year)")
                        .font(NvType.figure(10, weight: .semibold))
                        .opacity(0.7)
                }
                .widgetAccentable()

                // Line two is the weakest, named and numbered. It is the one
                // line on this widget somebody could act on.
                Text(headline(company))
                    .font(NvType.figure(15, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                // The rest of the trio, so the weakest has something to be
                // weak relative to.
                Text(rest(company))
                    .font(NvType.figure(10, weight: .medium))
                    .opacity(0.75)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .widgetURL(URL(string: "\(OutsideStore.scheme)://\(company.atGate ? "gate" : "play")"))
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Text("NOVUS").font(NvType.label(11, weight: .black)).widgetAccentable()
                Text("No company open").font(NvType.label(13, weight: .semibold))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .widgetURL(URL(string: "\(OutsideStore.scheme)://islands"))
        }
    }

    /// "Morale 31", or the gate, or the headstone.
    private func headline(_ company: OutsideCompany) -> String {
        if company.atGate { return "PITCH DUE" }
        if !company.alive { return company.statusLine }
        guard let weakest = company.weakest else { return company.stageName }
        return "\(weakest.label.capitalized) \(weakest.value)"
    }

    /// The other two of the headline trio, in the order `StatRings` draws them.
    private func rest(_ company: OutsideCompany) -> String {
        let others = company.headlineScores.filter { $0.label != company.weakest?.label }
        guard !others.isEmpty else { return company.stageName }
        return others.map { "\($0.label.capitalized) \($0.value)" }.joined(separator: " · ")
    }
}

// ── Inline ──────────────────────────────────────────────────────────────────

struct WeakestInlineWidget: Widget {
    static let kind = "com.novuspitch.widget.weakest.inline"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            WeakestInlineView(snapshot: entry.snapshot)
                .containerBackground(Color.clear, for: .widget)
        }
        .configurationDisplayName("Weakest, inline")
        .description("One line above the Lock Screen clock.")
        .supportedFamilies([.accessoryInline])
    }
}

struct WeakestInlineView: View {
    let snapshot: OutsideSnapshot

    var body: some View {
        // One `Label`, and only one: the inline slot renders a single view and
        // silently drops the rest of a stack. Thirty-odd characters, then the
        // system truncates — so the company's name goes last, where losing the
        // tail of it costs the least.
        if let company = snapshot.company {
            if company.atGate {
                Label("Pitch due · \(company.name)", systemImage: "video.fill")
            } else if company.alive, let weakest = company.weakest {
                Label(
                    "\(weakest.label.capitalized) \(weakest.value) · \(company.name)",
                    systemImage: weakest.symbol)
            } else {
                Label("\(company.statusLine.capitalized) · \(company.name)", systemImage: "xmark.circle")
            }
        } else {
            Label("No company open", systemImage: "plus.circle")
        }
    }
}

// ── Still Standing, on the Lock Screen ──────────────────────────────────────

/**
 The archipelago's headline, at Lock Screen size.

 `StillStandingWidget` (the Home Screen board) had no Lock Screen presence at
 all — every other company-level fact in this bundle got one and this one did
 not, for no reason beyond nobody having added it. Six rows do not fit in
 eleven points; the one row that does is the best a player has ever built,
 which is the same "worth it even most runs end in a headstone" reasoning
 `StillStandingWidget`'s own header comment gives for showing dead companies
 at all.
 */
struct StillStandingRectangularWidget: Widget {
    static let kind = "com.novuspitch.widget.islands.rect"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            StillStandingRectangularView(snapshot: entry.snapshot)
                .containerBackground(Color.clear, for: .widget)
        }
        .configurationDisplayName("Still Standing")
        .description("Your best company's peak valuation.")
        .supportedFamilies([.accessoryRectangular])
    }
}

struct StillStandingRectangularView: View {
    let snapshot: OutsideSnapshot

    /// Peak, not current valuation — the same column `StillStandingWidget`
    /// sorts by, for the same reason: a company's worst day should not be
    /// what the Lock Screen remembers it by.
    private var best: OutsideIsland? {
        snapshot.islands.max { $0.peak < $1.peak }
    }

    var body: some View {
        if let best {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 3) {
                    Image(systemName: "trophy")
                        .font(.system(size: 10, weight: .semibold))
                    Text("STILL STANDING")
                        .font(NvType.label(10, weight: .black))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(counted)
                        .font(NvType.label(9, weight: .bold))
                        .opacity(0.7)
                }
                .widgetAccentable()

                Text(best.name)
                    .font(NvType.figure(14, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Text("Peak \(best.peakText)")
                    .font(NvType.figure(10, weight: .medium))
                    .opacity(0.75)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .widgetURL(URL(string: "\(OutsideStore.scheme)://islands"))
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Text("NOVUS").font(NvType.label(11, weight: .black)).widgetAccentable()
                Text("No company yet").font(NvType.label(12, weight: .semibold))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .widgetURL(URL(string: "\(OutsideStore.scheme)://islands"))
        }
    }

    private var counted: String {
        let alive = snapshot.islands.filter(\.alive).count
        return "\(alive)/\(snapshot.islands.count)"
    }
}

/// The same board, reduced to one number: how many are still alive.
struct StillStandingCircularWidget: Widget {
    static let kind = "com.novuspitch.widget.islands.circle"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            StillStandingCircularView(snapshot: entry.snapshot)
                .containerBackground(Color.clear, for: .widget)
        }
        .configurationDisplayName("Still Standing, count")
        .description("How many of your companies are still alive.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct StillStandingCircularView: View {
    let snapshot: OutsideSnapshot

    var body: some View {
        let alive = snapshot.islands.filter(\.alive).count
        let total = snapshot.islands.count

        if total > 0 {
            Gauge(value: Double(alive), in: 0...Double(total)) {
                Image(systemName: "trophy")
            } currentValueLabel: {
                Text("\(alive)")
                    .font(NvType.figure(15, weight: .bold))
                    .minimumScaleFactor(0.6)
            }
            .gaugeStyle(.accessoryCircular)
            .widgetURL(URL(string: "\(OutsideStore.scheme)://islands"))
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "trophy")
                    .font(.system(size: 14, weight: .semibold))
                    .widgetAccentable()
            }
            .widgetURL(URL(string: "\(OutsideStore.scheme)://islands"))
        }
    }
}

// ── RobinGhood, on the Lock Screen ──────────────────────────────────────────

/**
 The one figure `MarketWidget` already computes that had no Lock Screen slot:
 `dayChange(at:)`, the same line RobinGhood's Home Screen card draws under the
 book value. A `Gauge` fill does not mean anything for a number that is
 signed and unbounded either way, so this follows `WeakestCircularWidget`'s
 own gate state — an icon and a number, not a ring.
 */
struct MarketCircularWidget: Widget {
    static let kind = "com.novuspitch.widget.market.circle"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            MarketCircularView(snapshot: entry.snapshot)
                .containerBackground(Color.clear, for: .widget)
        }
        .configurationDisplayName("RobinGhood")
        .description("Today's change on your positions.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct MarketCircularView: View {
    let snapshot: OutsideSnapshot

    var body: some View {
        if let market = snapshot.market, !market.positions.isEmpty {
            let change = market.dayChange(at: MarketMath.minute())
            let up = change >= 0

            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: up ? "arrow.up.right" : "arrow.down.right")
                        .font(.system(size: 13, weight: .bold))
                    Text(NvFormat.percent(change, signed: true))
                        .font(NvType.figure(10, weight: .bold))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                }
                .widgetAccentable()
            }
            .widgetURL(URL(string: "\(OutsideStore.scheme)://market"))
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 14, weight: .semibold))
                    .widgetAccentable()
            }
            .widgetURL(URL(string: "\(OutsideStore.scheme)://market"))
        }
    }
}
