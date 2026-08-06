import Capacitor
import UIKit

/**
 The app's root view controller.

 One job beyond what Capacitor's own does: registering this app's two plugins
 by hand. Capacitor can find plugins by scanning the Objective-C runtime, but a
 plugin compiled into the app target rather than shipped as a package is
 exactly the case where a linker that dead-strips an apparently unreferenced
 class makes it silently not exist. Naming them here is one line each, and it
 turns a class of bug that only shows up in a Release build into one that
 cannot happen.

 `capacitorDidLoad()` is the documented hook for this, and it runs after the
 bridge exists and before the web layer's first call reaches it.
 */
class NovusBridgeViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        // The Liquid Glass chrome — ios/App/App/Native/.
        bridge?.registerPluginInstance(NovusGlassPlugin())
        // The widgets and the Live Activities — ios/App/App/Outside/.
        bridge?.registerPluginInstance(NovusOutsidePlugin())
    }
}
