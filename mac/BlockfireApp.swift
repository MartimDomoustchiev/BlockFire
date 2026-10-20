// ============================================================
// BLOCKFIRE for macOS: a small native shell around the game.
//
// The game itself is the same HTML + JS as always (copied into the
// app's Resources/game folder by build.sh); this file gives it a
// proper Mac window: its own Dock icon and menu bar, native full
// screen, remembered window size, and no browser around it.
//
// Talks to the page through window.webkit.messageHandlers.native:
//   { type: 'fullscreen' }            toggle native full screen
//   { type: 'quit' }                  quit the app
//   { type: 'report', data: {...} }   self-test results (--selftest)
// and tells the page it is running in the app (window.__nativeApp).
//
// Launch arguments (for testing):
//   --selftest [mode] --report <file>   run the game, probe what works, write JSON, quit
// ============================================================
import Cocoa
import WebKit

final class GameWebView: WKWebView {
    override var acceptsFirstResponder: Bool { true }
    // clicking into an inactive window should also reach the game (one click, not two)
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: GameWebView!
    let args = CommandLine.arguments
    var selfTest: Bool { args.contains("--selftest") }

    func arg(after flag: String) -> String? {
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        let content = config.userContentController
        content.add(self, name: "native")
        let marker = "window.__nativeApp = { platform: 'mac', version: '\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? "1")' };"
        content.addUserScript(WKUserScript(source: marker, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if selfTest {
            content.addUserScript(WKUserScript(source: """
                window.__errors = []; window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
                window.__probe = { clicks: 0, mousedowns: 0, plErrors: 0, plChanges: 0 };
                document.addEventListener('click', () => {
                  window.__probe.clicks++;
                  const c = document.getElementById('gl');
                  window.__probe.hasApi = typeof c.requestPointerLock;
                  try {
                    const r = c.requestPointerLock();
                    window.__probe.returned = String(r);
                    if (r && r.then) r.then(() => { window.__probe.result = 'resolved'; }, (e) => { window.__probe.result = 'rejected: ' + e; });
                  } catch (e) { window.__probe.result = 'threw: ' + e; }
                }, true);
                document.addEventListener('mousedown', () => window.__probe.mousedowns++, true);
                document.addEventListener('pointerlockerror', () => window.__probe.plErrors++);
                document.addEventListener('pointerlockchange', () => window.__probe.plChanges++);
                """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        webView = GameWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsMagnification = false
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")

        let frame = NSRect(x: 0, y: 0, width: 1280, height: 800)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "BLOCKFIRE"
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(red: 0.078, green: 0.094, blue: 0.122, alpha: 1)
        window.collectionBehavior = [.fullScreenPrimary]
        window.minSize = NSSize(width: 800, height: 500)
        window.acceptsMouseMovedEvents = true
        window.contentView = webView
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("BLOCKFIRE.main")
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        NSApp.activate(ignoringOtherApps: true)

        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("game") else { return }
        var url = dir.appendingPathComponent("index.html")
        if selfTest {
            let mode = args.drop(while: { $0 != "--selftest" }).dropFirst().first(where: { !$0.hasPrefix("--") }) ?? "story"
            url = URL(string: url.absoluteString + "?autostart=1&mode=\(mode)&rd=4") ?? url
        }
        webView.loadFileURL(url, allowingReadAccessTo: dir)
        if selfTest { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.pollReady(tries: 0) } }
        // back into full screen if that's how it was left
        else if UserDefaults.standard.bool(forKey: "fullscreen") { DispatchQueue.main.async { self.window.toggleFullScreen(nil) } }
    }

    // ---------------------------------------------------------------- full screen
    var isFullscreen: Bool { window.styleMask.contains(.fullScreen) }

    func tellPageFullscreen() {
        webView.evaluateJavaScript("window.__appFullscreen && window.__appFullscreen(\(isFullscreen))", completionHandler: nil)
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        if !selfTest { UserDefaults.standard.set(true, forKey: "fullscreen") }
        tellPageFullscreen()
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        if !selfTest { UserDefaults.standard.set(false, forKey: "fullscreen") }
        tellPageFullscreen()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { tellPageFullscreen() }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // ---------------------------------------------------------------- menu
    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About BLOCKFIRE", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide BLOCKFIRE", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit BLOCKFIRE", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        let fs = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(fs)
        viewMenu.addItem(withTitle: "Reload Game", action: #selector(reloadGame), keyEquivalent: "r")
        viewItem.submenu = viewMenu

        let winItem = NSMenuItem()
        main.addItem(winItem)
        let winMenu = NSMenu(title: "Window")
        winMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winItem.submenu = winMenu
        NSApp.windowsMenu = winMenu
        NSApp.mainMenu = main
    }

    @objc func reloadGame() { webView.reload() }

    // ---------------------------------------------------------------- page -> app
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "fullscreen": window.toggleFullScreen(nil)
        case "quit": NSApp.terminate(nil)
        case "report": writeReport(body["data"])
        default: break
        }
    }

    func windowDidResignKey(_ notification: Notification) {
        // leaving the window (Cmd-Tab...): give the mouse back, the game pauses itself
        webView.evaluateJavaScript("document.exitPointerLock && document.exitPointerLock()", completionHandler: nil)
    }

    // ---------------------------------------------------------------- pointer lock (WebKit asks the app; we allow it)
    @objc(_webViewDidRequestPointerLock:completionHandler:)
    func webViewDidRequestPointerLock(_ webView: WKWebView, completionHandler: @escaping (Bool) -> Void) {
        if selfTest { webView.evaluateJavaScript("window.__probe && (window.__probe.asked = (window.__probe.asked || 0) + 1)", completionHandler: nil) }
        completionHandler(true)
    }

    // older WebKit asks this way and wants the answer through its C page API
    @objc(_webViewRequestPointerLock:)
    func webViewRequestPointerLock(_ webView: WKWebView) {
        if selfTest { webView.evaluateJavaScript("window.__probe && (window.__probe.askedOld = 1)", completionHandler: nil) }
        let pageSel = NSSelectorFromString("_pageRefForTransitionToWKWebView")
        guard webView.responds(to: pageSel), let page = webView.perform(pageSel)?.toOpaque(),
              let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "WKPageDidAllowPointerLock") else { return }
        typealias Allow = @convention(c) (UnsafeMutableRawPointer) -> Void
        unsafeBitCast(sym, to: Allow.self)(page)
    }

    @objc(_webViewDidLosePointerLock:)
    func webViewDidLosePointerLock(_ webView: WKWebView) {}

    // open external links (if any) in the real browser, never inside the game window
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.scheme == "http" || url.scheme == "https", action.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // ---------------------------------------------------------------- self test
    func pollReady(tries: Int) {
        let js = "!!(window.__game && document.getElementById('loading').style.display === 'none')"
        webView.evaluateJavaScript(js) { result, _ in
            if (result as? Bool) == true || tries > 60 { self.runProbes(ready: (result as? Bool) == true) }
            else { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.pollReady(tries: tries + 1) } }
        }
    }

    /** A real mouse click in the middle of the window, as a player would (starts mouse look). */
    func clickCentre() {
        let p = NSPoint(x: webView.bounds.midX, y: webView.bounds.midY)
        let loc = webView.convert(p, to: nil)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            if let e = NSEvent.mouseEvent(with: type, location: loc, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                          windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
                window.sendEvent(e)
            }
        }
    }

