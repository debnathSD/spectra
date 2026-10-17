// Runs in a browser page (see music.mjs). An original, uplifting 128 BPM track
// in D major, synthesised offline with the Web Audio API: a two-beat riser
// pickup, then four-on-the-floor drums with claps and open hats, an offbeat
// bass, wide pumping chords and a catchy lead hook over D–A–Bm–G, ending on a
// big ringing chord when the end card lands. Plus the sound effects.
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

// D – A – Bm – G, one chord a bar
const CHORDS = [
  { pad: [62, 66, 69, 74, 78], bass: 38 },
  { pad: [61, 64, 69, 73, 76], bass: 45 },
  { pad: [62, 66, 71, 74, 78], bass: 47 },
  { pad: [62, 67, 71, 74, 79], bass: 43 },
];
// the hook: [16th step, note, length in 16ths] per bar of a four-bar phrase
const HOOK = [
  [[0, 81, 2], [3, 81, 1], [4, 83, 2], [6, 81, 2], [8, 78, 3], [11, 76, 1], [12, 78, 4]],
  [[0, 76, 2], [3, 76, 1], [4, 78, 2], [6, 76, 2], [8, 73, 3], [11, 76, 1], [12, 81, 4]],
  [[0, 86, 2], [3, 85, 1], [4, 83, 2], [6, 81, 2], [8, 78, 3], [11, 81, 1], [12, 83, 4]],
  [[0, 83, 2], [3, 81, 1], [4, 79, 2], [6, 78, 2], [8, 76, 4], [14, 76, 1], [15, 78, 1]],
];
const HOOK_END = [[0, 83, 2], [3, 81, 1], [4, 79, 2], [6, 78, 2], [8, 74, 8]];

/**
 * dur: length in seconds. endAt: when the end card lands (the drums stop and
 * the final chord rings out). pickup: beats before the drop.
 */
