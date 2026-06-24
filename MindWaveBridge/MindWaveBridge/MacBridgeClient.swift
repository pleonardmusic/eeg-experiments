import Foundation

/// Pushes parsed TGAM data to the Node bridge running on the Mac over a
/// persistent WebSocket connection. Raw 512Hz samples need a continuous
/// stream rather than periodic polling, so the iPhone connects out as a
/// client instead of running its own server.
class MacBridgeClient: NSObject, ObservableObject, URLSessionWebSocketDelegate {
    @Published var status = "Not connected"

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var targetHost: String?
    private var targetPort: UInt16 = 8767
    private var reconnectTimer: Timer?
    private var shouldReconnect = false

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
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
        task = session.webSocketTask(with: url)
        task?.resume()
        listen()
    }

    private func listen() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                self.scheduleReconnect()
            case .success:
                self.listen() // we don't expect inbound messages, just keep draining
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
        DispatchQueue.main.async { self.status = "Connected" }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        scheduleReconnect()
    }

    func sendRaw(_ value: Int16) {
        send("{\"rawEeg\":\(value)}")
    }

    func sendPacket(_ json: String) {
        send(json)
    }

    private func send(_ text: String) {
        task?.send(.string(text)) { _ in }
    }
}
