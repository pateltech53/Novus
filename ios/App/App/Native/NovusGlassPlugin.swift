import Capacitor
import Foundation
import UIKit
import WebKit

/**
 The bridge between the game and its chrome.

 The web layer describes what it wants — these tabs, this button, this label —
 and gets back the exact number of points UIKit ended up using. It never draws
 the chrome itself and it never assumes a height. Everything that could be a
 guess is a measurement instead.

 Registered explicitly from `NovusBridgeViewController.capacitorDidLoad()`
 rather than left to runtime discovery, so there is no arrangement of linker
 flags or dead-stripping under which the plugin quietly fails to exist and the
 app falls back to web chrome without anyone noticing.
 */
@objc(NovusGlassPlugin)
public class NovusGlassPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "NovusGlassPlugin"
    public let jsName = "NovusGlass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setChrome", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setOverlay", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "toast", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentSheet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismissSheet", returnType: CAPPluginReturnPromise),
    ]

    private var chrome: GlassChromeController?
    private var overlay: GlassOverlayController?
    private var sheet: GlassSheetController?

    // ── Methods ──────────────────────────────────────────────────────────────

    @objc func capabilities(_ call: CAPPluginCall) {
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        call.resolve([
            "available": true,
            "liquidGlass": GlassKit.hasLiquidGlass,
            "osVersion": major,
        ])
    }

    @objc func configure(_ call: CAPPluginCall) {
        let theme = call.getString("theme") ?? "dark"

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let host = self.bridge?.viewController?.view else {
                call.reject("No view controller to host the chrome")
                return
            }

            let controller = self.chrome ?? GlassChromeController()
            if self.chrome == nil {
                controller.onTab = { [weak self] id in
                    self?.notifyListeners("tabSelected", data: ["id": id])
                }
                controller.onPrimary = { [weak self] in
                    self?.notifyListeners("primaryAction", data: [String: Any]())
                }
                controller.onControl = { [weak self] id in
                    self?.notifyListeners("controlSelected", data: ["id": id])
                }
                controller.onInsetsChanged = { [weak self] insets in
                    self?.notifyListeners("insetsChanged", data: Self.payload(insets))
                }
                self.chrome = controller
            }

            // The overlay chrome installs alongside it and stays empty until a
            // screen asks for something. Installing here rather than lazily on
            // the first `setOverlay` is what keeps it ABOVE the play chrome:
            // both are subviews of the same view, and z-order is insertion
            // order, so a host added later than the tab bar is a host that
            // draws over it.
            let overlayController = self.overlay ?? GlassOverlayController()
            if self.overlay == nil {
                overlayController.onAction = { [weak self] id in
                    self?.notifyListeners("overlayAction", data: ["id": id])
                }
                overlayController.onSegment = { [weak self] id in
                    self?.notifyListeners("overlaySegment", data: ["id": id])
                }
                overlayController.onInsetsChanged = { [weak self] insets in
                    self?.notifyListeners(
                        "overlayInsets",
                        data: ["top": Double(insets.top), "bottom": Double(insets.bottom)])
                }
                self.overlay = overlayController
            }

            controller.install(in: host)
            overlayController.install(in: host)

            /*
             A new document inherits the chrome of the one before it, so this
             clears it.

             `configure()` runs once per launch of the web layer, and the web
             layer launches again on every document navigation — signing out,
             deleting an account, the door out of Settings back to the islands.
             A document navigation destroys the React tree without running one
             effect cleanup, and both controllers here are subviews of the view
             controller rather than of the page, so everything the previous
             screen declared survived: Settings arrived on the islands screen
             as a floating toolbar and a dock still offering to sign you out,
             on top of a page that had never heard of either. The dock sits
             exactly where the play screen's ADVANCE capsule does, so the
             control that moves time was taking taps meant for it and answering
             a screen that no longer existed.

             The web side pushes the same withdrawal from `pagehide`, which is
             what keeps the gap BETWEEN the two documents clean. This is the
             one that is guaranteed to run.
             */
            let insets = controller.reset()
            overlayController.reset()
            // A first paint with the wrong ground is worse than a late one:
            // the webview's own background shows through for the frame before
            // the page has painted, and it must match the theme it is about
            // to become rather than the system default.
            self.bridge?.webView?.backgroundColor =
                theme == "dark"
                ? UIColor(red: 0.11, green: 0.114, blue: 0.129, alpha: 1)
                : UIColor(red: 0.965, green: 0.969, blue: 0.976, alpha: 1)
            self.bridge?.webView?.scrollView.backgroundColor = self.bridge?.webView?.backgroundColor

            call.resolve(Self.payload(insets))
        }
    }

    @objc func setChrome(_ call: CAPPluginCall) {
        let state = Self.parse(call)

        DispatchQueue.main.async { [weak self] in
            guard let self, let chrome = self.chrome else {
                call.reject("configure() has not run")
                return
            }
            let insets = chrome.apply(state)
            call.resolve(Self.payload(insets))
        }
    }

    /**
     The chrome for a screen that is not the play screen.

     Same contract as `setChrome`: the web layer says what it wants and gets
     back the number of points UIKit actually used. Declarative and idempotent
     — a screen pushes its whole chrome on every change and the controller
     works out what that means, because a diffing protocol across a bridge is
     a second source of truth about what is on screen.
     */
    @objc func setOverlay(_ call: CAPPluginCall) {
        let state = Self.parseOverlay(call)

        DispatchQueue.main.async { [weak self] in
            guard let self, let overlay = self.overlay else {
                call.reject("configure() has not run")
                return
            }
            let insets = overlay.apply(state)
            call.resolve(["top": Double(insets.top), "bottom": Double(insets.bottom)])
        }
    }

    @objc func toast(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let text = call.getString("text") ?? ""
        let tone = call.getString("tone") ?? "neutral"
        guard !text.isEmpty else {
            call.resolve()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.chrome?.toast(title: title, text: text, tone: tone)
            call.resolve()
        }
    }

    /**
     Puts a decision on screen as a real sheet over a real blurred game.

     Presenting replaces whatever was up: the engine only ever has one card
     open, and a stale sheet outliving the month it belonged to is worse than
     a missed animation.
     */
    @objc func presentSheet(_ call: CAPPluginCall) {
        guard let spec = Self.parseSheet(call) else {
            call.reject("A sheet needs at least an id and a title")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let host = self.bridge?.viewController else {
                call.reject("No view controller to present from")
                return
            }

            let controller = GlassSheetController(spec: spec)
            controller.onChoose = { [weak self] id, index in
                self?.sheet = nil
                self?.notifyListeners("sheetChoice", data: ["id": id, "index": index])
            }
            controller.onAction = { [weak self] id in
                self?.sheet = nil
                self?.notifyListeners("sheetAction", data: ["id": id])
            }
            controller.onDismissed = { [weak self] id in
                self?.sheet = nil
                self?.notifyListeners("sheetDismissed", data: ["id": id])
            }

            /*
             ── Why this is not one line ──────────────────────────────────────

             `present` onto a controller that is already presenting does
             nothing. It does not throw and it does not call back; it writes a
             line to the console and returns, and the sheet simply never
             appears.

             That is a dead game rather than a missed animation. The web layer
             records the card as presented BEFORE the call — that is what stops
             a re-render re-presenting it — and it renders no DOM sheet behind
             a native one. So a refused presentation is a month with a decision
             open, no card on screen to answer it with, and the play chrome
             withdrawn because a card is open. Nothing on the screen does
             anything.

             This used to replace one sheet with another by dismissing the old
             one and presenting the new one 50ms later. An animated dismissal
             takes about five times that, so the second card lost the race with
             the first card's exit whenever the engine queued two.
             */
            let present: () -> Void = { [weak self] in
                guard let self else { return }
                self.sheet = controller
                // Unanimated on purpose — GlassSheetController choreographs its
                // own entrance so the backdrop and the panel can move
                // independently.
                host.present(controller, animated: false)

                // Checked on the next turn of the runloop, which is after UIKit
                // has decided. A rejection is not a failure the player sees:
                // the web side answers it by rendering its own sheet, which is
                // the same card in the same words on a material one step down.
                DispatchQueue.main.async {
                    if controller.presentingViewController == nil {
                        if self.sheet === controller { self.sheet = nil }
                        call.reject("The sheet could not be presented")
                    } else {
                        call.resolve()
                    }
                }
            }

            if let existing = self.sheet {
                self.sheet = nil
                // In the completion, never on a timer: the dismissal is what
                // frees the presenter, so it is the only thing that knows when
                // presenting again can work.
                existing.closeWithoutAnswering(then: present)
            } else if let blocking = host.presentedViewController {
                // Something this plugin did not put there, or a sheet whose
                // dismissal outlived the reference to it. Either way it is what
                // would refuse the presentation.
                blocking.dismiss(animated: false, completion: present)
            } else {
                present()
            }
        }
    }

    /// Closed by the game rather than by the player. Resolves either way: the
    /// web side calls this whenever its own state says no card is open, and
    /// "there was nothing to close" is a correct outcome, not an error.
    @objc func dismissSheet(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.sheet?.closeWithoutAnswering()
            self?.sheet = nil
            call.resolve()
        }
    }

    // ── Wire format ──────────────────────────────────────────────────────────

    private static func payload(_ insets: ChromeInsets) -> [String: Any] {
        var out: [String: Any] = [
            "top": Double(insets.top),
            "bottom": Double(insets.bottom),
            "tabBar": Double(insets.tabBar),
        ]
        // Absent rather than null when nothing is spotlit: the web side reads
        // this as "no native target for this step" and falls back to looking
        // for a DOM element, which is the common case.
        if let rect = insets.coach {
            out["coach"] = [
                "top": Double(rect.minY),
                "left": Double(rect.minX),
                "width": Double(rect.width),
                "height": Double(rect.height),
            ]
        }
        return out
    }

    private static func str(_ object: JSObject, _ key: String) -> String? {
        object[key] as? String
    }

    private static func bool(_ object: JSObject, _ key: String, _ fallback: Bool) -> Bool {
        (object[key] as? NSNumber)?.boolValue ?? (object[key] as? Bool) ?? fallback
    }

    private static func parse(_ call: CAPPluginCall) -> ChromeState {
        let tabs: [ChromeTab] = (call.getArray("tabs", JSObject.self) ?? []).compactMap { raw in
            guard let id = str(raw, "id"), let title = str(raw, "title") else { return nil }
            return ChromeTab(id: id, title: title, symbol: str(raw, "symbol") ?? "circle")
        }

        let controls: [ChromeControl] = (call.getArray("controls", JSObject.self) ?? [])
            .compactMap { raw in
                guard let id = str(raw, "id") else { return nil }
                return ChromeControl(
                    id: id,
                    symbol: str(raw, "symbol"),
                    text: str(raw, "text"),
                    label: str(raw, "label") ?? id,
                    style: str(raw, "style") ?? "plain",
                    leading: bool(raw, "leading", false))
            }

        var cta: ChromeCta?
        if let raw = call.getObject("cta"), let title = str(raw, "title") {
            let badge = str(raw, "badge") ?? ""
            cta = ChromeCta(
                title: title,
                badge: badge,
                badgeLabel: str(raw, "badgeLabel") ?? badge,
                style: str(raw, "style") ?? "action",
                enabled: bool(raw, "enabled", true),
                locked: bool(raw, "locked", false))
        }

        return ChromeState(
            mode: call.getString("mode") ?? "hidden",
            theme: call.getString("theme") ?? "dark",
            tabs: tabs,
            activeTab: call.getString("activeTab"),
            cta: cta,
            controls: controls,
            coach: call.getString("coach"))
    }

    private static func overlayButtons(_ raw: [JSObject]?) -> [OverlayButton] {
        (raw ?? []).compactMap { item in
            guard let id = str(item, "id") else { return nil }
            return OverlayButton(
                id: id,
                title: str(item, "title"),
                symbol: str(item, "symbol"),
                label: str(item, "label") ?? str(item, "title") ?? id,
                style: str(item, "style") ?? "plain",
                enabled: bool(item, "enabled", true))
        }
    }

    private static func parseOverlay(_ call: CAPPluginCall) -> OverlayState {
        let segments: [OverlaySegment] = (call.getArray("segments", JSObject.self) ?? [])
            .compactMap { raw in
                guard let id = str(raw, "id"), let title = str(raw, "title") else { return nil }
                return OverlaySegment(id: id, title: title)
            }

        return OverlayState(
            mode: call.getString("mode") ?? "hidden",
            theme: call.getString("theme") ?? "dark",
            title: call.getString("title"),
            eyebrow: call.getString("eyebrow"),
            leading: overlayButtons(call.getArray("leading", JSObject.self)),
            trailing: overlayButtons(call.getArray("trailing", JSObject.self)),
            segments: segments,
            activeSegment: call.getString("activeSegment"),
            actions: overlayButtons(call.getArray("actions", JSObject.self)))
    }

    private static func parseSheet(_ call: CAPPluginCall) -> SheetSpec? {
        guard let id = call.getString("id"), let title = call.getString("title") else { return nil }

        let choices: [SheetChoice] = (call.getArray("choices", JSObject.self) ?? [])
            .compactMap { raw in
                guard let label = str(raw, "label") else { return nil }
                return SheetChoice(
                    label: label, cost: str(raw, "cost"), camera: bool(raw, "camera", false))
            }

        let notes: [SheetNote] = (call.getArray("notes", JSObject.self) ?? [])
            .compactMap { raw in
                guard let term = str(raw, "term"), let text = str(raw, "text") else { return nil }
                return SheetNote(term: term, text: text)
            }

        return SheetSpec(
            id: id,
            eyebrow: call.getString("eyebrow") ?? "",
            eyebrowStyle: call.getString("eyebrowStyle") ?? "plain",
            eyebrowDetail: call.getString("eyebrowDetail"),
            title: title,
            body: call.getString("body") ?? "",
            notes: notes,
            hintTitle: call.getString("hintTitle"),
            hintText: call.getString("hintText"),
            choices: choices,
            actionLabel: call.getString("actionLabel"),
            actionCamera: call.getBool("actionCamera") ?? false,
            dismissible: call.getBool("dismissible") ?? true,
            theme: call.getString("theme") ?? "dark")
    }
}
