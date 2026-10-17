// Runs in a browser page (see music.mjs). An original, uplifting 128 BPM track
// in D major, synthesised offline with the Web Audio API, in a clean
// corporate-tech style: a piano ostinato over D–Bm–G–A, warm pads, a steady
// eighth-note bass, soft drums (half-time at first) and a gentle bell line,
// ending on a ringing chord when the end card lands. Plus the sound effects.
// Everything returns a 16-bit stereo WAV, base64-encoded.
const toWav = buf => {
  const ch = [buf.getChannelData(0), buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0)];
  let peak = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const gain = peak > 0 ? 0.92 / peak : 1; // normalise
  const len = buf.length;
  const sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * 4));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + len * 4, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 2, true);
  out.setUint32(24, sr, true);
  out.setUint32(28, sr * 4, true);
  out.setUint16(32, 4, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, len * 4, true);
  for (let i = 0, o = 44; i < len; i++)
    for (let c = 0; c < 2; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, ch[c][i] * gain)) * 0x7fff, true);
  let bin = '';
  const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const hz = m => 440 * Math.pow(2, (m - 69) / 12);
const noiseBuffer = ctx => {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 16807) % 2147483647; // deterministic noise
    d[i] = (seed / 2147483647) * 2 - 1;
  }
  return b;
};
const reverbOf = (ctx, seconds = 2.2, decay = 3) => {
  const ir = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
  let seed = 11;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(1 - i / d.length, decay);
    }
  }
  const r = ctx.createConvolver();
  r.buffer = ir;
  return r;
};

// D – Bm – G – A, one chord a bar: upper voices that share D and F#, so the
// harmony moves smoothly, and the bass underneath
const CHORDS = [
  { name: 'Dadd9', keys: [62, 66, 69, 76], bass: 38, bell: [[0, 90, 2], [2, 88, 2]] },
  { name: 'Bm7', keys: [62, 66, 69, 71], bass: 35, bell: [[0, 86, 3], [3, 85, 1]] },
  { name: 'Gmaj7', keys: [62, 66, 67, 71], bass: 31, bell: [[0, 83, 2], [2, 81, 2]] },
  { name: 'A', keys: [61, 64, 69, 73], bass: 33, bell: [[0, 85, 4]] },
];
// the piano's broken-chord pattern, one note per eighth
const OSTINATO = [0, 2, 3, 2, 1, 2, 3, 2];

/**
 * dur: length in seconds. endAt: when the end card lands (the drums stop and
 * the final chord rings out). pickup: beats before the downbeat. breaks:
 * [fromBar, toBar) ranges where the drums and bass rest (piano, pads and bell
 * carry on), with a swell back into the beat.
 * The style: clean piano, warm pads, a steady eighth-note bass, soft drums.
 */
