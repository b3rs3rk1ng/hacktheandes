import SwiftUI
import UIKit
import WebKit

@MainActor
struct ContentView: View {
    @StateObject private var server = LocalAssetServer()
    @State private var webFailure: String?
    @State private var isLoadingPage = true
    @State private var reloadID = UUID()

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            switch server.state {
            case .stopped, .starting:
                loadingView
            case .failed(let message):
                failureView(message: message) { server.start() }
            case .ready(let url):
                LocalWebView(
                    url: url,
                    onReady: { isLoadingPage = false },
                    onFailure: { message in
                        isLoadingPage = false
                        webFailure = message
                    }
                )
                .id(reloadID)
                .opacity(webFailure == nil ? 1 : 0)
                if let webFailure {
                    failureView(message: webFailure) {
                        self.webFailure = nil
                        isLoadingPage = true
                        reloadID = UUID()
                    }
                } else if isLoadingPage {
                    loadingView
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(.systemBackground))
                }
            }
        }
        .onAppear { server.start() }
    }

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Abriendo Onda…")
                .font(.headline)
            Text("El mapa y la aplicación están guardados en este iPhone.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }

    private func failureView(message: String, retry: @escaping () -> Void) -> some View {
        VStack(spacing: 18) {
            Image(systemName: "exclamationmark.circle")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No se pudo abrir Onda")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Volver a intentar", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding(32)
    }
}

@MainActor
private struct LocalWebView: UIViewRepresentable {
    let url: URL
    let onReady: @MainActor () -> Void
    let onFailure: @MainActor (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(origin: url, onReady: onReady, onFailure: onFailure)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.add(context.coordinator, name: "ondaAudioActivity")
        configuration.userContentController.addUserScript(WKUserScript(
            source: """
                globalThis.ONDA_CONFIG={bundled:true,canEmit:false};
                window.addEventListener('onda:audio-activity', event => {
                    if (typeof event.detail?.active === 'boolean') {
                        window.webkit.messageHandlers.ondaAudioActivity.postMessage({active:event.detail.active});
                    }
                });
                """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.detach()
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "ondaAudioActivity")
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private let origin: URL
        private let onReady: @MainActor () -> Void
        private let onFailure: @MainActor (String) -> Void
        private var audioActive = false

        init(origin: URL, onReady: @escaping @MainActor () -> Void, onFailure: @escaping @MainActor (String) -> Void) {
            self.origin = origin
            self.onReady = onReady
            self.onFailure = onFailure
            super.init()
            let notifications = NotificationCenter.default
            notifications.addObserver(self, selector: #selector(applicationResignedActive), name: UIApplication.willResignActiveNotification, object: nil)
            notifications.addObserver(self, selector: #selector(applicationEnteredBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
            notifications.addObserver(self, selector: #selector(applicationBecameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        }

        func detach() {
            NotificationCenter.default.removeObserver(self)
            setAudioActive(false)
        }

        private func setAudioActive(_ active: Bool) {
            audioActive = active
            UIApplication.shared.isIdleTimerDisabled = active && UIApplication.shared.applicationState == .active
        }

        @objc private func applicationResignedActive() {
            UIApplication.shared.isIdleTimerDisabled = false
        }

        @objc private func applicationEnteredBackground() {
            setAudioActive(false)
        }

        @objc private func applicationBecameActive() {
            setAudioActive(audioActive)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "ondaAudioActivity", message.frameInfo.isMainFrame,
                  isLocal(message.frameInfo.securityOrigin),
                  let activity = message.body as? [String: Any],
                  let active = activity["active"] as? Bool else { return }
            setAudioActive(active)
        }

        private func isLocal(_ url: URL) -> Bool {
            url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
                && url.user == nil && url.password == nil
        }

        private func isLocal(_ securityOrigin: WKSecurityOrigin) -> Bool {
            securityOrigin.protocol == origin.scheme && securityOrigin.host == origin.host
                && securityOrigin.port == origin.port
        }

        private func openExternalLink(_ action: WKNavigationAction) {
            guard action.navigationType == .linkActivated,
                  action.sourceFrame.isMainFrame,
                  isLocal(action.sourceFrame.securityOrigin),
                  let url = action.request.url,
                  ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  !isLocal(url) else { return }
            UIApplication.shared.open(url)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if isLocal(url), navigationAction.targetFrame?.isMainFrame != false {
                decisionHandler(.allow)
            } else {
                openExternalLink(navigationAction)
                decisionHandler(.cancel)
            }
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.navigationType == .linkActivated,
               let url = navigationAction.request.url, isLocal(url) {
                webView.load(navigationAction.request)
            } else {
                openExternalLink(navigationAction)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor securityOrigin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
        ) {
            let allowed = type == .microphone && frame.isMainFrame
                && isLocal(securityOrigin) && isLocal(frame.securityOrigin)
            // WebKit presents the user's microphone permission prompt.
            decisionHandler(allowed ? .prompt : .deny)
        }

        @available(iOS 27.0, *)
        func webView(
            _ webView: WKWebView,
            requestGeolocationPermissionFor securityOrigin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
        ) {
            let allowed = frame.isMainFrame && isLocal(securityOrigin) && isLocal(frame.securityOrigin)
            decisionHandler(allowed ? .prompt : .deny)
        }

        func webView(
            _ webView: WKWebView,
            requestDeviceOrientationAndMotionPermissionFor securityOrigin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.deny)
        }

        @available(iOS 18.4, *)
        func webView(
            _ webView: WKWebView,
            runOpenPanelWith parameters: WKOpenPanelParameters,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
        ) {
            completionHandler(nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onReady()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            setAudioActive(false)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            setAudioActive(false)
            onFailure("La pantalla se cerró para liberar memoria. Tus datos guardados se conservan.")
        }

        private func report(_ error: Error) {
            let error = error as NSError
            guard !(error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled) else { return }
            setAudioActive(false)
            onFailure("No se pudo cargar el contenido incluido. \(error.localizedDescription)")
        }
    }
}
