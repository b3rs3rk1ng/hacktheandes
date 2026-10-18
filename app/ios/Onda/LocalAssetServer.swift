import Combine
import Foundation
import Network
import UniformTypeIdentifiers

/// A read-only HTTP origin for resources shipped inside the application bundle.
/// The port is retained across launches so WebKit keeps the same storage origin.
@MainActor
final class LocalAssetServer: ObservableObject {
    enum State: Equatable {
        case stopped
        case starting
        case ready(URL)
        case failed(String)
    }

    @Published private(set) var state: State = .stopped

    private let bundle: Bundle
    private let resourceDirectory: String
    private let defaults: UserDefaults
    private let portPreferenceKey: String
    private var listener: AssetListener?
    private var generation = UUID()

    init(
        bundle: Bundle = .main,
        resourceDirectory: String = "Web",
        defaults: UserDefaults = .standard,
        portPreferenceKey: String = "LocalAssetServer.port"
    ) {
        self.bundle = bundle
        self.resourceDirectory = resourceDirectory
        self.defaults = defaults
        self.portPreferenceKey = portPreferenceKey
    }

    func start() {
        if case .starting = state { return }
        if case .ready = state { return }
        stop()
        state = .starting

        guard let root = bundle.resourceURL?.appendingPathComponent(resourceDirectory, isDirectory: true),
              (try? root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            state = .failed("No se encontraron los recursos incluidos en la aplicación.")
            return
        }

        let storedPort = defaults.integer(forKey: portPreferenceKey)
        let port = UInt16(exactly: storedPort) ?? 0
        let currentGeneration = generation
        do {
            let listener = try AssetListener(
                root: root,
                port: port,
                onReady: { [weak self] port in
                    Task { @MainActor in
                        guard let self, self.generation == currentGeneration else { return }
                        self.defaults.set(Int(port), forKey: self.portPreferenceKey)
                        guard let url = URL(string: "http://localhost:\(port)/") else { return }
                        self.state = .ready(url)
                    }
                },
                onFailure: { [weak self] message in
                    Task { @MainActor in
                        guard let self, self.generation == currentGeneration else { return }
                        self.listener?.stop()
                        self.listener = nil
                        self.state = .failed(message)
                    }
                }
            )
            self.listener = listener
            listener.start()
        } catch {
            state = .failed("No se pudo abrir el contenido local: \(error.localizedDescription)")
        }
    }

    func stop() {
        generation = UUID()
        listener?.stop()
        listener = nil
        state = .stopped
    }

    deinit {
        listener?.stop()
    }
}

/// All mutable transport state below is confined to `queue`; callbacks only
/// publish immutable values to the main actor. No LAN interface is bound.
private final class AssetListener: @unchecked Sendable {
    private let root: URL
    private let listener: NWListener
    private let queue = DispatchQueue(label: "local-assets.http", qos: .userInitiated)
    private let onReady: @Sendable (UInt16) -> Void
    private let onFailure: @Sendable (String) -> Void
    private var sessions: [UUID: AssetSession] = [:]
    private var isReady = false
    private var isStopped = false
    private static let maximumConnections = 24

    init(
        root: URL,
        port: UInt16,
        onReady: @escaping @Sendable (UInt16) -> Void,
        onFailure: @escaping @Sendable (String) -> Void
    ) throws {
        self.root = root.resolvingSymlinksInPath().standardizedFileURL
        self.onReady = onReady
        self.onFailure = onFailure
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(
            host: NWEndpoint.Host("127.0.0.1"),
            port: NWEndpoint.Port(rawValue: port)!
        )
        parameters.requiredInterfaceType = .loopback
        parameters.allowLocalEndpointReuse = false
        listener = try NWListener(using: parameters)
    }