window.renderMusic = async (dur, { bpm = 128, endAt = dur - 3, pickup = 2 } = {}) => {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const step = beat / 4;
  const drop = pickup * beat;
  const noise = noiseBuffer(ctx);

  // master: glue compressor, then a fast limiter
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20;
  glue.ratio.value = 3;
  glue.attack.value = 0.01;
  glue.release.value = 0.2;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -6;
  limit.ratio.value = 20;
  limit.attack.value = 0.001;
  limit.release.value = 0.06;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.gain.setValueAtTime(0.8, dur - 0.6);
  master.gain.linearRampToValueAtTime(0, dur - 0.02);
  master.connect(glue).connect(limit).connect(ctx.destination);

  const reverb = reverbOf(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.25;
  reverb.connect(wet).connect(master);

  // the chord bus pumps with the kick
  const pump = ctx.createGain();
  pump.gain.value = 1;
  const chordFilter = ctx.createBiquadFilter();
  chordFilter.type = 'lowpass';
  chordFilter.Q.value = 0.7;
  chordFilter.frequency.setValueAtTime(700, 0);
  chordFilter.frequency.exponentialRampToValueAtTime(4200, drop);
  chordFilter.connect(pump);
  pump.connect(master);
  pump.connect(reverb);

  // the lead and arp bus, with a dotted-eighth echo
  const leadBus = ctx.createGain();
  leadBus.gain.value = 0.11;
  const echo = ctx.createDelay(2);
  echo.delayTime.value = beat * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.28;
  const echoLp = ctx.createBiquadFilter();
  echoLp.type = 'lowpass';
  echoLp.frequency.value = 3000;
  leadBus.connect(master);
  leadBus.connect(echo);
  echo.connect(echoLp).connect(fb).connect(echo);
  echoLp.connect(master);
  leadBus.connect(reverb);

  const env = (g, t, peak, attack, hold, release) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  };
  const play = (dest, { type = 'sawtooth', midi, t, peak, attack = 0.005, hold = 0, release = 0.2, detune = 0, pan = 0, filter }) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz(midi);
    o.detune.value = detune;
    const g = ctx.createGain();
    env(g, t, peak, attack, hold, release);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      node = node.connect(f);
    }
    node.connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(dest);
    } else g.connect(dest);
    o.start(t);
    o.stop(t + attack + hold + release + 0.05);
  };
  const hit = (dest, t, { type = 'highpass', freq, q = 0.7, peak, decay, len = decay + 0.05, offset = 0 }) => {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, 0.002, 0, decay);
    n.connect(f).connect(g).connect(dest);
    n.start(t, offset % 1.5, len);
  };

  // --- the pickup: a riser and a filtered chord into the drop
  {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(400, 0);
    f.frequency.exponentialRampToValueAtTime(7000, drop);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.35, drop - 0.02);
    g.gain.linearRampToValueAtTime(0, drop);
    n.connect(f).connect(g).connect(master);
    n.start(0, 0, drop);
  }

  const bars = Math.ceil((endAt - drop) / bar) + 1;
  const pickupChord = CHORDS[0];
  for (const m of pickupChord.pad) for (const d of [-14, 0, 14]) play(chordFilter, { midi: m, t: 0.02, peak: 0.012, attack: drop * 0.8, hold: 0, release: 0.3, detune: d, pan: d / 30 });

  // --- the song
  for (let b = 0; b < bars; b++) {
    const t0 = drop + b * bar;
    if (t0 >= endAt) break;
    const chord = CHORDS[b % 4];
    const section = Math.floor(b / 4) % 3; // hook, hook, arp break
    const barEnd = Math.min(t0 + bar, endAt);
    // wide chords: five detuned saws per note, spread across the stereo field
    for (const m of chord.pad)
      for (const [d, pan] of [[-18, -0.7], [-8, -0.35], [0, 0], [8, 0.35], [18, 0.7]])
        play(chordFilter, { midi: m, t: t0, peak: 0.0075, attack: 0.01, hold: Math.max(0, barEnd - t0 - 0.12), release: 0.12, detune: d, pan });
    for (let k = 0; k < 4; k++) {
      const t = t0 + k * beat;
      if (t >= endAt) break;
      // kick, with the chords ducking under it
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
      const g = ctx.createGain();
      env(g, t, 1, 0.002, 0.03, 0.3);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.4);
      hit(master, t, { freq: 2500, peak: 0.12, decay: 0.012 });
      pump.gain.setValueAtTime(0.25, t);
      pump.gain.linearRampToValueAtTime(1, t + beat * 0.62);
      // claps on two and four
      if (k % 2 === 1)
        for (const [dt, p] of [[0, 0.32], [0.011, 0.28], [0.023, 0.34]]) {
          hit(master, t + dt, { type: 'bandpass', freq: 1300, q: 0.9, peak: p, decay: dt === 0.023 ? 0.18 : 0.012, offset: k * 0.13 + dt });
          hit(reverb, t + dt, { type: 'bandpass', freq: 1300, q: 0.9, peak: p * 0.5, decay: 0.12, offset: k * 0.21 });
        }
      // offbeat bass and sub
      const ob = t + beat / 2;
      play(master, { midi: chord.bass, t: ob, peak: 0.2, attack: 0.004, hold: beat * 0.18, release: beat * 0.2, filter: 900 });
      play(master, { type: 'sine', midi: chord.bass - 12, t: ob, peak: 0.32, attack: 0.004, hold: beat * 0.2, release: beat * 0.2 });
      // open hat on the offbeat, closed hats on the sixteenths
      hit(master, ob, { freq: 7500, peak: 0.07, decay: 0.16, offset: b * 0.07 + k * 0.03 });
      for (let s = 0; s < 4; s++) if (s !== 2) hit(master, t + s * step, { freq: 9500, peak: s % 2 ? 0.035 : 0.05, decay: 0.03, offset: s * 0.11 + b * 0.05 });
    }
    // the hook, or a sixteenth-note arpeggio in the break
    if (section < 2) {
      const lastPhrase = t0 + 4 * bar >= endAt || section === 1;
      const notes = b % 4 === 3 && lastPhrase ? HOOK_END : HOOK[b % 4];
      for (const [st, midi, len] of notes) {
        const t = t0 + st * step;
        if (t >= endAt) break;
        const hold = Math.max(0.02, len * step - 0.06);
        play(leadBus, { type: 'square', midi, t, peak: 0.42, attack: 0.006, hold, release: 0.12, filter: 3800 });
        play(leadBus, { midi, t, peak: 0.32, attack: 0.006, hold, release: 0.12, detune: 7, filter: 4200 });
        play(leadBus, { type: 'sine', midi: midi + 12, t, peak: 0.16, attack: 0.004, hold: 0, release: 0.35 });
      }
    }
    const arpGain = section === 2 ? 0.5 : 0.18;
    const pattern = [0, 2, 4, 2, 1, 3, 4, 3];
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * step;
      if (t >= endAt) break;
      play(leadBus, { type: 'triangle', midi: chord.pad[pattern[s % 8]] + 12, t, peak: arpGain, attack: 0.003, hold: 0, release: 0.11, pan: s % 2 ? 0.3 : -0.3 });
    }
  }

  // a snare roll and a riser into the end card
  const fill = Math.max(drop, endAt - bar);
  for (let i = 0; endAt - fill > 0 && fill + i * step < endAt; i++) {
    const t = fill + i * step;
    hit(master, t, { type: 'bandpass', freq: 1500, q: 0.8, peak: 0.06 + (i / 16) * 0.22, decay: 0.08, offset: i * 0.09 });
  }
  {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, fill);
    f.frequency.exponentialRampToValueAtTime(8000, endAt);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, fill);
    g.gain.exponentialRampToValueAtTime(0.3, endAt - 0.02);
    g.gain.linearRampToValueAtTime(0, endAt);
    n.connect(f).connect(g).connect(master);
    n.start(fill, 0.3, endAt - fill);
  }

  // the end: an impact and a big D chord ringing out
  if (endAt < dur) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, endAt);
    o.frequency.exponentialRampToValueAtTime(32, endAt + 0.6);
    const g = ctx.createGain();
    env(g, endAt, 0.9, 0.003, 0.05, 1.2);
    o.connect(g).connect(master);
    o.start(endAt);
    o.stop(endAt + 1.4);
    hit(master, endAt, { type: 'lowpass', freq: 3000, peak: 0.35, decay: 0.5 });
    hit(reverb, endAt, { type: 'lowpass', freq: 5000, peak: 0.4, decay: 0.8 });
    const ring = dur - endAt;
    for (const m of [38, 50, 57, 62, 66, 69, 74, 78, 81])
      for (const d of [-12, 0, 12]) {
        const peak = m < 50 ? 0.05 : 0.012;
        play(master, { type: m < 50 ? 'triangle' : 'sawtooth', midi: m, t: endAt, peak, attack: 0.01, hold: 0.05, release: ring, detune: d, pan: d / 24, filter: 3200 });
        play(reverb, { type: 'sawtooth', midi: m, t: endAt, peak: peak * 0.6, attack: 0.01, hold: 0, release: ring, detune: d, filter: 2500 });
      }
    for (const m of [86, 90, 93]) play(master, { type: 'sine', midi: m, t: endAt + 0.02, peak: 0.08, attack: 0.003, hold: 0, release: Math.min(ring, 2.5) });
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
  // a bright pop for things that land
  pop: ctx => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(500, 0);
    o.frequency.exponentialRampToValueAtTime(1400, 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.6, 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, 0.12);
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
