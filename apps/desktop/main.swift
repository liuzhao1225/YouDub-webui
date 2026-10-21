import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var input = Pipe()
    var output = Pipe()
    var log: FileHandle?
    var origin: URL?
    var quitting = false
    var buffer = ""
    var logURL: URL!
    var lockDescriptor: Int32 = -1

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "YouDub"
        window.minSize = NSSize(width: 860, height: 600)
        window.center()
        window.isReleasedWhenClosed = false
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        window.contentView = webView
        webView.loadHTMLString("<html style='background:#101017;color:#eee;font:16px -apple-system'><body style='display:grid;place-items:center;height:95vh'>正在启动 YouDub…</body></html>", baseURL: nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        do { try startServer() } catch { showError("启动失败", error.localizedDescription) }
    }

    func buildMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 YouDub", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(withTitle: "查看日志", action: #selector(openLog), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 YouDub", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "退出 YouDub", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "编辑")
        for (title, selector, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        editItem.submenu = edit
        menu.addItem(editItem)
        let viewItem = NSMenuItem()
        let view = NSMenu(title: "窗口")
        view.addItem(withTitle: "刷新", action: #selector(reload), keyEquivalent: "r")
        view.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        view.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        viewItem.submenu = view
        menu.addItem(viewItem)
        NSApp.mainMenu = menu
    }

    func startServer() throws {
        let files = FileManager.default
        let resources = Bundle.main.resourceURL!
        let data = ProcessInfo.processInfo.environment["YOUDUB_DESKTOP_DATA_DIR"].map { URL(fileURLWithPath: $0) }
            ?? files.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/YouDub")
        try files.createDirectory(at: data, withIntermediateDirectories: true)
        lockDescriptor = open(data.appendingPathComponent("desktop.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard lockDescriptor >= 0, flock(lockDescriptor, LOCK_EX | LOCK_NB) == 0 else {
            throw NSError(domain: "YouDub", code: 1, userInfo: [NSLocalizedDescriptionKey: "此数据目录已有 YouDub 桌面实例运行。"])
        }
        let logs = files.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/YouDub")
        try files.createDirectory(at: logs, withIntermediateDirectories: true)
        logURL = logs.appendingPathComponent("desktop.log")
        if !files.fileExists(atPath: logURL.path) { files.createFile(atPath: logURL.path, contents: nil) }
        log = try FileHandle(forWritingTo: logURL)
        try log!.seekToEnd()
        try log!.write(contentsOf: Data("\n--- YouDub \(Date()) ---\n".utf8))
        let process = Process()
        process.executableURL = resources.appendingPathComponent("node")
        process.currentDirectoryURL = resources.appendingPathComponent("runtime")
        process.arguments = ["--expose-internals", "--import", "tsx", "apps/desktop/server.mjs"]
        var environment = ProcessInfo.processInfo.environment
        environment["YOUDUB_DESKTOP_DATA_DIR"] = data.path
        environment["PATH"] = resources.path + ":/usr/bin:/bin:/usr/sbin:/sbin"
        environment["NODE_ENV"] = "production"
        environment.removeValue(forKey: "NODE_OPTIONS")
        process.environment = environment
        process.standardInput = input
        process.standardOutput = output
        process.standardError = log
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            if bytes.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.receive(bytes) }
        }
        process.terminationHandler = { [weak self] child in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.quitting { NSApp.reply(toApplicationShouldTerminate: true) }
                else { self.showError("本地服务已退出", "退出码：\(child.terminationStatus)。请查看日志后重新启动 YouDub。") }
            }
        }
        try process.run()
        server = process
    }

    func receive(_ bytes: Data) {
        do { try log?.write(contentsOf: bytes) } catch { showError("日志写入失败", error.localizedDescription) }
        buffer += String(decoding: bytes, as: UTF8.self)
        while let end = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<end])
            buffer.removeSubrange(...end)
            if line.hasPrefix("YOUDUB_READY="), let url = URL(string: String(line.dropFirst("YOUDUB_READY=".count))) {
                origin = url
                webView.load(URLRequest(url: url))
            }
        }
    }

    @objc func openLog() { if let logURL { NSWorkspace.shared.open(logURL) } }
    @objc func reload() { webView.reload() }
    func showError(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "知道了")
        alert.addButton(withTitle: "查看日志")
        alert.beginSheetModal(for: window) { [weak self] result in
            if result == .alertSecondButtonReturn { self?.openLog() }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let server, server.isRunning else { return .terminateNow }
        quitting = true
        server.terminate()
        return .terminateLater
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }
    func local(_ url: URL) -> Bool { url.scheme == origin?.scheme && url.host == origin?.host && url.port == origin?.port }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.shouldPerformDownload { decisionHandler(.download) }
        else if local(url) || url.scheme == "about" || url.scheme == "blob" { decisionHandler(.allow) }
        else {
            if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if local(url) { webView.load(action.request) }
            else if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
        return nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let attachment = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().hasPrefix("attachment") == true
        decisionHandler(attachment || !response.canShowMIMEType ? .download : .allow)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showError("页面加载失败", error.localizedDescription) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { showError("界面进程已退出", "请按 ⌘R 重新加载界面。") }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message
        alert.addButton(withTitle: "确定"); alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { completionHandler(nil); return }
            do {
                // NSSavePanel has already obtained explicit replacement consent.
                if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
                completionHandler(url)
            } catch { self.showError("下载失败", error.localizedDescription); completionHandler(nil) }
        }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { showError("下载失败", error.localizedDescription) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