window.renderMusic = async (dur, { bpm = 128, endAt = dur - 3, pickup = 2, breaks = [] } = {}) => {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const eighth = beat / 2;
  const down = pickup * beat;
  const noise = noiseBuffer(ctx);

  // master: gentle glue compression, then a limiter
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.ratio.value = 2.5;
  glue.attack.value = 0.02;
  glue.release.value = 0.25;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -4;
  limit.ratio.value = 20;
  limit.attack.value = 0.001;
  limit.release.value = 0.08;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.gain.setValueAtTime(0.8, dur - 0.8);
  master.gain.linearRampToValueAtTime(0, dur - 0.02);
  master.connect(glue).connect(limit).connect(ctx.destination);

  // a large, soft hall
  const hall = reverbOf(ctx, 3.2, 2.6);
  const hallIn = ctx.createBiquadFilter();
  hallIn.type = 'highpass';
  hallIn.frequency.value = 250;
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  hallIn.connect(hall).connect(wet).connect(master);

  const bus = (gain, reverb = 0) => {
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(master);
    if (reverb) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      g.connect(send).connect(hallIn);
    }
    return g;
  };
  const pianoBus = bus(0.9, 0.5);
  const padBus = bus(0.55, 0.6);
  const bassBus = bus(0.9);
  const drumBus = bus(0.85, 0.12);
  const bellBus = bus(0.5, 0.7);
  // the bass and pads ease back a little under each kick
  const duck = [padBus, bassBus];

  const pianoTone = ctx.createBiquadFilter();
  pianoTone.type = 'lowpass';
  pianoTone.frequency.value = 5200;
  pianoTone.connect(pianoBus);

  // a soft piano note: decaying sine partials, slightly stretched, plus a felt hammer
  const piano = (midi, t, vel = 1, len = 1.8) => {
    const f0 = hz(midi);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.6, Math.min(0.6, (midi - 66) / 22));
    p.connect(pianoTone);
    for (const [h, a, d] of [[1, 1, 1], [2, 0.45, 0.7], [3, 0.22, 0.5], [4, 0.12, 0.38], [5, 0.06, 0.3], [6, 0.03, 0.24]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f0 * h * (1 + 0.00035 * h * h);
      const g = ctx.createGain();
      const decay = len * d * (midi > 76 ? 0.75 : 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 * a * vel, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.05 * a * vel * 0.4, t + 0.1 + 0.15 * d);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    hit(p, t, { type: 'bandpass', freq: f0 * 4, q: 1.5, peak: 0.004 * vel, decay: 0.02 });
  };
  const hit = (dest, t, { type = 'highpass', freq, q = 0.7, peak, decay, offset = 0 }) => {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    n.connect(f).connect(g).connect(dest);
    n.start(t, offset % 1.5, decay + 0.05);
  };
  const swell = (dest, from, to, peak) => {
    // a reversed-cymbal swell into a downbeat
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.setValueAtTime(3000, from);
    f.frequency.exponentialRampToValueAtTime(8000, to);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, from);
    g.gain.exponentialRampToValueAtTime(peak, to - 0.01);
    g.gain.linearRampToValueAtTime(0, to + 0.01);
    n.connect(f).connect(g).connect(dest);
    n.start(from, 0.2, to - from + 0.05);
  };
  const pad = (chord, t, len) => {
    for (const m of [...chord.keys, chord.keys[0] - 12])
      for (const [d, pan] of [[-7, -0.5], [0, 0], [7, 0.5]]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = d;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1300;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.0055, t + 0.45);
        g.gain.setValueAtTime(0.0055, t + len - 0.25);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.35);
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        o.connect(f).connect(g).connect(p).connect(padBus);
        o.start(t);
        o.stop(t + len + 0.4);
      }
  };

  // --- the pickup: a swell and two piano notes into the downbeat
  swell(master, Math.max(0, down - beat * 2), down, 0.05);
  piano(69, 0.02, 0.7);
  piano(73, beat, 0.75);

  for (let b = 0; ; b++) {
    const t0 = down + b * bar;
    if (t0 >= endAt) break;
    const chord = CHORDS[b % 4];
    const barEnd = Math.min(t0 + bar, endAt);
    const resting = breaks.some(([a, z]) => b >= a && b < z);
    const full = b >= 4 && !resting; // the first four bars are half-time
    if (breaks.some(([, z]) => b === z - 1)) swell(master, t0, t0 + bar, 0.07);
    const lastBar = t0 + bar >= endAt;
    pad(chord, t0, barEnd - t0);
    // piano: a bass note on the downbeat and the broken chord above
    piano(chord.bass + 24, t0, 0.8, 2.6);
    for (let e = 0; e < 8; e++) {
      const t = t0 + e * eighth;
      if (t >= endAt) break;
      const accent = e % 2 === 0 ? 1 : 0.78;
      piano(chord.keys[OSTINATO[e]] + 12, t, accent * 0.85, 1.4);
    }
    // the bass: steady eighths, slightly shortened (a long low note in a break)
    if (resting) piano(chord.bass + 12, t0, 0.7, 2.4);
    for (let e = 0; e < 8 && !resting; e++) {
      const t = t0 + e * eighth;
      if (t >= endAt - (lastBar ? beat : 0)) break;
      for (const [type, oct, peak, cut] of [['sawtooth', 12, 0.1, 420], ['sine', 0, 0.22, 0]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz(chord.bass + oct);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak * (e % 2 ? 0.8 : 1), t + 0.008);
        g.gain.exponentialRampToValueAtTime(peak * 0.5, t + eighth * 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + eighth * 0.92);
        let node = o;
        if (cut) {
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = cut;
          node = node.connect(f);
        }
        node.connect(g).connect(bassBus);
        o.start(t);
        o.stop(t + eighth);
      }
    }
    // drums: soft kick (half-time first), a roomy rim on two and four, light hats
    for (let k = 0; k < 4; k++) {
      const t = t0 + k * beat;
      if (t >= endAt - (lastBar ? beat : 0) || resting) break; // a breath before the end
      if (full || k % 2 === 0) {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.75, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g).connect(drumBus);
        o.start(t);
        o.stop(t + 0.32);
        for (const d of duck) {
          d.gain.setValueAtTime(d.gain.value * 0.7, t);
          d.gain.linearRampToValueAtTime(d.gain.value, t + beat * 0.5);
        }
      }
      if (full && k % 2 === 1) {
        hit(drumBus, t, { type: 'bandpass', freq: 1900, q: 1.1, peak: 0.16, decay: 0.09, offset: k * 0.17 });
        const o = ctx.createOscillator();
        o.frequency.value = 210;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.08, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        o.connect(g).connect(drumBus);
        o.start(t);
        o.stop(t + 0.08);
      }
      for (const h of [0, 1]) hit(drumBus, t + h * eighth, { freq: 9000, peak: h ? 0.03 : 0.018, decay: 0.03, offset: b * 0.13 + k * 0.07 + h * 0.03 });
      if (full) for (const sx of [1, 3]) hit(drumBus, t + sx * (beat / 4), { type: 'bandpass', freq: 6500, q: 0.9, peak: 0.01, decay: 0.04, offset: sx * 0.21 + b * 0.05 });
    }
    // a gentle bell line in every other four-bar phrase once the drums are in
    if ((full && Math.floor(b / 4) % 2 === 1) || resting)
      for (const [st, m, lenBeats] of chord.bell) {
        const t = t0 + st * beat;
        if (t >= endAt) break;
        for (const [mult, amp, decay] of [[1, 0.06, 1.8], [2.76, 0.012, 0.5], [5.4, 0.005, 0.25]]) {
          const o = ctx.createOscillator();
          o.frequency.value = hz(m) * mult;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(amp, t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(decay, lenBeats * beat + 0.8));
          o.connect(g).connect(bellBus);
          o.start(t);
          o.stop(t + decay + 0.05);
        }
      }
  }

  // into the end card: a swell, then a soft low hit and the final chord ringing out
  if (endAt < dur) {
    swell(master, endAt - bar, endAt, 0.08);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, endAt);
    o.frequency.exponentialRampToValueAtTime(30, endAt + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, endAt);
    g.gain.exponentialRampToValueAtTime(0.6, endAt + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, endAt + 1.4);
    o.connect(g).connect(master);
    o.start(endAt);
    o.stop(endAt + 1.5);
    const ring = dur - endAt;
    for (const [m, v] of [[38, 0.9], [50, 0.8], [57, 0.7], [62, 0.75], [66, 0.7], [69, 0.7], [76, 0.65], [81, 0.55]]) piano(m, endAt + (m - 38) * 0.004, v, ring + 1.5);
    pad(CHORDS[0], endAt, ring - 0.4);
    for (const [m, at] of [[86, 0.02], [90, 0.3]]) {
      const t = endAt + at;
      const b = ctx.createOscillator();
      b.frequency.value = hz(m);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(ring, 3));
      b.connect(bg).connect(bellBus);
      b.start(t);
      b.stop(t + ring);
    }
  }

  return toWav(await ctx.startRendering());
};

