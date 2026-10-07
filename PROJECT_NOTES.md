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

## v2 analysis (`analyze-v2.html` + `analysis-v2.js`, added 2026-09-30)
Peter's own quick check of a v2 session. The official analysis is still Lara's
team's. Open it from the recorder ("Analyze saved sessions →", or "Analyze this
session" after Stop). It lists `recordings/` via `GET /api/v2/sessions` (server.js)
and writes `analysis.csv` into the session folder.
- Method per Rangel et al. 2024: 3rd-order Butterworth band-pass ±1 Hz, zero-phase
  (JS filter verified identical to SciPy `butter`+`sosfiltfilt`, 1e-14); fold into
  25 ms cycles by phase (25 bins); reject cycles > 2.5× mean cycle amplitude;
  ASSR = max of averaged waveform; ICPC from each cycle's phase. 2 s trimmed at
  block edges; poor_signal ≥ 50 and ±1 s around dropouts excluded.
- Noise floor: same fold at 36/37/38/42/43/44 Hz; results shown as "× floor"
  (≥2× both ASSR and ICPC = "Stands out").
- **Timing is the critical part.** Headset rate is fitted from t_received vs
  sample index over the whole session, with a separate offset after each arrival
  gap (the jump in offset = samples lost; those are filled by interpolation and
  flagged). Nominal 512 Hz would smear a multi-minute fold (0.1% rate error =
  ~5 cycles of drift over 2 min). Remaining unknown: Mac vs audio-output clock
  drift (~tens of ppm). Fine for 2-min blocks, borderline for 10-min blocks.
  Bluetooth headphones would add their own clock and latency, so use wired.
- Simulated test (headset at 511.7 Hz, 25 ms jitter, 400 ms of lost samples):
  recovered rate 511.703, 205 lost samples; 0.6 µV response → ~9× floor,
  0.2 µV → ~2.8×, 0.1 µV → ~1.4× (borderline), 0 → no false positive.
- Test track: `~/Documents/Claude-Personal-Documents/Test-Audio/Click-test-40Hz-8min.wav` (Test-Audio = Peter's folder for test tracks/samples, sibling of this repo, kept out of git): Silence 2 / Click 2 /
  Silence 2 / Click 2 min. 48 kHz stereo; clicks = 1 ms of 10 kHz sine
  (standard, per Peter), −6 dBFS peak, every 1200 samples (exactly 40 Hz).
- Fixed the recorder README: sample_index does NOT skip over dropouts.
- **80 Hz added 2026-09-30** (40/80 Hz switch on the page; shams 74–86 Hz;
  analysis.csv now has one row per block per target_hz). Why: in A+B the A and
  B bands pulse half a cycle apart, so their 40 Hz responses may cancel at the
  single electrode while 80 Hz parts add. Caveat: A+B audio itself has a small
  80 Hz loudness ripple (level dips at each crossover); Track A alone has none.
  First check of saved sessions: no 80 Hz response in either A+B run.

## Sessions recorded 2026-09-30 (recordings/, all single 2-min blocks)
Full interpretation is in ../40_Hz_ERB_Project/PROJECT_NOTES.md (2026-09-30 section).
Test tracks are in ../Test-Audio/.
- 18-56-49 · Click-test-40Hz-8min.wav (stopped after 2 blocks): Silence 1.1×, Click 2.8×.
- 20-44-16 · silence-drone-silence-pulsed_drone.wav: Drone 1.0×, 40 Hz pulsed drone 4.4×.
  (30 s silences too short to judge; one showed 1.66× by chance.)
- 20-59-54 · silence-AB-test.wav (A+B original; block mislabelled "Pulsed-Drone"): 1.25×.
- 21-14-34 · erb_comb_40hz_mixed-MORE-INTENSE.wav: 1.9× (borderline).
- latest · dichotic-test-short.wav via wired earbuds: A left only 14×, A left/B right 2.3×.
  **Earbud Hardware Null not yet run**: the 14× may be electrical leakage near the ear clip.
- Speakers ≥1 m away are electrically safest; regular earbuds are risky; air-tube earbuds
  are the recommended headphone option. Bluetooth audio must never be used (clock drift).

## Troubleshooting: sample rate sinking (2026-09-30)
Symptom: rate starts near 512 after a reconnect, then fades to ~80–200 within
a minute while signal quality still reads 0/Good. **Cause was a weak AAA in the
headset**; a fresh one gave a steady 513/s. Check the battery FIRST.
- The phone app now shows "Samples/sec from headset" and "Samples/sec sent to
  Mac". If "from headset" is low, the problem is headset → phone (battery,
  Bluetooth). If only "sent" is low, it's Wi-Fi. Also check the phone is on
  the home Wi-Fi (not cellular/hotspot) and the Mac IP in the app is current.
- App changes made while chasing this (built + installed from the command line
  with xcodebuild/devicectl; the phone is paired, so Xcode needn't be opened):
  SDK file logging (`enableLogging`, Documents/TG_log) turned off; raw samples
  sent in batches of 16 (`{"rawBatch":[...]}`), unpacked by bridge-iphone.js
  into single `{"rawEeg":N}` for browsers; stale sockets cancelled on reconnect.
  SDK console logging left ON: with it off the headset was found but never
  connected (not proven to be the cause, but don't turn it off again casually).
- This headset's LED is solid blue normally; it doesn't blink when searching.

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
