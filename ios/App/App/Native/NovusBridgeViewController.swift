import Capacitor
import UIKit

/**
 The app's root view controller.

 One job beyond what Capacitor's own does: registering `NovusGlassPlugin` by
 hand. Capacitor can find plugins by scanning the Objective-C runtime, but a
 plugin compiled into the app target rather than shipped as a package is
 exactly the case where a linker that dead-strips an apparently unreferenced
 class makes it silently not exist. Naming it here is one line, and it turns a
 class of bug that only shows up in a Release build into one that cannot
 happen.

 `capacitorDidLoad()` is the documented hook for this, and it runs after the
 bridge exists and before the web layer's first call reaches it.
 */
class NovusBridgeViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NovusGlassPlugin())
    }
}
