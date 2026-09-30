# EEG Experiments Project — Notes

This folder is the EEG measurement side of Peter's 40Hz entrainment work — separate
from [the ERB Comb / Imperceptible Audio Pulse app](../../../Desktop/PETER/Personal-Claude-Projects/40_Hz_ERB_Project/PROJECT_NOTES.md),
which generates the masked audio stimulus tested here. This file is a durable,
colocated record of what each piece of code in this folder actually does, since the
project has accumulated some legacy/abandoned files alongside the live ones.

## The system has three parts

1. **iPhone app** (`MindWaveBridge/` — Xcode/Swift project) — runs on Peter's iPhone,
   connects to the MindWave Mobile 2 headset over BLE, parses raw TGAM packets
   (including raw 512Hz samples), and streams them out over WebSocket to the Mac.
   - `BLEManager.swift` — BLE connection + TGAM packet parsing, including code `0x80`
     raw samples.
   - `MacBridgeClient.swift` — the iPhone connects OUT as a WebSocket client to the
     Mac (avoids needing a WebSocket *server* on iOS). Replaced an earlier polling
     HTTP design (`EEGServer.swift`, deleted).
   - `ContentView.swift` — has a "Mac IP" field (persisted via `@AppStorage`) Peter
     types the Mac's local IP into.
   - **This is the live, working data source.** The Mac's own Bluetooth/TGC path to
     the headset was abandoned as unreliable (see "Legacy/abandoned files" below) —
     don't resurrect it.

2. **Mac-side bridge** (`bridge-iphone.js`) — a Node WebSocket server with two ports:
   8767 ingests the stream from the iPhone app, 8765 re-broadcasts it to the browser
   in the same JSON shape the browser already expects (so no frontend parsing
   changes were needed when this replaced the old TGC path).

3. **Browser app** (`index.html`, served by `server.js` on port 8080) — the actual
   analysis UI. Shows signal quality / eSense (attention, meditation) / 8-band EEG
   power, plus purpose-built 40Hz tooling: a Goertzel-based 40Hz detector on raw
   512Hz samples, a custom-frequency tracker (for sham conditions, e.g. 25Hz),
   gamma-% -of-total-power, baseline calibration, and session recording with
   condition tags (Baseline / Signal A / Signal B / Sham / Hardware Null /
   Mechanical Control + free-text) that exports to a timestamped CSV on the Desktop.

## How to actually run it
Double-click **`EEG Monitor.app`** on the Desktop (a bash-script launcher under
`Contents/MacOS/launch`, not a compiled binary — `LSUIElement` in its Info.plist so
it has no dock icon). It starts `node server.js` and `node bridge-iphone.js` if
they're not already running, then opens `http://localhost:8080`. Then open the
MindWaveBridge app on the iPhone, type the Mac's IP, tap Connect. No Terminal needed
for normal use.

**`start.sh` is stale** — it only starts `server.js` and documents the old TGC/
`bridge.js` fallback path; it never mentions `bridge-iphone.js` at all, so running it
alone will NOT get live data from the iPhone. `EEG Monitor.app` is the real entry
point now; `start.sh` should be updated or retired next time this is touched.

## v2 recorder (`recorder-v2.html`, added 2026-09-30)
A lean recorder built for Lara Rangel's (UCSD) analysis method: single-cycle
(25 ms) averaging of the raw signal, per Johnson, Gallagher, Coulson & Rangel,
"Network resonance and the auditory steady state response", Sci Rep 14:16799 (2024).
v1 (`index.html`) is untouched and still works; both share `server.js` and
`bridge-iphone.js`. Launch v2 with **`EEG Recorder v2.app`** on the Desktop
(a copy of the v1 launcher that opens `/recorder-v2.html`).

- Plays the single long test track itself (so it knows exactly when each block
  starts), following an editable block schedule (condition + minutes, saved in
  the browser). Can start from any block to redo part of a test.
