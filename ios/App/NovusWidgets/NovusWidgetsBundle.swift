import SwiftUI
import WidgetKit

/**
 Everything Novus draws outside itself.

 Seven entries: four Home Screen and Lock Screen widgets, one that ticks on its
 own, and two Live Activities. They all read the same file — see
 `OutsideStore` — which the app writes on every change and nowhere else.

 ── The floor is iOS 17, and the app's is 15 ─────────────────────────────────

 An extension may target a later OS than the app that hosts it, and this one
 does. iOS 17 is where `containerBackground` became mandatory for Home Screen
 widgets, where `AccessoryWidgetBackground` and the accessory families settled,
 and where a widget that does not adopt them renders with no background at all
 — which looks like a broken widget rather than a deliberately transparent one.

 So the extension asks for 17, the app keeps 15, and `NovusOutsidePlugin`
 reports `widgets: false` below that so the app never claims a capability the
 device does not have.

 The two Live Activities need 16.2 for `ActivityConfiguration` and are guarded
 by `#available` inside the bundle rather than by the deployment target: a
 `WidgetBundle` body cannot itself be annotated, so the guard goes where the
 entries are declared.
 */
@main
struct NovusWidgetsBundle: WidgetBundle {

    init() {
        #if DEBUG
            /*
             Two ports live in this bundle — the tape and the money format —
             and both are checked against the engine's own answers on every
             debug launch. Compiled out entirely in Release.

             Here rather than in a test target because the failure this is
             guarding against is a silent one: a widget showing a confidently
             wrong price looks exactly like a widget showing a right one, and
             nobody runs a test they did not know they needed.
             */
            MarketMath.verifyAgainstFixture()
            NvFormat.verifyAgainstFixture()
        #endif
    }

    var body: some Widget {
        // The Home Screen.
        TheBooksWidget()
        TheYearWidget()
        StillStandingWidget()
        MarketWidget()

        // The Lock Screen and StandBy.
        RunwayCircularWidget()
        BooksRectangularWidget()
        RunwayInlineWidget()

        /*
         The Lock Screen, live, and the Dynamic Island.

         Unguarded, and that is not an oversight. Both types are annotated
         `@available(iOS 16.2, *)`, which is BELOW this extension's deployment
         target of 17.0, so they are unconditionally available here and Swift
         needs no `#available` to say so. Writing one anyway would put an `if`
         inside `@WidgetBundleBuilder`, which is not a result builder that
         handles branches.
         */
        FiscalYearActivity()
        MarketActivity()
    }
}
