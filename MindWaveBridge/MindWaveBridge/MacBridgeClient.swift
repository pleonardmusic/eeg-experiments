import Foundation

/// Pushes parsed TGAM data to the Node bridge running on the Mac over a
/// persistent WebSocket connection. Raw 512Hz samples need a continuous
/// stream rather than periodic polling, so the iPhone connects out as a
/// client instead of running its own server.
///
/// Raw samples go out in batches of `batchSize` ({"rawBatch":[...]}), not one
/// message each: 512 tiny messages a second was too much for the phone.
/// bridge-iphone.js unpacks batches back into single {"rawEeg":N} messages.
class MacBridgeClient: NSObject, ObservableObject, URLSessionWebSocketDelegate {
    @Published var status = "Not connected"
    /// Raw samples per second actually handed to the socket (updated every second).
    @Published var sentRate = 0

    private let batchSize = 16
    private let batchQueue = DispatchQueue(label: "MacBridgeClient.batch")
    private var batch: [Int16] = []
    private var sentCount = 0
    private var rateTimer: Timer?

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var targetHost: String?
    private var targetPort: UInt16 = 8767
    private var reconnectTimer: Timer?
    private var shouldReconnect = false

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        batch.reserveCapacity(batchSize)
        rateTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            let n = self.batchQueue.sync { () -> Int in let n = self.sentCount; self.sentCount = 0; return n }
            self.sentRate = n
        }
    }

    func connect(host: String, port: UInt16 = 8767) {
        targetHost = host
        targetPort = port
        shouldReconnect = true
        openSocket()
    }

    func disconnect() {
        shouldReconnect = false
        reconnectTimer?.invalidate()
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        status = "Not connected"
    }

    private func openSocket() {
        guard let host = targetHost else { return }
        status = "Connecting…"
        let url = URL(string: "ws://\(host):\(targetPort)")!
        task?.cancel(with: .goingAway, reason: nil)   // don't leave stale sockets open on reconnect
        task = session.webSocketTask(with: url)
        task?.resume()
        if let task { listen(task) }
    }

    private func listen(_ current: URLSessionWebSocketTask) {
        current.receive { [weak self] result in
            guard let self, current === self.task else { return }   // ignore replaced sockets
            switch result {
            case .failure:
                self.scheduleReconnect()
            case .success:
                self.listen(current) // we don't expect inbound messages, just keep draining
            }
        }
    }

    private func scheduleReconnect() {
        guard shouldReconnect else { return }
        DispatchQueue.main.async {
            self.status = "Reconnecting…"
            self.reconnectTimer?.invalidate()
            self.reconnectTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in
                self?.openSocket()
            }
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                     didOpenWithProtocol protocol: String?) {
        guard webSocketTask === task else { return }
        DispatchQueue.main.async { self.status = "Connected" }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task else { return }   // ignore replaced sockets
        scheduleReconnect()
    }

    func sendRaw(_ value: Int16) {
        batchQueue.async {
            self.batch.append(value)
            guard self.batch.count >= self.batchSize, self.task != nil else {
                if self.task == nil { self.batch.removeAll(keepingCapacity: true) }
                return
            }
            let text = "{\"rawBatch\":[" + self.batch.map(String.init).joined(separator: ",") + "]}"
            self.sentCount += self.batch.count
            self.batch.removeAll(keepingCapacity: true)
            self.send(text)
        }
    }

    func sendPacket(_ json: String) {
        send(json)
    }

    private func send(_ text: String) {
        task?.send(.string(text)) { _ in }
    }
}