- Saves each session to `recordings/<session-name>/` (git-ignored), streamed to
  disk every second via `server.js`'s `/api/v2/*` endpoints so a browser crash
  loses at most ~1 s: `recording.csv` (sample_index, t_received_ms, raw,
  poor_signal), `events.csv` (block_start / audio_start / dropout / etc., keyed
  by sample_index), `session.json` (schedule, measured sample rate, µV scale),
  `README.txt` (column guide for the analyst).
- block_start sample indices are computed from the audio_start anchor plus the
  measured sample rate, so all blocks share one constant (unknown, ~tens of ms)
  Bluetooth/Wi-Fi latency offset rather than random timer jitter.
- Verified 2026-09-30 with a simulated 40 Hz + noise stream: folding the saved
  recording into 25 ms cycles recovered the hidden wave's amplitude (40.6 vs 40).

## Legacy / abandoned files — do not resume work here without a reason
- **`bridge.js`** — the old Mac-side bridge: polls ThinkGear Connector (TGC) over TCP
  on port 13854, re-broadcasts to the browser on 8765 (same output port the iPhone
  bridge now uses, so the two are mutually exclusive in practice). Abandoned because
  TGC 4.1.8 (Intel binary, Rosetta-translated) reliably failed to relay real
  ThinkGear data on current macOS even when its Bluetooth transport showed a solid
  connection (`poorSignalLevel` stuck at 200 — see [[eeg-feedback]], this is a known
  link-layer bug, not a headset-placement issue). Kept only as an explicit manual
  fallback per Peter's choice, not deleted, but two full debugging sessions failed to
  fix it — don't re-attempt that path.
- **`test-connection.js`** — an even earlier diagnostic: tries to open the headset's
  raw serial device (`/dev/cu.MindWaveMobile`) directly, bypassing TGC entirely.
  Never worked (0 bytes received even after the macOS upgrade that fixed other
  Bluetooth issues). Unrelated to the current iPhone-bridge architecture; effectively
  dead code.

## Git status (check before assuming anything is "saved")
As of 2026-06-17, only 2 old commits existed (`6f4740e`, `b58224b`), both predating
the entire iPhone-bridge architecture. `MindWaveBridge/`, `bridge-iphone.js`,
`start.sh` were untracked and `index.html`/`server.js`/`bridge.js` had uncommitted
changes — i.e. most of the actually-working code described above has never been
committed. Run `git status` to check current state before assuming work is preserved
in git history; it may only exist on disk.

## Known open issues
- **Goertzel-attention confound (2026-06-24, see [[imperceptible-audio-pulse-project]]
  for the full test writeup)**: the 40Hz Goertzel metric (`pct_40hz`) tracks
  attention/arousal (NeuroSky's onboard eSense score) more reliably than it tracks
  experimental condition. A first masked-audio test (Baseline/Click/No-Pulse/
  With-Pulse) did not replicate "pulse beats no-pulse" across 2 runs, while
  attention-rank-order matched pct_40hz-rank-order in both runs (for whichever
  condition happened to win that run). Leading theory: a real physiological
  confound (attention/arousal raises broadband EEG amplitude, which leaks into the
  Goertzel window), not a code bug — `pct_40hz` and `attention` are computed by
  fully independent code paths. Next step agreed: collect more reps and consider
  analyzing pct_40hz as a residual after regressing out attention, rather than
  debugging code further.
- Earlier validation work (Hardware Null / Sham / Mechanical Control vs. overt
  "Signal A" clicks) did successfully rule out electrical leakage, generic-audio,
  and mechanical/microphonic-vibration explanations for a 40Hz rise — that
  positive-control validation stands; it's specifically the *masked*-audio result
  above that hasn't replicated yet.

## Related project
See [[imperceptible-audio-pulse-project]] / its colocated `PROJECT_NOTES.md` for the
ERB-comb masked-audio generator this EEG rig is used to test, including the
algorithm details and the per-parameter findings (edge softness, crossfade shape,
min/max pulse frequency) that shape what stimulus files get tested here.
