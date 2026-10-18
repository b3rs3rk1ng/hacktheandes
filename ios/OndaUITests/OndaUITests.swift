import XCTest

/// Drives only Onda's public interface on the attached device.
@MainActor
final class OndaUITests: XCTestCase {
    private let listeningLabel = "Detener escucha"
    private let idleLabels = ["Escuchar boletín", "Volver a escuchar"]

    override func setUpWithError() throws {
        continueAfterFailure = false
        executionTimeAllowance = 180
    }

    func testReceiverStaysInForegroundForAcousticReception() throws {
        let app = XCUIApplication()
        let monitor = addUIInterruptionMonitor(withDescription: "Onda microphone permission") { alert in
            Self.allowOndaMicrophonePrompt(alert)
        }
        defer { removeUIInterruptionMonitor(monitor) }

        app.launch()
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 20), "Onda did not load its bundled interface.")
        XCTAssertTrue(webView.buttons["Acercar mapa"].waitForExistence(timeout: 10),
                      "The bundled map did not finish loading.")

        capture(app, named: "Onda — initial bundled interface")
        let localView = webView.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", "Mi zona", "Mi zona,")).firstMatch
        XCTAssertTrue(localView.waitForExistence(timeout: 10), "The map's local view is unavailable.")
        reveal(localView, in: webView)
        XCTAssertTrue(localView.isHittable)
        localView.tap()
        capture(app, named: "Onda — local map ready")
        print("ONDA_UI_READY")

        let receiver = webView.buttons.matching(NSPredicate(
            format: "label CONTAINS %@ OR label CONTAINS %@ OR label CONTAINS %@",
            idleLabels[0], idleLabels[1], listeningLabel
        )).firstMatch
        XCTAssertTrue(receiver.waitForExistence(timeout: 10), "The receiver control is unavailable.")
        reveal(receiver, in: webView)
        XCTAssertTrue(receiver.isHittable)

        // Restart a pre-existing session so the acoustic window has a known beginning.
        if receiver.label.contains(listeningLabel) {
            receiver.tap()
            XCTAssertTrue(waitForIdle(receiver, timeout: 5))
        }

        receiver.tap()
        handleVisibleMicrophonePrompt(in: app)
        let started = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@ AND enabled == true", listeningLabel),
            object: receiver
        )
        XCTAssertEqual(XCTWaiter.wait(for: [started], timeout: 15), .completed,
                       "The microphone did not enter listening mode.")

        // Always release the microphone, including when a later assertion fails.
        defer {
            if receiver.exists && receiver.label.contains(listeningLabel) {
                reveal(receiver, in: webView)
                if receiver.isHittable { receiver.tap() }
            }
        }
        capture(app, named: "Onda — microphone listening")
        print("ONDA_UI_LISTENING")

        let receptionDeadline = Date().addingTimeInterval(120)
        while Date() < receptionDeadline {
            let duration = min(30, receptionDeadline.timeIntervalSinceNow)
            guard duration > 0 else { break }
            // XCTWaiter runs the run loop without polling the interface continuously.
            let interval = XCTestExpectation(description: "Acoustic reception window")
            XCTAssertEqual(XCTWaiter.wait(for: [interval], timeout: duration), .timedOut)
            XCTAssertEqual(app.state, .runningForeground, "Onda left the foreground during reception.")
            XCTAssertTrue(receiver.label.contains(listeningLabel), "Microphone listening was interrupted.")
        }

        capture(app, named: "Onda — acoustic reception result")
        receiver.tap()
        XCTAssertTrue(waitForIdle(receiver, timeout: 5), "The microphone did not stop.")
        print("ONDA_UI_STOPPED")
    }

    private func waitForIdle(_ receiver: XCUIElement, timeout: TimeInterval) -> Bool {
        let stopped = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", idleLabels[0], idleLabels[1]),
            object: receiver
        )
        return XCTWaiter.wait(for: [stopped], timeout: timeout) == .completed
    }

    private func reveal(_ element: XCUIElement, in webView: XCUIElement) {
        for _ in 0..<8 {
            if element.isHittable { return }
            // The map consumes drags. The page margin remains outside its canvas.
            let start = webView.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.83))
            let end = webView.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.25))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
    }

    private func capture(_ app: XCUIApplication, named name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let interface = XCTAttachment(string: app.debugDescription)
        interface.name = "\(name) — interface"
        interface.lifetime = .keepAlways
        add(interface)
    }

    private func handleVisibleMicrophonePrompt(in app: XCUIApplication) {
        // WebKit may expose the origin prompt as an alert in the tested application.
        let alert = app.alerts.firstMatch
        if alert.waitForExistence(timeout: 2) {
            _ = Self.allowOndaMicrophonePrompt(alert)
        }
    }

    private static func allowOndaMicrophonePrompt(_ alert: XCUIElement) -> Bool {
        let text = ([alert.label] + alert.staticTexts.allElementsBoundByIndex.map(\.label))
            .joined(separator: " ")
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let microphone = text.contains("microphone") || text.contains("microfono")
        let ownOrigin = text.contains("onda") || text.contains("127.0.0.1") || text.contains("localhost")
        guard microphone && ownOrigin else { return false }

        // No blanket permission handler: these affirmative labels apply only after
        // verifying both microphone scope and Onda/the bundled local origin above.
        let allow = alert.buttons.matching(NSPredicate(
            format: "label IN %@", ["Allow", "Permitir", "OK", "Aceptar", "Permitir acceso"]
        )).firstMatch
        guard allow.exists else { return false }
        allow.tap()
        return true
    }
}
