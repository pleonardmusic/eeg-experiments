import Foundation

struct EEGData {
    var poorSignalLevel: Int = 200
    var attention: Int = 0
    var meditation: Int = 0
    var delta: Int = 0
    var theta: Int = 0
    var lowAlpha: Int = 0
    var highAlpha: Int = 0
    var lowBeta: Int = 0
    var highBeta: Int = 0
    var lowGamma: Int = 0
    var highGamma: Int = 0

    var json: String {
        """
        {"poorSignalLevel":\(poorSignalLevel),"eSense":{"attention":\(attention),"meditation":\(meditation)},"eegPower":{"delta":\(delta),"theta":\(theta),"lowAlpha":\(lowAlpha),"highAlpha":\(highAlpha),"lowBeta":\(lowBeta),"highBeta":\(highBeta),"lowGamma":\(lowGamma),"highGamma":\(highGamma)}}
        """
    }
}

/// Wraps NeuroSky's official MWM Comm SDK (libMWMSDK.a) instead of
/// hand-parsing TGAM frames — the headset's actual BLE GATT protocol
/// doesn't match the classic Bluetooth-classic byte stream, so the
/// vendor SDK is the only reliable way to decode it.
class BLEManager: NSObject, ObservableObject, MWMDelegate {
    @Published var status = "Starting…"
    @Published var eegData = EEGData()
    @Published var log: [String] = []

    /// Fired once per raw EEG sample (~512/s).
    var onRawSample: ((Int16) -> Void)?
    /// Fired whenever signal/eSense/band-power fields update.
    var onPacket: ((EEGData) -> Void)?
    /// Diagnostic hook for raw log lines.
    var onLog: ((String) -> Void)?

    private let device = MWMDevice.sharedInstance()
    private var foundDeviceIDs: [String] = []

    override init() {
        super.init()
        device?.delegate = self
        device?.enableConsoleLog(true)
        status = "Scanning for MindWave…"
        device?.scanDevice()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.addLog("scanDevice() called, SDK version=\(self?.device?.getVersion() ?? "nil")")
        }
    }

    func rescan() {
        foundDeviceIDs.removeAll()
        status = "Scanning for MindWave…"
        device?.scanDevice()
        addLog("rescan() triggered")
    }

    // MARK: - MWMDelegate (required)

    func deviceFound(_ devName: String!, mfgID: String!, deviceID: String!) {
        addLog("deviceFound raw: name=\(devName ?? "nil") mfgID=\(mfgID ?? "nil") id=\(deviceID ?? "nil")")
        guard let deviceID, !deviceID.isEmpty else { return }
        guard !foundDeviceIDs.contains(deviceID) else { return }
        foundDeviceIDs.append(deviceID)
        device?.stopScanDevice()
        device?.connect(deviceID)
        status = "Connecting to \(devName ?? "device")…"
    }

    func didConnect() {
        addLog("Connected")
        status = "Live"
        device?.enableLogging(withOptions: UInt32(LoggingOptions.processed.rawValue | LoggingOptions.raw.rawValue))
    }

    func didDisconnect() {
        addLog("Disconnected")
        status = "Rescanning…"
        device?.scanDevice()
    }

    // MARK: - MWMDelegate (optional)

    func eegSample(_ sample: Int32) {
        onRawSample?(Int16(clamping: sample))
    }

    func eSense(_ poorSignal: Int32, attention: Int32, meditation: Int32) {
        var updated = eegData
        updated.poorSignalLevel = Int(poorSignal)
        updated.attention = Int(attention)
        updated.meditation = Int(meditation)
        publish(updated)
    }

    func eegPowerDelta(_ delta: Int32, theta: Int32, lowAlpha: Int32, highAlpha: Int32) {
        var updated = eegData
        updated.delta = Int(delta)
        updated.theta = Int(theta)
        updated.lowAlpha = Int(lowAlpha)
        updated.highAlpha = Int(highAlpha)
        publish(updated)
    }

    func eegPowerLowBeta(_ lowBeta: Int32, highBeta: Int32, lowGamma: Int32, midGamma: Int32) {
        var updated = eegData
        updated.lowBeta = Int(lowBeta)
        updated.highBeta = Int(highBeta)
        updated.lowGamma = Int(lowGamma)
        updated.highGamma = Int(midGamma)
        publish(updated)
    }

    func exceptionMessage(_ eventType: TGBleExceptionEvent) {
        addLog("Exception: \(eventType.rawValue)")
    }

    private func publish(_ updated: EEGData) {
        onPacket?(updated)
        DispatchQueue.main.async { self.eegData = updated }
    }

    func addLog(_ msg: String) {
        onLog?(msg)
        DispatchQueue.main.async {
            self.log.append(msg)
            if self.log.count > 30 { self.log.removeFirst() }
        }
    }
}