    func start() {
        listener.stateUpdateHandler = { [weak self] state in
            guard let self, !self.isStopped else { return }
            switch state {
            case .ready:
                guard let port = self.listener.port?.rawValue else {
                    self.fail("No se consiguió un puerto para el contenido local.")
                    return
                }
                self.isReady = true
                self.onReady(port)
            case .failed(let error):
                self.fail("No se pudo iniciar el contenido local: \(error.localizedDescription)")
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self, !self.isStopped,
                  self.sessions.count < Self.maximumConnections,
                  let port = self.listener.port?.rawValue else {
                connection.cancel()
                return
            }
            let id = UUID()
            let session = AssetSession(
                connection: connection,
                root: self.root,
                port: port,
                queue: self.queue,
                onFinish: { [weak self] in self?.sessions.removeValue(forKey: id) }
            )
            self.sessions[id] = session
            session.start()
        }
        listener.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self, !self.isReady, !self.isStopped else { return }
            self.fail("El contenido local no respondió. Vuelve a intentarlo.")
        }
    }

    func stop() {
        queue.async { self.stopOnQueue() }
    }

    private func stopOnQueue() {
        guard !isStopped else { return }
        isStopped = true
        listener.cancel()
        // finish() also removes the session from the dictionary.
        let active = Array(sessions.values)
        active.forEach { $0.finish() }
        sessions.removeAll()
    }

    private func fail(_ message: String) {
        guard !isStopped else { return }
        stopOnQueue()
        onFailure(message)
    }
}

private final class AssetSession: @unchecked Sendable {
    private let connection: NWConnection
    private let root: URL
    private let port: UInt16
    private let queue: DispatchQueue
    private let onFinish: @Sendable () -> Void
    private var buffer = Data()
    private var isFinished = false
    private var hasResponded = false

    private static let maximumHeaderBytes = 16 * 1024
    private static let maximumRequestLineBytes = 4096
    private static let maximumFileBytes = 32 * 1024 * 1024
    private static let headerEnd = Data([13, 10, 13, 10])

