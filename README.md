# EEG Experiments

A low-cost EEG rig for testing whether audio stimuli drive a 40 Hz brain response
(the auditory steady-state response, or ASSR). It is the measurement side of
[imperceptible-audio-pulse](https://github.com/pleonardmusic/imperceptible-audio-pulse),
which generates masked 40 Hz audio. This repo checks whether that audio still produces
a measurable response.

## What it records

- Raw EEG at about 512 samples/s from a NeuroSky MindWave Mobile 2 headset (one forehead electrode).
- The headset streams to an iPhone app over Bluetooth LE. The app forwards the data to a Mac over Wi-Fi.
- The recorder plays the test audio itself and logs exactly when each block (silence, clicks,
  masked pulse, etc.) starts, so EEG and audio share one timeline.

Each session is saved to `recordings/<session>/` (git-ignored) as `recording.csv`, `events.csv`
and `session.json`.

## What it measures

`analyze-v2.html` follows the single-cycle averaging method from Johnson, Gallagher, Coulson
& Rangel, "Network resonance and the auditory steady state response", *Sci Rep* 14:16799 (2024):

1. Band-pass ±1 Hz around the target (40 or 80 Hz), zero-phase.
2. Fold the signal into 25 ms cycles, reject outlier cycles and average.
3. Report ASSR amplitude and inter-cycle phase consistency (ICPC) for each block.
4. Compare against the same measurement at nearby off-target frequencies (36–44 Hz). A result of
   2× that noise floor or more counts as "stands out".

The headset's real sample rate is fitted from the arrival timestamps across the whole session, because
nominal 512 Hz drifts enough to smear a multi-minute fold.

## Parts

| Path | What it is |
|---|---|
| `MindWaveBridge/` | iPhone app (Swift). Connects to the headset and streams raw samples to the Mac. |
| `bridge-iphone.js` | Mac-side WebSocket bridge. Receives on 8767, rebroadcasts to the browser on 8765. |
| `server.js` | Local web server on port 8080. It also saves recordings. |
| `recorder-v2.html` | Plays the test track on a block schedule and records the session. |
| `analyze-v2.html`, `analysis-v2.js` | 40/80 Hz ASSR analysis of saved sessions. |
| `index.html` | v1 live monitor: band power, eSense, a live 40 Hz detector and tagged CSV export. |
| `bridge.js`, `test-connection.js`, `start.sh` | Older Mac-Bluetooth path, kept for reference. It doesn't work reliably. |

## Running it

1. `npm install`
2. Start the server and the bridge in two terminals: `node server.js` and `node bridge-iphone.js`.
3. Build `MindWaveBridge/` to an iPhone from Xcode. Pair the headset, enter the Mac's local IP and tap Connect.
4. Open <http://localhost:8080/recorder-v2.html> to record, and
   <http://localhost:8080/analyze-v2.html> to analyze.

Use wired audio or speakers. Bluetooth headphones add their own clock drift and latency, which breaks
the timing the analysis depends on.

## Status

This is an experimental personal research project, not a medical device. The click positive
control produces a clear 40 Hz response (several times the noise floor). Results for masked audio
are still early. See `PROJECT_NOTES.md` for the full log of sessions and open issues.
