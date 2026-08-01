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
    ]

    private var chrome: GlassChromeController?

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

            let insets = controller.install(in: host)
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
        let text = call.getString("text") ?? ""
        let tone = call.getString("tone") ?? "neutral"
        guard !text.isEmpty else {
            call.resolve()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.chrome?.toast(text: text, tone: tone)
            call.resolve()
        }
    }

    // ── Wire format ──────────────────────────────────────────────────────────

    private static func payload(_ insets: ChromeInsets) -> [String: Any] {
        [
            "top": Double(insets.top),
            "bottom": Double(insets.bottom),
            "tabBar": Double(insets.tabBar),
        ]
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
            controls: controls)
    }
}
