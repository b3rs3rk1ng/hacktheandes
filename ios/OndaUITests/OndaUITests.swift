import XCTest

/// Drives only Onda's public interface on the attached device.
@MainActor
final class OndaUITests: XCTestCase {
    private let listeningLabel = "Detener escucha"
    private let idleLabels = ["Escuchar boletín", "Volver a escuchar"]
    private let environment = ProcessInfo.processInfo.environment

    private struct ExpectedField: Decodable {
        let id: String
        let context: String
        let observedAt: String
        let variable: String?
        let cols: Int?
        let rows: Int?
    }

    private var receptionSeconds: TimeInterval {
        let fallback: TimeInterval = environment["ONDA_EXPECTED_FIELDS"] == nil ? 120 : 240
        return min(300, max(10, Double(environment["ONDA_RECEPTION_SECONDS"] ?? "") ?? fallback))
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        executionTimeAllowance = receptionSeconds + 100
    }

    func testReceiverStaysInForegroundForAcousticReception() throws {
        let expectedFields: [ExpectedField]
        if let expectedJSON = environment["ONDA_EXPECTED_FIELDS"] {
            expectedFields = try JSONDecoder().decode([ExpectedField].self, from: Data(expectedJSON.utf8))
            XCTAssertFalse(expectedFields.isEmpty, "ONDA_EXPECTED_FIELDS must contain at least one field.")
            for expected in expectedFields {
                XCTAssertFalse(expected.id.isEmpty)
                XCTAssertTrue(["live", "replay"].contains(expected.context))
                XCTAssertNotNil(Self.isoDate(expected.observedAt), "An expected observation date is invalid.")
            }
            print("ONDA_VALIDATION_MODE acoustic-complete-fields count=\(expectedFields.count)")
        } else {
            expectedFields = []
            print("ONDA_VALIDATION_MODE UI-only; this run does not prove payload reception")
        }
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

        if !expectedFields.isEmpty {
            let details = webView.descendants(matching: .any).matching(
                NSPredicate(format: "label BEGINSWITH %@", "Detalles de recepción")
            ).firstMatch
            XCTAssertTrue(details.waitForExistence(timeout: 10), "Reception details are unavailable.")
            reveal(details, in: webView)
            details.tap()
            let clear = webView.buttons["Borrar datos recibidos del mapa"]
            XCTAssertTrue(clear.waitForExistence(timeout: 5))
            reveal(clear, in: webView)
            XCTAssertTrue(clear.isHittable)
            clear.tap()
            let previousData = webView.descendants(matching: .any).matching(
                NSPredicate(format: "label BEGINSWITH %@", "Señal completa · ")
            )
            XCTAssertEqual(previousData.count, 0, "Previously stored fields were not cleared through the public control.")
            print("ONDA_RECEIVER_CLEARED")
        }

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

        let receptionStartedAt = Date()
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

        let receptionDeadline = receptionStartedAt.addingTimeInterval(receptionSeconds)
        var receivedExpected = Set<Int>()
        while Date() < receptionDeadline {
            let duration = min(30, receptionDeadline.timeIntervalSinceNow)
            guard duration > 0 else { break }
            // XCTWaiter runs the run loop without polling the interface continuously.
            let interval = XCTestExpectation(description: "Acoustic reception window")
            XCTAssertEqual(XCTWaiter.wait(for: [interval], timeout: duration), .timedOut)
            XCTAssertEqual(app.state, .runningForeground, "Onda left the foreground during reception.")
            XCTAssertTrue(receiver.label.contains(listeningLabel), "Microphone listening was interrupted.")
            if !expectedFields.isEmpty {
                let rows = webView.descendants(matching: .any).matching(
                    NSPredicate(format: "label BEGINSWITH %@", "Señal completa · ")
                ).allElementsBoundByIndex.map(\.label)
                for (index, expected) in expectedFields.enumerated() {
                    let matched = rows.contains { row in
                        Self.matches(row, expected: expected, receivedAfter: receptionStartedAt,
                                     receivedBefore: Date().addingTimeInterval(2))
                    }
                    if matched && receivedExpected.insert(index).inserted {
                        print("ONDA_FIELD_COMPLETE id=\(expected.id) context=\(expected.context) observedAt=\(expected.observedAt)")
                    }
                }
                print("ONDA_RECEPTION_PROGRESS \(receivedExpected.count)/\(expectedFields.count)")
                capture(app, named: "Onda — reception \(receivedExpected.count) of \(expectedFields.count)")
                if receivedExpected.count == expectedFields.count { break }
            }
        }

        capture(app, named: "Onda — acoustic reception result")
        if !expectedFields.isEmpty {
            XCTAssertEqual(receivedExpected.count, expectedFields.count,
                           "Not every expected field was completely received during this microphone session.")
            print("ONDA_ACOUSTIC_VALIDATED fields=\(receivedExpected.count)")
        }
        reveal(receiver, in: webView)
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
        for _ in 0..<12 {
            if element.isHittable { return }
            // The map consumes drags. The page margin remains outside its canvas.
            let above = element.frame.minY < webView.frame.minY + 20
            let start = webView.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: above ? 0.25 : 0.83))
            let end = webView.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: above ? 0.83 : 0.25))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
    }

    private static func isoDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    private static func matches(_ label: String, expected: ExpectedField,
                                receivedAfter: Date, receivedBefore: Date) -> Bool {
        guard label.hasPrefix("Señal completa · \(expected.id) · \(expected.context) · "),
              let observedAt = isoDate(expected.observedAt) else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard label.contains("Observación \(formatter.string(from: observedAt)).") else { return false }
        if let variable = expected.variable, !label.contains("Variable \(variable).") { return false }
        if let cols = expected.cols, let rows = expected.rows,
           !label.contains("· \(cols) × \(rows) celdas.") { return false }
        guard let range = label.range(of: "Recibido ", options: .backwards),
              label.hasSuffix("."),
              let receivedAt = isoDate(String(label[range.upperBound...].dropLast())) else { return false }
        return receivedAt >= receivedAfter && receivedAt <= receivedBefore
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