// --- sound effects
const SFX = {
  // a fast air whoosh for camera moves and scene changes
  whoosh: (ctx, noise) => {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(300, 0);
    f.frequency.exponentialRampToValueAtTime(4000, 0.22);
    f.frequency.exponentialRampToValueAtTime(900, 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.9, 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, 0.52);
    n.connect(f).connect(g).connect(ctx.destination);
    n.start(0);
  },
  // a gentle UI tick for captions
  tick: ctx => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(2200, 0);
    o.frequency.exponentialRampToValueAtTime(1300, 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.5, 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, 0.06);
    o.connect(g).connect(ctx.destination);
    o.start(0);
    o.stop(0.08);
  },
  // a soft, woody tap for things that land
  pop: ctx => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1050, 0);
    o.frequency.exponentialRampToValueAtTime(760, 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.45, 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, 0.09);
    o.connect(g).connect(ctx.destination);
    o.start(0);
    o.stop(0.14);
  },
  // a two-note success chime
  chime: ctx => {
    [[86, 0], [93, 0.08]].forEach(([m, t]) => {
      for (const [mult, amp] of [[1, 0.35], [2.01, 0.08], [3, 0.04]]) {
        const o = ctx.createOscillator();
        o.frequency.value = hz(m) * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(amp, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 1.25);
      }
    });
  },
  // a low cinematic hit
  impact: (ctx, noise) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, 0);
    o.frequency.exponentialRampToValueAtTime(34, 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(1, 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, 1.1);
    o.connect(g).connect(ctx.destination);
    o.start(0);
    o.stop(1.2);
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(4000, 0);
    f.frequency.exponentialRampToValueAtTime(300, 0.4);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, 0);
    ng.gain.exponentialRampToValueAtTime(0.5, 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, 0.45);
    n.connect(f).connect(ng).connect(ctx.destination);
    n.start(0);
  },
};

window.renderSfx = async name => {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, sr * 1.5, sr);
  SFX[name](ctx, noiseBuffer(ctx));
  return toWav(await ctx.startRendering());
};
window.SFX_NAMES = Object.keys(SFX);
