import SwiftUI
import WidgetKit

/**
 The archipelago — every company on this device, alive and otherwise.

 ── Why the dead ones are on it ──────────────────────────────────────────────

 Because they are the record. Novus is a game you lose most of the time — the
 balance target is roughly a third of runs surviving ten years — and a board
 that showed only the company currently open would be a widget that is empty
 for most players most of the time, and dishonest for the rest.

 So each row is a company and a number, and the number is its PEAK valuation
 rather than its current one. That is not flattery: valuation at Chapter 7 is
 approximately zero and says nothing at all about the four years before it. The
 engine keeps the high-water mark for exactly this reason — see
 `peakValuation` in lib/engine/types.ts — and this is the surface it was kept
 for.

 Sorted by that peak, six at most, which is what the medium size holds without
 the type going under the floor. `OUTSIDE_ISLAND_LIMIT` in the TypeScript is
 the same six, so nothing is truncated twice.
 */
struct StillStandingWidget: Widget {
    static let kind = "com.novuspitch.widget.islands"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: OutsideProvider()) { entry in
            StillStandingView(snapshot: entry.snapshot)
                .containerBackground(Nv.bg, for: .widget)
        }
        .configurationDisplayName("Still Standing")
        .description("Every company you have founded, and what it got to.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct StillStandingView: View {
    let snapshot: OutsideSnapshot
    @Environment(\.widgetFamily) private var family

    /// Four rows on medium, six on large. Not a guess — below these the row
    /// height forces the figures under the 12px floor design.md sets.
    private var rowCap: Int { family == .systemLarge ? 6 : 4 }

    var body: some View {
        if snapshot.islands.isEmpty {
            NoCompany()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 5) {
                    Text("STILL STANDING")
                        .font(NvType.label(10, weight: .black))
                        .tracking(1)
                        .foregroundStyle(Nv.action)
                    Spacer(minLength: 4)
                    Text(counted)
                        .font(NvType.label(9, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(Nv.tertiary)
                }

                Spacer(minLength: 8)

                VStack(spacing: 0) {
                    ForEach(Array(snapshot.islands.prefix(rowCap).enumerated()), id: \.element.slot) {
                        index, island in
                        if index > 0 {
                            Rectangle()
                                .fill(Nv.hairline)
                                .frame(height: 0.5)
                        }
                        /*
                         `Link`, not a second `widgetURL`.

                         A widget honours exactly one `widgetURL` and the
                         behaviour with more than one is explicitly undefined —
                         six rows each declaring their own would resolve to
                         whichever the system happened to pick. `Link` is the
                         supported way to give a region of a medium or large
                         widget its own destination, and the `widgetURL` on the
                         container below stays as what a tap on the padding
                         between rows does.
                         */
                        Link(destination: destination(island)) {
                            IslandRow(island: island, open: island.slot == snapshot.company?.slot)
                        }
                    }
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(URL(string: "\(OutsideStore.scheme)://islands"))
        }
    }

    private var counted: String {
        let alive = snapshot.islands.filter(\.alive).count
        return "\(alive) OF \(snapshot.islands.count) ALIVE"
    }

    /// A dead company opens the picker rather than itself: there is nothing to
    /// play on an island with a headstone on it, and dropping a player onto one
    /// is a screen they have to escape from.
    private func destination(_ island: OutsideIsland) -> URL {
        let path = island.alive ? "island/\(island.slot)" : "islands"
        return URL(string: "\(OutsideStore.scheme)://\(path)")!
    }
}

// ── One company ─────────────────────────────────────────────────────────────

private struct IslandRow: View {
    let island: OutsideIsland
    /// The company currently open. Marked, because a board of six identical
    /// rows gives a player no way to tell which one they are playing.
    let open: Bool

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: island.alive ? island.symbol : "xmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(island.alive ? (open ? Nv.action : Nv.secondary) : Nv.tertiary)
                .frame(width: 15)

            VStack(alignment: .leading, spacing: 0) {
                Text(island.name)
                    .font(NvType.label(12, weight: open ? .black : .bold))
                    .foregroundStyle(island.alive ? Nv.primary : Nv.tertiary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                Text(subtitle)
                    .font(NvType.label(9, weight: .semibold))
                    .foregroundStyle(Nv.tertiary)
                    .lineLimit(1)
            }

            Spacer(minLength: 4)

            // The peak, always, and labelled as such nowhere: the column IS the
            // peak, said once in the row above the fold rather than six times.
            Text(island.peakText)
                .font(NvType.figure(13, weight: .bold))
                .foregroundStyle(island.alive ? Nv.solvency : Nv.tertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.vertical, 5)
        // The whole row is the target, including the space the figures do not
        // fill. A `Link` wrapping only the text would leave most of the row
        // dead to a thumb.
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        let years = island.year == 1 ? "1 year" : "\(island.year) years"
        if island.alive { return open ? "OPEN · \(years)" : years }
        switch island.endedBy {
        case "acquired": return "Acquired · \(years)"
        case "ipo": return "Public · \(years)"
        default: return "Chapter 7 · \(years)"
        }
    }
}
