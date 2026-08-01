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
        CAPPluginMethod(name: "toast", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentSheet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dismissSheet", returnType: CAPPluginReturnPromise),
    ]

    private var chrome: GlassChromeController?
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

            // The webview's own scroll view goes in so the chrome can read the
            // page's scroll position for the scroll-edge bar without the web
            // layer posting an offset across the bridge sixty times a second.
            let insets = controller.install(in: host, scrollView: self.bridge?.webView?.scrollView)
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

            let present = {
                self.sheet = controller
                // Unanimated on purpose — GlassSheetController choreographs its
                // own entrance so the backdrop and the panel can move
                // independently.
                host.present(controller, animated: false)
                call.resolve()
            }

            if let existing = self.sheet {
                existing.closeWithoutAnswering()
                self.sheet = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: present)
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

    private static func int(_ object: JSObject, _ key: String, _ fallback: Int) -> Int {
        (object[key] as? NSNumber)?.intValue ?? fallback
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
            cta = ChromeCta(
                title: title,
                caption: str(raw, "caption") ?? "",
                progress: int(raw, "progress", 0),
                total: max(int(raw, "total", 12), 1),
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
