// Single-cycle (25 ms) averaging analysis for EEG Recorder v2 sessions.
// Follows the method in Johnson, Gallagher, Coulson & Rangel, "Network resonance
// and the auditory steady state response", Sci Rep 14:16799 (2024):
//   1. band-pass 3rd-order Butterworth, ±1 Hz around the stimulus frequency
//   2. cut each block into one-cycle segments (25 ms at 40 Hz)
//   3. reject cycles whose amplitude is > 2.5× the mean cycle amplitude
//   4. average the cycles point-by-point; ASSR = max of the averaged waveform
//   5. ICPC = how consistent each cycle's phase is (0 = random, 1 = identical)
// The same fold is repeated at nearby "sham" frequencies that nothing in the
// test track pulses at. Those give the noise floor a real 40 Hz response has
// to beat.
//
// 80 Hz is analysed the same way (12.5 ms cycles). For the ERB comb's A+B mix,
// the A and B bands are pulsed half a cycle apart, so their 40 Hz responses can
// cancel at a single electrode while the 80 Hz parts add up.
//
// Used by analyze-v2.html in the browser and loadable from Node for testing.
(function (root) {
  'use strict';

  const UV_PER_COUNT = (1.8 / 4096) / 2000 * 1e6;   // ≈ 0.2197 µV per ADC count
  const DEFAULTS = {
    targets: [
      { hz: 40, shamHz: [36, 37, 38, 42, 43, 44] },   // skips the target band and 50/60 Hz mains
      { hz: 80, shamHz: [74, 76, 78, 82, 84, 86] },
    ],
    halfBandHz: 1,
    bins: 25,                  // phase bins per cycle (1 ms each at 40 Hz, 0.5 ms at 80 Hz)
    trimS: 2,                  // drop this much at each block edge (response onset, filter ringing)
    rejectFactor: 2.5,
    badSignal: 50,             // poor_signal at or above this = unusable
    gapMs: 250,                // arrival gap that starts a new timing segment
    gapGuardS: 1,              // also drop this much either side of a gap
  };

  // ---------- CSV ----------
  function parseCSVLine(line) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseRecording(text) {
    const lines = text.split('\n');
    const n = lines.length;
    const idx = new Float64Array(n), tr = new Float64Array(n), raw = new Float64Array(n), ps = new Float64Array(n);
    let k = 0;
    for (let i = 1; i < n; i++) {
      const L = lines[i];
      if (!L) continue;
      const a = L.split(',');
      idx[k] = +a[0]; tr[k] = +a[1]; raw[k] = +a[2];
      ps[k] = a[3] === '' || a[3] === undefined ? NaN : +a[3];
      k++;
    }
    return { index: idx.subarray(0, k), tReceived: tr.subarray(0, k), raw: raw.subarray(0, k), poorSignal: ps.subarray(0, k) };
  }

  function parseEvents(text) {
    const lines = text.split('\n').filter(Boolean);
    const head = parseCSVLine(lines[0]);
    return lines.slice(1).map((L) => {
      const a = parseCSVLine(L), o = {};
      head.forEach((h, i) => { o[h] = a[i] ?? ''; });
      o.sample_index = o.sample_index === '' ? null : Number(o.sample_index);
      return o;
    });
  }

  // ---------- timing ----------
  // Samples reach the Mac in bursts, so t_received is jittery, but the headset's
  // own clock is steady. Fit one sample rate across the whole session (with a
  // separate offset after each arrival gap), which averages the jitter away.
  // Folding 2+ minutes into 25 ms cycles needs the rate right to ~0.01%; the
  // nominal 512 Hz is not good enough on its own.
  function fitTiming(rec, opt) {
    const n = rec.raw.length;
    const segStart = [0];
    for (let i = 1; i < n; i++) if (rec.tReceived[i] - rec.tReceived[i - 1] > opt.gapMs) segStart.push(i);
    segStart.push(n);
    let sxy = 0, sxx = 0;
    const segs = [];
    for (let s = 0; s < segStart.length - 1; s++) {
      const a = segStart[s], b = segStart[s + 1];
      let mi = 0, mt = 0;
      for (let i = a; i < b; i++) { mi += i; mt += rec.tReceived[i]; }
      mi /= (b - a); mt /= (b - a);
      for (let i = a; i < b; i++) { const di = i - mi; sxy += di * (rec.tReceived[i] - mt); sxx += di * di; }
      segs.push({ a, b, mi, mt });
    }
    const msPerSample = sxx > 0 ? sxy / sxx : 1000 / 512;
    segs.forEach((g) => { g.offset = g.mt - msPerSample * g.mi; });   // t = offset + msPerSample * i
    // Samples genuinely lost in a gap show up as a jump in offset.
    const gaps = [];
    for (let s = 1; s < segs.length; s++) {
      const lost = (segs[s].offset - segs[s - 1].offset) / msPerSample;
      gaps.push({ at: segs[s].a, lostSamples: Math.max(0, Math.round(lost)) });
    }
    let jit = 0;
    segs.forEach((g) => { for (let i = g.a; i < g.b; i++) { const r = rec.tReceived[i] - (g.offset + msPerSample * i); jit += r * r; } });
    return { rateHz: 1000 / msPerSample, msPerSample, segs, gaps, jitterMs: Math.sqrt(jit / Math.max(1, n)) };
  }

  // Put the samples on one evenly spaced grid, filling lost samples by linear
  // interpolation (and flagging them, plus a guard window, as unusable).
  function buildGrid(rec, timing, opt) {
    const { segs, msPerSample } = timing;
    let total = 0;
    const fill = [0];
    for (let s = 1; s < segs.length; s++) fill.push(timing.gaps[s - 1].lostSamples);
    segs.forEach((g, s) => { total += fill[s] + (g.b - g.a); });
    const x = new Float64Array(total), t = new Float64Array(total), bad = new Uint8Array(total);
    const gridOfSample = new Int32Array(rec.raw.length);
    const guard = Math.round(opt.gapGuardS * 1000 / msPerSample);
    let k = 0;
    const t0 = segs[0].offset;
    let lastPS = NaN;
    segs.forEach((g, s) => {
      if (s > 0) {
        const prev = x[k - 1], next = rec.raw[g.a] * UV_PER_COUNT, m = fill[s];
        for (let j = 1; j <= m; j++) { x[k] = prev + (next - prev) * j / (m + 1); bad[k] = 1; t[k] = t0 + k * msPerSample; k++; }
        for (let j = Math.max(0, k - m - guard); j < Math.min(total, k + guard); j++) bad[j] = 1;
      }
      for (let i = g.a; i < g.b; i++) {
        x[k] = rec.raw[i] * UV_PER_COUNT;
        if (!isNaN(rec.poorSignal[i])) lastPS = rec.poorSignal[i];
        if (!(lastPS < opt.badSignal)) bad[k] = 1;
        t[k] = t0 + k * msPerSample;
        gridOfSample[i] = k;
        k++;
      }
    });
    return { x, t, bad, gridOfSample, fsHz: timing.rateHz };
  }

  // ---------- filter ----------
  // 3rd-order Butterworth band-pass (6 poles) as three biquads, designed with
  // a pre-warped bilinear transform, applied forward and backward (zero phase,
  // like MATLAB/SciPy filtfilt).
  function butterBandpass3(lo, hi, fs) {
    const w1 = 2 * fs * Math.tan(Math.PI * lo / fs), w2 = 2 * fs * Math.tan(Math.PI * hi / fs);
    const bw = w2 - w1, w0sq = w1 * w2;
    const proto = [[-1, 0], [-0.5, Math.sqrt(3) / 2], [-0.5, -Math.sqrt(3) / 2]];
    const poles = [];
    for (const [pr, pi] of proto) {
      // roots of s² − p·bw·s + w0² = 0
      const br = pr * bw, bi = pi * bw;
      const dr = br * br - bi * bi - 4 * w0sq, di = 2 * br * bi;
      const mag = Math.hypot(dr, di);
      let sr = Math.sqrt((mag + dr) / 2), si = Math.sqrt(Math.max(0, (mag - dr) / 2));
      if (di < 0) si = -si;
      poles.push([(br + sr) / 2, (bi + si) / 2], [(br - sr) / 2, (bi - si) / 2]);
    }
    // bilinear: z = (1 + s/2fs) / (1 − s/2fs)
    const zp = poles.map(([r, i]) => {
      const k = 2 * fs, nr = k + r, ni = i, dr = k - r, di = -i, d = dr * dr + di * di;
      return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
    }).filter(([, i]) => i > 0);   // one of each conjugate pair
    const sos = zp.map(([r, i]) => ({ b: [1, 0, -1], a: [1, -2 * r, r * r + i * i] }));
    // normalise to unity gain at the centre frequency
    const wc = 2 * Math.atan(Math.sqrt(w0sq) / (2 * fs));
    let g = 1;
    for (const s of sos) {
      const ev = (c) => {
        let re = 0, im = 0;
        c.forEach((v, n) => { re += v * Math.cos(-wc * n); im += v * Math.sin(-wc * n); });
        return Math.hypot(re, im);
      };
      g *= ev(s.b) / ev(s.a);
    }
    const scale = Math.cbrt(1 / g);
    sos.forEach((s) => { s.b = s.b.map((v) => v * scale); });
    return sos;
  }

  function sosFilter(sos, x) {
    const y = Float64Array.from(x);
    for (const { b, a } of sos) {
      let z1 = 0, z2 = 0;
      for (let n = 0; n < y.length; n++) {
        const xn = y[n], yn = b[0] * xn + z1;
        z1 = b[1] * xn - a[1] * yn + z2;
        z2 = b[2] * xn - a[2] * yn;
        y[n] = yn;
      }
    }
    return y;
  }

  function filtfilt(sos, x) {
    const y = sosFilter(sos, x).reverse();
    return sosFilter(sos, y).reverse();
  }

  // ---------- blocks ----------
  function findBlocks(events, meta, grid) {
    const starts = events.filter((e) => e.event === 'block_start' && e.sample_index !== null);
    const sched = (meta && meta.schedule) || [];
    const lastGrid = grid.x.length - 1;
    return starts.map((e, j) => {
      const m = /block (\d+)/.exec(e.note || '');
      const num = m ? Number(m[1]) : null;
      const plan = sched.find((s) => s.block === num);
      const startK = grid.gridOfSample[Math.min(e.sample_index, grid.gridOfSample.length - 1)];
      let endK = starts[j + 1] ? grid.gridOfSample[Math.min(starts[j + 1].sample_index, grid.gridOfSample.length - 1)] : lastGrid;
      if (plan) endK = Math.min(endK, startK + Math.round(plan.duration_s * grid.fsHz));
      return { block: num ?? j + 1, condition: e.condition, startK, endK };
    });
  }

  // ---------- one fold ----------
  function fold(y, grid, block, f, tRef, opt) {
    const trim = Math.round(opt.trimS * grid.fsHz);
    const a = block.startK + trim, b = block.endK - trim;
    if (b - a < grid.fsHz * 5) return null;
    // group samples into cycles of the fold frequency
    const cycles = new Map();
    for (let k = a; k < b; k++) {
      const ph = f * (grid.t[k] - tRef) / 1000;
      const c = Math.floor(ph);
      let cy = cycles.get(c);
      if (!cy) { cy = { bad: false, max: 0, ks: [] }; cycles.set(c, cy); }
      if (grid.bad[k]) cy.bad = true;
      cy.max = Math.max(cy.max, Math.abs(y[k]));
      cy.ks.push(k);
    }
    const full = [...cycles.values()].filter((c) => !c.bad && c.ks.length >= Math.floor(grid.fsHz / f));
    const meanMax = full.reduce((s, c) => s + c.max, 0) / Math.max(1, full.length);
    const kept = full.filter((c) => c.max <= opt.rejectFactor * meanMax);
    const sum = new Float64Array(opt.bins), cnt = new Float64Array(opt.bins);
    let pr = 0, pi = 0;
    for (const c of kept) {
      let cr = 0, ci = 0;
      for (const k of c.ks) {
        const ph = f * (grid.t[k] - tRef) / 1000;
        const frac = ph - Math.floor(ph);
        const bin = Math.min(opt.bins - 1, Math.floor(frac * opt.bins));
        sum[bin] += y[k]; cnt[bin]++;
        cr += y[k] * Math.cos(2 * Math.PI * frac); ci -= y[k] * Math.sin(2 * Math.PI * frac);
      }
      const m = Math.hypot(cr, ci);
      if (m > 0) { pr += cr / m; pi += ci / m; }
    }
    const wave = Array.from(sum, (s, i) => (cnt[i] ? s / cnt[i] : 0));
    return {
      freqHz: f,
      wave,
      assr: Math.max(...wave),
      icpc: kept.length ? Math.hypot(pr, pi) / kept.length : 0,
      cycles: kept.length,
      rejected: full.length - kept.length,
      unusable: cycles.size - full.length,
    };
  }

  // ---------- whole session ----------
  function analyze({ recordingText, eventsText, meta }, options) {
    const opt = Object.assign({}, DEFAULTS, options);
    const rec = parseRecording(recordingText);
    if (rec.raw.length < 1000) throw new Error('Recording is too short to analyse.');
    const events = parseEvents(eventsText);
    const timing = fitTiming(rec, opt);
    const grid = buildGrid(rec, timing, opt);
    const blocks = findBlocks(events, meta, grid);
    if (!blocks.length) throw new Error('No block_start events in events.csv — was this a "record only" session?');

    // One shared phase reference (audio start) so waveforms from different
    // blocks line up with each other.
    const audioEv = events.find((e) => e.event === 'audio_start' && e.sample_index !== null);
    const tRef = audioEv ? grid.t[grid.gridOfSample[Math.min(audioEv.sample_index, rec.raw.length - 1)]] : grid.t[0];

    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const perTarget = opt.targets.map(({ hz, shamHz }) => {
      const freqs = [hz, ...shamHz];
      const filtered = new Map(freqs.map((f) => [f, filtfilt(butterBandpass3(f - opt.halfBandHz, f + opt.halfBandHz, grid.fsHz), grid.x)]));
      return blocks.map((b) => {
        const byFreq = freqs.map((f) => fold(filtered.get(f), grid, b, f, tRef, opt));
        if (byFreq.some((r) => !r)) return null;
        const target = byFreq[0], sham = byFreq.slice(1);
        const shamAssr = mean(sham.map((r) => r.assr)), shamIcpc = mean(sham.map((r) => r.icpc));
        return {
          target, sham, shamAssr, shamIcpc,
          snrAssr: target.assr / shamAssr,
          snrIcpc: target.icpc / shamIcpc,
          beatsAllShams: sham.every((r) => target.assr > r.assr && target.icpc > r.icpc),
        };
      });
    });

    // Each block: byHz[40], byHz[80], ... (same block boundaries for every frequency).
    const results = blocks.map((b, i) => {
      if (perTarget.some((t) => !t[i])) return { ...b, tooShort: true };
      const byHz = {};
      opt.targets.forEach(({ hz }, j) => { byHz[hz] = perTarget[j][i]; });
      return { ...b, durationS: (b.endK - b.startK) / grid.fsHz, byHz };
    });

    let badCount = 0;
    for (let k = 0; k < grid.bad.length; k++) badCount += grid.bad[k];
    return {
      options: opt,
      timing: {
        measuredRateHz: timing.rateHz,
        jitterMs: timing.jitterMs,
        gaps: timing.gaps.length,
        lostSamples: timing.gaps.reduce((s, g) => s + g.lostSamples, 0),
      },
      samples: rec.raw.length,
      unusableFraction: badCount / grid.bad.length,
      blocks: results,
    };
  }

  const api = { analyze, butterBandpass3, filtfilt, parseRecording, parseEvents, fitTiming, DEFAULTS, UV_PER_COUNT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnalysisV2 = api;
})(typeof window !== 'undefined' ? window : globalThis);
