import SwiftUI
import WidgetKit

/**
 Where every widget in this bundle gets its numbers.

 One provider for all of them, because they all answer the same question from
 the same file — there is exactly one snapshot on disk and no widget here has
 a configuration that would make it want a different one.

 ── The refresh policy, and why it is an hour ────────────────────────────────

 Nothing on a home screen widget in this game changes on a clock. Time moves
 when the player taps (Brand Law 1), and the app calls
 `WidgetCenter.reloadAllTimelines()` the moment it does, so the ordinary path
 has no schedule in it at all.

 An hour is the backstop under that, and it is a backstop for one specific
 failure: a reload requested while the system was rationing them is dropped,
 not deferred. Without a policy the widget would then hold the old numbers
 until the next tap — which in a game somebody plays twice a week is days. An
 hour costs a handful of refresh budget and cannot show anything but the truth,
 because it re-reads the same file the app writes.

 `.never` would also be defensible and is the one thing that turns a dropped
 reload into a permanently wrong widget, which is the failure worth spending
 budget to avoid.
 */
struct OutsideEntry: TimelineEntry {
    let date: Date
    let snapshot: OutsideSnapshot
}

struct OutsideProvider: TimelineProvider {

    /// The gallery, and the frame before the real file has been read. A
    /// plausible company rather than zeroes — see `OutsideSnapshot.placeholder`.
    func placeholder(in context: Context) -> OutsideEntry {
        OutsideEntry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (OutsideEntry) -> Void) {
        // The widget gallery is a shop window. Showing a real player's real
        // company there is correct once they have one; showing "no company
        // open" to somebody deciding whether to add the widget is not.
        let snapshot: OutsideSnapshot =
            context.isPreview ? .placeholder : (OutsideStore.read() ?? .placeholder)
        completion(OutsideEntry(date: Date(), snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OutsideEntry>) -> Void) {
        /*
         Nil is not the placeholder here, and that difference matters.

         `read()` returns nil for a device where nothing has ever been
         published — a fresh install, or a player who has not opened the game
         yet — and the honest thing to draw then is the empty state, which
         invites them in. Falling back to the placeholder would put a fictional
         company called Brewzo on a real home screen and let it sit there.
         */
        let snapshot = OutsideStore.read()
        let entry = OutsideEntry(
            date: Date(),
            snapshot: snapshot ?? OutsideSnapshot(
                v: outsideWireVersion, company: nil, market: nil, islands: [],
                liveActivities: false, at: 0))

        completion(
            Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(60 * 60))))
    }
}

// ── The empty state ─────────────────────────────────────────────────────────

/**
 What a widget says when there is no company to show.

 Deliberately an invitation rather than an error. There are exactly two ways to
 get here — the game has never been opened on this device, or every company on
 it has been buried — and in both the useful thing a home screen can do is
 offer the door.
 */
struct NoCompany: View {
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 3 : 5) {
            Text("NOVUS")
                .font(NvType.label(11, weight: .black))
                .tracking(1.4)
                .foregroundStyle(Nv.action)

            Text("No company open")
                .font(NvType.label(compact ? 13 : 15, weight: .bold))
                .foregroundStyle(Nv.primary)

            if !compact {
                Text("Found one, and the year starts burning.")
                    .font(NvType.label(11, weight: .medium))
                    .foregroundStyle(Nv.tertiary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(URL(string: "\(OutsideStore.scheme)://islands"))
    }
}
