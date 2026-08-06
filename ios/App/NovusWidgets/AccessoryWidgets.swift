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
   that keeps its ring in every rendering mode and on every wallpaper. Runway,
   which is the number worth glancing at.
 · The rectangular slot is three lines with a strict order: who, how long, how
   much. Reading order is the hierarchy when tint is not available.
 · The inline slot is one clause, and it goes beside the date. It gets a symbol
   and about thirty characters, and anything longer is truncated by the system
   rather than by a designer.

 `.widgetAccentable()` marks what should ride in the accent group when the
 player has picked a tinted Lock Screen. It is the only colour instruction here
 that the system honours reliably.
 */

// ── Circular ────────────────────────────────────────────────────────────────

struct RunwayCircularWidget: Widget {
    static let kind = "com.novuspitch.widget.runway"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            RunwayCircularView(snapshot: entry.snapshot)
                .containerBackground(Color.clear, for: .widget)
        }
        .configurationDisplayName("Runway")
        .description("How long the company has left, as a ring.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct RunwayCircularView: View {
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
            } else {
                Gauge(value: min(company.runwayFill, 1)) {
                    Image(systemName: company.symbol)
                } currentValueLabel: {
                    // The number without its unit: the ring IS the unit, and
                    // "7mo" at this diameter is four glyphs where two fit.
                    Text(company.isProfitable ? "∞" : "\(Int(company.runwayMonths))")
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
        .description("The company, its runway and its cash, on the Lock Screen.")
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

                Text(company.atGate ? "PITCH DUE" : "\(company.runway.text) runway")
                    .font(NvType.figure(15, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Text("\(company.cash.text) cash · \(company.burn.text)/mo")
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
}

// ── Inline ──────────────────────────────────────────────────────────────────

struct RunwayInlineWidget: Widget {
    static let kind = "com.novuspitch.widget.runway.inline"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            RunwayInlineView(snapshot: entry.snapshot)
                .containerBackground(Color.clear, for: .widget)
        }
        .configurationDisplayName("Runway, inline")
        .description("One line above the Lock Screen clock.")
        .supportedFamilies([.accessoryInline])
    }
}

struct RunwayInlineView: View {
    let snapshot: OutsideSnapshot

    var body: some View {
        // One `Label`, and only one: the inline slot renders a single view and
        // silently drops the rest of a stack. Thirty-odd characters, then the
        // system truncates — so the company's name goes last, where losing the
        // tail of it costs the least.
        if let company = snapshot.company {
            if company.atGate {
                Label("Pitch due · \(company.name)", systemImage: "video.fill")
            } else if company.alive {
                Label("\(company.runway.text) runway · \(company.name)", systemImage: company.symbol)
            } else {
                Label("\(company.statusLine.capitalized) · \(company.name)", systemImage: "xmark.circle")
            }
        } else {
            Label("No company open", systemImage: "plus.circle")
        }
    }
}
