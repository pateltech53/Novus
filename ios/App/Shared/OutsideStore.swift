import Foundation

#if canImport(WidgetKit)
    import WidgetKit
#endif

/**
 The one piece of ground the app and its widgets both stand on.

 A widget extension is a separate process with a separate container. It cannot
 read the app's `localStorage`, its `Documents` directory or its `UserDefaults`
 — the ONLY thing the two share is an App Group, and everything that crosses
 goes through this file.

 ── Why a file and not `UserDefaults` alone ──────────────────────────────────

 It is both, and the file is the truth. Shared `UserDefaults` is convenient and
 has one property that matters here: writes from an app that is being suspended
 are not guaranteed to be visible to an extension that reads a moment later,
 because the two processes hold independent caches of the same plist and the
 sync point is not under our control. A snapshot written at the moment the
 player put the phone down is exactly the snapshot that matters most.

 So the payload is an atomic file write inside the group container — which is
 visible to the other process the instant it returns — and `UserDefaults`
 carries only the timestamp, as a cheap "is there anything new" that costs no
 file read. Neither is load-bearing on its own.
 */
enum OutsideStore {

    /**
     The App Group both targets are members of.

     This string is duplicated in exactly three places, and all three are
     entitlements files rather than code: `App/App.entitlements`,
     `NovusWidgets/NovusWidgets.entitlements`, and the App Group registered on
     the developer account. If the widget is permanently empty, this is the
     first thing to check — a group the app can write and the widget cannot
     read fails silently and looks precisely like a widget that was never
     published to.
     */
    static let appGroup = "group.com.novuspitch.app"

    /// The custom scheme the widgets link back through. See lib/outside/links.ts.
    static let scheme = "novus"

    private static let fileName = "outside.json"
    private static let stampKey = "novus.outside.publishedAt"

    // ── Where it lives ──────────────────────────────────────────────────────

    private static var container: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    // ── Writing (the app) ───────────────────────────────────────────────────

    /**
     Store a snapshot, already encoded.

     Takes `Data` rather than a struct on purpose: the bridge hands over the
     exact JSON the web layer produced, and re-encoding it here would mean
     decoding and re-serialising a payload for no reason other than to change
     which process wrote the bytes. What is stored is what the app sent.

     Returns false when there is no container — which means the App Group
     capability is missing from one of the two targets, and is worth reporting
     rather than swallowing.
     */
    @discardableResult
    static func write(_ data: Data) -> Bool {
        guard let url = container?.appendingPathComponent(fileName) else { return false }
        do {
            // Atomic: a widget that reads mid-write must see the previous
            // snapshot whole, never half of two.
            try data.write(to: url, options: .atomic)
            defaults?.set(Date().timeIntervalSince1970, forKey: stampKey)
            return true
        } catch {
            return false
        }
    }

    /// Every widget family, redrawn. Cheap — WidgetKit coalesces its own work.
    static func reloadWidgets() {
        #if canImport(WidgetKit)
            WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    // ── Reading (both) ──────────────────────────────────────────────────────

    /**
     The last published snapshot, or nil.

     Nil covers every failure identically and on purpose: no container, no file
     yet, a half-written file, a wire version this binary does not understand.
     Each one means "this extension has nothing true to draw", and a widget
     with nothing true to draw has one correct behaviour, which is its empty
     state — not a crash, and not last week's numbers dressed as this week's.
     */
    static func read() -> OutsideSnapshot? {
        guard let url = container?.appendingPathComponent(fileName),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return decode(data)
    }

    static func decode(_ data: Data) -> OutsideSnapshot? {
        guard let snapshot = try? JSONDecoder().decode(OutsideSnapshot.self, from: data) else {
            return nil
        }
        /*
         A snapshot from a newer app than this extension.

         This happens for real: iOS updates an app and its extensions together,
         but a Live Activity started by the previous binary keeps running, and
         a widget's timeline is not rebuilt on install. Refusing outright is
         the honest answer — a partial read of a shape that has changed draws a
         confident, wrong number, and a wrong number in a game about money is
         worse than an empty card.
         */
        guard snapshot.v == outsideWireVersion else { return nil }
        return snapshot
    }

    /// True when a snapshot has ever been published on this device.
    static var hasPublished: Bool {
        (defaults?.double(forKey: stampKey) ?? 0) > 0
    }

    // ── Clearing ────────────────────────────────────────────────────────────

    /// Used by nothing in the normal path. Kept because "the widget still shows
    /// a company I deleted" is otherwise unanswerable from the app side.
    static func clear() {
        if let url = container?.appendingPathComponent(fileName) {
            try? FileManager.default.removeItem(at: url)
        }
        defaults?.removeObject(forKey: stampKey)
        reloadWidgets()
    }
}