    func runProbes(ready: Bool) {
        // pointer lock: click into the game like a player
        clickCentre()
        webView.evaluateJavaScript("1") { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                let probe = """
                (function () {
                  const g = window.__game, out = {};
                  out.ready = \(ready);
                  out.pointerLock = document.pointerLockElement ? document.pointerLockElement.id : null;
                  out.inputLocked = !!(window.__input && window.__input.locked);
                  out.webgl = !!document.createElement('canvas').getContext('webgl');
                  out.workers = typeof Worker !== 'undefined';
                  out.chunks = g ? g.world.chunks.size : 0;
                  out.time = g ? g.time : 0;
                  out.mode = g ? g.mode : null;
                  out.story = !!(g && g.story);
                  out.rtc = typeof RTCPeerConnection !== 'undefined';
                  out.audio = typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
                  out.gamepads = typeof navigator.getGamepads === 'function';
                  out.fullscreenApi = !!document.documentElement.requestFullscreen;
                  let prev = null;
                  try { prev = localStorage.getItem('blockfire.selftest'); localStorage.setItem('blockfire.selftest', String(Date.now())); out.storage = 'ok'; } catch (e) { out.storage = String(e); }
                  out.previousRun = prev;
                  out.errors = (window.__errors || []).slice(0, 5);
                  out.native = !!window.__nativeApp;
                  out.probe = window.__probe;
                  return JSON.stringify(out);
                })()
                """
                self.webView.evaluateJavaScript(probe) { result, error in
                    let t0 = (result as? String) ?? "{\"error\":\"\(String(describing: error))\"}"
                    // simulation speed: game seconds per real second over 3 s
                    self.webView.evaluateJavaScript("window.__game ? window.__game.time : 0") { a, _ in
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                            self.webView.evaluateJavaScript("window.__game ? window.__game.time : 0") { b, _ in
                                let speed = ((b as? Double) ?? 0) - ((a as? Double) ?? 0)
                                self.inputProbes { input in
                                    self.writeReport(["probe": t0, "simSecondsIn3s": speed, "input": input])
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /** Real key presses, mouse motion and the full screen button, as a player would use them. */
    func inputProbes(done: @escaping ([String: Any]) -> Void) {
        var out: [String: Any] = [:]
        let state = "JSON.stringify({ x: __game.player.pos.x, z: __game.player.pos.z, yaw: __game.player.yaw })"
        func key(_ down: Bool) {
            if let e = NSEvent.keyEvent(with: down ? .keyDown : .keyUp, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                        windowNumber: window.windowNumber, context: nil, characters: "w", charactersIgnoringModifiers: "w", isARepeat: false, keyCode: 13) {
                window.sendEvent(e)
            }
        }
        webView.evaluateJavaScript(state) { before, _ in
            key(true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                key(false)
                // mouse look: a sideways mouse movement under pointer lock
                for _ in 0..<5 {
                    let mid = self.window.convertPoint(toScreen: self.webView.convert(NSPoint(x: self.webView.bounds.midX, y: self.webView.bounds.midY), to: nil))
                    let h = NSScreen.screens.first?.frame.height ?? 0
                    if let cg = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: mid.x, y: h - mid.y), mouseButton: .left) {
                        cg.setIntegerValueField(.mouseEventDeltaX, value: 40)
                        if let e = NSEvent(cgEvent: cg) { self.window.sendEvent(e) }
                    }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    self.webView.evaluateJavaScript(state) { after, _ in
                        out["before"] = before ?? ""; out["after"] = after ?? ""
                        // full screen through the game's own button logic
                        self.webView.evaluateJavaScript("AppShell.toggleFullscreen(); 1") { _, _ in
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                                out["windowFullscreen"] = self.isFullscreen
                                self.webView.evaluateJavaScript("JSON.stringify({ page: AppShell.isFullscreen(), label: document.getElementById('btnFullscreen').textContent, quit: !document.getElementById('btnQuitApp').hidden, appClass: document.body.classList.contains('app') })") { r, _ in
                                    out["page"] = r ?? ""
                                    if self.isFullscreen { self.window.toggleFullScreen(nil) }
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { done(out) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    func writeReport(_ data: Any?) {
        let path = arg(after: "--report") ?? NSTemporaryDirectory() + "blockfire-selftest.json"
        if let d = data, let json = try? JSONSerialization.data(withJSONObject: d, options: [.prettyPrinted]) {
            try? json.write(to: URL(fileURLWithPath: path))
        }
        if selfTest { NSApp.terminate(nil) }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
