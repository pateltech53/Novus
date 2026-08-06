import Capacitor
import Foundation
import UIKit

/**
 The bridge between the game and everything the phone draws without it.

 One method does the work. The web layer publishes the whole of what should be
 true — see `lib/outside/publish.ts` — and this decides what that means for a
 shared container, four widget families and up to two Live Activities.

 Registered explicitly from `NovusBridgeViewController.capacitorDidLoad()`
 rather than left to runtime discovery, for the same reason `NovusGlassPlugin`
 is: a plugin compiled into the app target rather than shipped as a package is
 exactly the case where a linker that dead-strips an apparently unreferenced
 class makes it silently not exist.
 */
@objc(NovusOutsidePlugin)
public class NovusOutsidePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "NovusOutsidePlugin"
    public let jsName = "NovusOutside"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endActivities", returnType: CAPPluginReturnPromise),
    ]

    // ── Methods ──────────────────────────────────────────────────────────────

    @objc func capabilities(_ call: CAPPluginCall) {
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        call.resolve([
            "available": true,
            /*
             The widget extension's own deployment target, not the app's.

             The app runs on iOS 15 and the extension is built against 17,
             which is a legitimate arrangement — an extension may have a higher
             floor than the app that hosts it — and it means the honest answer
             to "are there widgets" is a version check rather than `true`.
             */
            "widgets": major >= 17,
            "liveActivities": LiveActivityDirector.authorized,
            "osVersion": major,
        ])
    }

    /**
     The whole of what the phone should show.

     Idempotent and safe to call as often as the run changes. The web side
     coalesces and de-duplicates before it gets here; this coalesces nothing
     and assumes nothing about how often it is called.
     */
    @objc func publish(_ call: CAPPluginCall) {
        guard let json = call.getString("snapshot"), let data = json.data(using: .utf8) else {
            call.reject("publish needs a `snapshot` string")
            return
        }

        /*
         Decoded here and stored as the ORIGINAL bytes.

         The decode is a validity check — a snapshot this binary cannot read
         must not reach the shared container, or every widget on the phone
         starts failing to decode a file it has no way to report on. What gets
         written is what the app sent, because re-encoding would make this
         process the author of a payload it merely relayed, and the two
         encoders would eventually differ on something that mattered.
         */
        guard let snapshot = OutsideStore.decode(data) else {
            // A wire version from a newer app than this binary. Refusing is
            // the honest answer; the web layer will not treat it as sent, so
            // an app updated ahead of its extension recovers on the next
            // launch rather than going quiet for good.
            call.resolve([
                "accepted": false,
                "widgetsReloaded": false,
                "fiscalYearLive": false,
                "marketLive": false,
            ])
            return
        }

        let stored = OutsideStore.write(data)
        if stored { OutsideStore.reloadWidgets() }

        /*
         ActivityKit on the main thread.

         `Activity.request` presents UI, and the documented requirement is that
         it is called from the main actor. This method arrives on Capacitor's
         own dispatch queue, so the hop is not optional — and it is the same
         hop every other plugin in this app makes for the same reason.
         */
        DispatchQueue.main.async {
            let live = LiveActivityDirector.apply(snapshot)
            call.resolve([
                "accepted": true,
                "widgetsReloaded": stored,
                "fiscalYearLive": live.fiscalYear,
                "marketLive": live.market,
            ])
        }
    }

    /// Everything down, now. Resolves either way: "there was nothing to end"
    /// is a correct outcome, not an error.
    @objc func endActivities(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            LiveActivityDirector.endAll()
            call.resolve()
        }
    }
}
