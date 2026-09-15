import AppIntents
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

// ── One company, pinned ──────────────────────────────────────────────────────

/**
 A Home Screen slot for a company that is NOT necessarily the one open.

 Every widget above this line follows whichever run is active — correct for
 "what am I playing right now", and no use at all to a player who runs two or
 three companies and wants one specific one on their Home Screen regardless of
 which they last opened. `OutsideSnapshot.islands` already carries a summary of
 every company on the device (see `StillStandingWidget` above), so this is the
 same data, pinned rather than ranked.

 The pin survives the pinned company not being the open one — that is the
 whole point — but it does NOT survive the pinned slot being reused: a buried
 company's slot can be founded into again, and the widget then quietly follows
 the new occupant. Read-through by slot number rather than by name for
 exactly that reason; `IslandEntityQuery.entities(for:)` resolves whatever
 slot the player picked against whatever is actually there today.
 */
struct IslandEntity: AppEntity {
    let id: Int
    let name: String
    let alive: Bool

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Company"
    static var defaultQuery = IslandEntityQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: alive ? "" : "Buried")
    }
}

struct IslandEntityQuery: EntityQuery {
    func entities(for identifiers: [Int]) async throws -> [IslandEntity] {
        candidates().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [IslandEntity] {
        candidates()
    }

    private func candidates() -> [IslandEntity] {
        (OutsideStore.read()?.islands ?? [])
            .map { IslandEntity(id: $0.slot, name: $0.name, alive: $0.alive) }
    }
}

struct PinnedCompanyIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Pinned company"
    static var description = IntentDescription(
        "Always show this company, whichever one is actually open.")

    @Parameter(title: "Company")
    var island: IslandEntity?
}

struct IslandPinEntry: TimelineEntry {
    let date: Date
    let island: OutsideIsland?
    /// The slot the game currently has open, so the card can say so. Not the
    /// same thing as `island.slot` — that is only equal when the pin happens
    /// to be pointed at today's active company.
    let openSlot: Int?
}

struct IslandPinProvider: AppIntentTimelineProvider {
    private static let placeholderIsland = OutsideIsland(
        slot: 0, name: "Brewzo", industry: "FOOD", symbol: "fork.knife",
        year: 3, alive: true, endedBy: nil,
        valuation: 4_100_000, valuationText: "$4.1M",
        peak: 4_400_000, peakText: "$4.4M",
        cashText: "$412K", atGate: false, month: 7, stageName: "Startup")

    func placeholder(in context: Context) -> IslandPinEntry {
        IslandPinEntry(date: Date(), island: Self.placeholderIsland, openSlot: 0)
    }

    func snapshot(for configuration: PinnedCompanyIntent, in context: Context) async -> IslandPinEntry {
        context.isPreview
            ? IslandPinEntry(date: Date(), island: Self.placeholderIsland, openSlot: 0)
            : entry(for: configuration)
    }

    func timeline(
        for configuration: PinnedCompanyIntent, in context: Context
    ) async -> Timeline<IslandPinEntry> {
        Timeline(
            entries: [entry(for: configuration)],
            policy: .after(Date().addingTimeInterval(60 * 60)))
    }

    /**
     Resolves the pin against today's archipelago.

     A slot that no longer holds the company it was pinned to (buried, or
     never founded on this device at all) falls through to whichever island
     is open, and — nothing open either — to the first island there is,
     rather than a widget that goes blank because the exact company it wants
     is not there this minute. `NoCompany` is what a player with no company AT
     ALL sees; a pin that briefly cannot find its target should not look the
     same as a device nobody has played on.
     */
    private func entry(for configuration: PinnedCompanyIntent) -> IslandPinEntry {
        let snapshot = OutsideStore.read()
        let islands = snapshot?.islands ?? []
        let picked = configuration.island.flatMap { chosen in
            islands.first { $0.slot == chosen.id }
        }
        let island = picked
            ?? islands.first { $0.slot == snapshot?.company?.slot }
            ?? islands.first
        return IslandPinEntry(date: Date(), island: island, openSlot: snapshot?.company?.slot)
    }
}

struct IslandPinWidget: Widget {
    static let kind = "com.novuspitch.widget.island.pin"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: Self.kind, intent: PinnedCompanyIntent.self, provider: IslandPinProvider()
        ) { entry in
            IslandPinView(entry: entry)
                .containerBackground(Nv.bg, for: .widget)
        }
        .configurationDisplayName("One company, pinned")
        .description("Always this company, whichever one is actually open.")
        .supportedFamilies([.systemSmall])
    }
}

struct IslandPinView: View {
    let entry: IslandPinEntry

    var body: some View {
        if let island = entry.island {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) {
                    Image(systemName: island.alive ? island.symbol : "xmark")
                        .font(.system(size: 10, weight: .semibold))
                    Text(island.name.uppercased())
                        .font(NvType.label(11, weight: .black))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Spacer(minLength: 4)
                    // A dot, not a word: this card is a pin, and the ordinary
                    // reader of it is the player who put it there and already
                    // knows which company it names. Whether it also happens
                    // to be the one open right now is a footnote, not a
                    // headline — a coloured dot earns that without spending a
                    // line of text on it.
                    if entry.openSlot == island.slot {
                        Circle().fill(Nv.action).frame(width: 5, height: 5)
                    }
                }
                .foregroundStyle(island.alive ? Nv.primary : Nv.tertiary)

                Spacer(minLength: 9)

                Text(headline)
                    .font(NvType.figure(20, weight: .bold))
                    .foregroundStyle(Nv.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(subtitle)
                    .font(NvType.label(10, weight: .semibold))
                    .foregroundStyle(Nv.tertiary)
                    .lineLimit(1)

                Spacer(minLength: 9)

                HStack(spacing: 0) {
                    Text("CASH")
                        .font(NvType.label(9, weight: .bold))
                        .tracking(0.6)
                        .foregroundStyle(Nv.tertiary)
                    Spacer(minLength: 6)
                    Text(island.cashText)
                        .font(NvType.figure(13, weight: .bold))
                        .foregroundStyle(Nv.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(URL(string: "\(OutsideStore.scheme)://\(destination(island))"))
        } else {
            NoCompany(compact: true)
        }
    }

    private var headline: String {
        guard let island = entry.island else { return "" }
        return island.alive ? island.valuationText : "Chapter 7"
    }

    private var subtitle: String {
        guard let island = entry.island else { return "" }
        if !island.alive { return "Buried" }
        return island.atGate ? "PITCH DUE" : island.stageName
    }

    /// A dead company opens the picker rather than itself, same reasoning as
    /// `StillStandingView.destination` above: there is nothing to play on an
    /// island with a headstone on it.
    private func destination(_ island: OutsideIsland) -> String {
        island.alive ? "island/\(island.slot)" : "islands"
    }
}