    init(
        connection: NWConnection,
        root: URL,
        port: UInt16,
        queue: DispatchQueue,
        onFinish: @escaping @Sendable () -> Void
    ) {
        self.connection = connection
        self.root = root
        self.port = port
        self.queue = queue
        self.onFinish = onFinish
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.finish()
            default: break
            }
        }
        connection.start(queue: queue)
        receive()
        queue.asyncAfter(deadline: .now() + 15) { [weak self] in self?.finish() }
    }

    func finish() {
        guard !isFinished else { return }
        isFinished = true
        connection.cancel()
        onFinish()
    }

    private func receive() {
        guard !isFinished, !hasResponded else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, complete, error in
            guard let self, !self.isFinished, !self.hasResponded else { return }
            if let data { self.buffer.append(data) }
            if let end = self.buffer.range(of: Self.headerEnd) {
                guard end.upperBound <= Self.maximumHeaderBytes else {
                    self.respond(status: 431, reason: "Request Header Fields Too Large")
                    return
                }
                self.handleRequest(header: self.buffer[..<end.lowerBound], headerEnd: end.upperBound)
            } else if self.buffer.count >= Self.maximumHeaderBytes {
                self.respond(status: 431, reason: "Request Header Fields Too Large")
            } else if complete || error != nil {
                self.finish()
            } else {
                self.receive()
            }
        }
    }

    private func handleRequest(header: Data.SubSequence, headerEnd: Int) {
        guard let text = String(data: header, encoding: .utf8),
              !text.utf8.contains(where: { $0 < 32 && $0 != 13 && $0 != 10 && $0 != 9 }) else {
            respond(status: 400, reason: "Bad Request")
            return
        }
        let lines = text.components(separatedBy: "\r\n")
        guard let first = lines.first, first.utf8.count <= Self.maximumRequestLineBytes,
              lines.count <= 101 else {
            respond(status: 400, reason: "Bad Request")
            return
        }
        let request = first.split(separator: " ", omittingEmptySubsequences: false)
        guard request.count == 3, request[2] == "HTTP/1.1" || request[2] == "HTTP/1.0" else {
            respond(status: 400, reason: "Bad Request")
            return
        }
        let method = String(request[0])
        let isHead = method == "HEAD"
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else {
                respond(status: 400, reason: "Bad Request", head: isHead)
                return
            }
            let name = String(line[..<colon]).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty, name.utf8.allSatisfy({ byte in
                (97...122).contains(byte) || (48...57).contains(byte) || byte == 45
            }), headers[name] == nil, !value.contains("\r"), !value.contains("\n") else {
                respond(status: 400, reason: "Bad Request", head: isHead)
                return
            }
            headers[name] = value
        }
        // Validate Host even on HTTP/1.0; never serve arbitrary hostnames or
        // requests that arrive via browser DNS rebinding.
        let hosts = ["localhost:\(port)", "127.0.0.1:\(port)"]
        guard let host = headers["host"]?.lowercased(), hosts.contains(host) else {
            respond(status: 403, reason: "Forbidden", head: isHead)
            return
        }
        guard method == "GET" || isHead else {
            respond(status: 405, reason: "Method Not Allowed", extraHeaders: ["Allow": "GET, HEAD"])
            return
        }
        guard headers["transfer-encoding"] == nil,
              headers["content-length"].map({ $0 == "0" }) ?? true,
              buffer.count == headerEnd else {
            respond(status: 400, reason: "Bad Request", head: isHead)
            return
        }

        let target = String(request[1])
        guard target.hasPrefix("/"), !target.hasPrefix("//"), !target.contains("#"),
              let path = target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init)?.removingPercentEncoding,
              !path.contains("\\"), !path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
            respond(status: 400, reason: "Bad Request", head: isHead)
            return
        }
        let segments = path.split(separator: "/", omittingEmptySubsequences: true)
        guard !segments.contains("..") else {
            respond(status: 403, reason: "Forbidden", head: isHead)
            return
        }
        let relativePath = path == "/" ? "index.html" : String(path.dropFirst())
        let file = root.appendingPathComponent(relativePath).resolvingSymlinksInPath().standardizedFileURL
        guard file.path.hasPrefix(root.path + "/") else {
            respond(status: 403, reason: "Forbidden", head: isHead)
            return
        }
        guard let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
              values.isRegularFile == true, let size = values.fileSize else {
            respond(status: 404, reason: "Not Found", head: isHead)
            return
        }
        guard size <= Self.maximumFileBytes else {
            respond(status: 413, reason: "Content Too Large", head: isHead)
            return
        }
        do {
            let data = isHead ? Data() : try Data(contentsOf: file, options: .mappedIfSafe)
            respond(
                status: 200,
                reason: "OK",
                body: data,
                contentType: Self.contentType(for: file),
                contentLength: size,
                head: isHead
            )
        } catch {
            respond(status: 404, reason: "Not Found", head: isHead)
        }
    }

    private static func contentType(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "wasm": return "application/wasm"
        default: return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }

    private func respond(
        status: Int,
        reason: String,
        body: Data? = nil,
        contentType: String = "text/plain; charset=utf-8",
        contentLength: Int? = nil,
        head: Bool = false,
        extraHeaders: [String: String] = [:]
    ) {
        guard !isFinished, !hasResponded else { return }
        hasResponded = true
        let body = body ?? Data("\(status) \(reason)\n".utf8)
        var headers = [
            "Content-Type": contentType,
            "Content-Length": String(contentLength ?? body.count),
            "Connection": "close",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Referrer-Policy": "no-referrer",
            "Permissions-Policy": "camera=(), microphone=(self), geolocation=(self)",
            "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
        ]
        headers.merge(extraHeaders) { _, value in value }
        var response = Data("HTTP/1.1 \(status) \(reason)\r\n".utf8)
        for key in headers.keys.sorted() {
            response.append(Data("\(key): \(headers[key]!)\r\n".utf8))
        }
        response.append(Data("\r\n".utf8))
        if !head { response.append(body) }
        connection.send(content: response, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in
            self?.finish()
        })
    }
}
