import SwiftUI

struct ContentView: View {
    @StateObject var ble = BLEManager()
    @StateObject var bridge = MacBridgeClient()
    @AppStorage("macIP") var macIP: String = ""

    var body: some View {
        NavigationView {
            List {
                Section("Headset") {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text(ble.status)
                            .foregroundColor(ble.status == "Live" ? .green : .secondary)
                            .font(.caption)
                    }
                    Button("Rescan") { ble.rescan() }
                }

                Section("Mac bridge") {
                    TextField("Mac IP address", text: $macIP)
                        .keyboardType(.decimalPad)
                        .disableAutocorrection(true)
                    HStack {
                        Text("Status")
                        Spacer()
                        Text(bridge.status)
                            .foregroundColor(bridge.status == "Connected" ? .green : .secondary)
                            .font(.caption)
                    }
                    Button(bridge.status == "Connected" ? "Disconnect" : "Connect") {
                        if bridge.status == "Connected" {
                            bridge.disconnect()
                        } else {
                            bridge.connect(host: macIP)
                        }
                    }
                    .disabled(macIP.isEmpty)
                }

                Section("On your Mac, run:") {
                    Text("node bridge-iphone.js")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(.blue)
                        .textSelection(.enabled)
                    Text("then enter the Mac's IP above and tap Connect.")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }

                Section("EEG") {
                    row("Signal", value: ble.eegData.poorSignalLevel,
                        color: ble.eegData.poorSignalLevel == 0 ? .green :
                               ble.eegData.poorSignalLevel < 100 ? .yellow : .red)
                    row("Attention",  value: ble.eegData.attention)
                    row("Meditation", value: ble.eegData.meditation)
                    row("Low Gamma ★", value: ble.eegData.lowGamma)
                    row("Mid Gamma ★", value: ble.eegData.highGamma)
                }

                Section("Log") {
                    ForEach(ble.log.reversed(), id: \.self) { line in
                        Text(line)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("MindWave Bridge")
        }
        .onAppear {
            ble.onRawSample = { [weak bridge] sample in
                bridge?.sendRaw(sample)
            }
            ble.onPacket = { [weak bridge] data in
                bridge?.sendPacket(data.json)
            }
            ble.onLog = { [weak bridge] line in
                let escaped = line.replacingOccurrences(of: "\"", with: "'")
                bridge?.sendPacket("{\"debugLog\":\"\(escaped)\"}")
            }
            if !macIP.isEmpty {
                bridge.connect(host: macIP)
            }
        }
    }

    private func row(_ label: String, value: Int, color: Color = .primary) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text("\(value)").foregroundColor(color)
        }
    }
}
