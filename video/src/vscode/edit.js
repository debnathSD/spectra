// The edit of the VS Code recording (public/footage/vscode.json, written by
// scripts/record-vscode.mjs): which stretches of footage play, for how many
// beats of the music, where the camera looks and what the captions say. Every
// time comes from a marker the recorder saved, so a fresh recording re-cuts
// itself, and every cut lands on a beat.
import footage from '../../public/footage/vscode.json';
import { BEAT, beats } from '../theme.js';

export { footage };
const marker = name => {
  const m = footage.markers.find(x => x.name === name);
  if (!m) throw new Error(`The recording has no "${name}" marker; record it again.`);
  return m;
};
const T = name => marker(name).t;
const mice = footage.markers.filter(m => m.name === 'mouse');
const center = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export const INTRO = beats(6); // the title; the music drops at beat 2
export const STATS = beats(8);
export const OUTRO = beats(10);
export const FADE = 8; // frames of crossfade between stretches

// where things are on screen (footage CSS pixels, 1440 × 900)
const notifyProfile = center(marker('profile:done').notification);
const notifyVerify = center(marker('verify:done').notification);
const palette = { x: 722, y: 150 };
const lens = center(marker('verify:done').lens);
const hover = center(marker('hover').box);
const panel = center(marker('problems:open').panel);
const overview = { x: footage.viewport.width / 2, y: footage.viewport.height / 2 };

// The stretches, in order, each squeezed into a number of beats.
// cam: [beats into the stretch, zoom, focus].
export const SHOTS = [
  { id: 'palette', from: T('profile:palette') - 0.35, to: T('profile:url') + 0.25, beats: 8, cam: [[0, 1, overview], [0.6, 1.9, palette]] },
  { id: 'running', from: T('profile:url') + 0.25, to: T('profile:done') - 0.7, beats: 4, cam: [[0, 2.1, notifyProfile]] },
  // pull back as the findings land everywhere at once, then look at the line
  { id: 'results', from: T('profile:done') - 0.7, to: mice[0].t, beats: 8, cam: [[1, 1, overview], [4, 2.25, { x: lens.x + 60, y: lens.y + 30 }]] },
  { id: 'hover', from: mice[0].t, to: mice[1].t, beats: 8, cam: [[0.5, 1.6, hover]] },
  { id: 'problems', from: T('problems') - 0.2, to: T('edit') - 0.1, beats: 8, cam: [[0, 1.15, overview], [1, 1.42, panel]] },
  { id: 'edit', from: T('edit'), to: T('edit:saved'), beats: 8, cam: [[0, 2.35, { x: lens.x + 90, y: lens.y + 50 }]] },
  { id: 'verifyPalette', from: T('verify:palette'), to: T('verify:running') + 0.1, beats: 6, cam: [[0, 1.9, palette]] },
  { id: 'verifying', from: T('verify:running') + 0.1, to: T('verify:shown') - 0.4, beats: 4, cam: [[0, 2.1, notifyVerify]] },
  { id: 'verified', from: T('verify:shown') - 0.4, to: T('end'), beats: 8, cam: [[0, 2.1, notifyVerify], [4.5, 1, overview]] },
];

let at = INTRO;
for (const shot of SHOTS) {
  shot.start = at;
  shot.frames = beats(shot.beats);
  shot.rate = (shot.to - shot.from) / (shot.frames / 60);
  shot.cam = shot.cam.map(([b, z, focus]) => [Math.round(b * BEAT), z, focus]);
  at += shot.frames;
}
export const FOOTAGE_END = at;
export const DURATION = FOOTAGE_END + STATS + OUTRO;

/** The output frame at which footage time `t` plays. */
export const frameOf = t => {
  const shot = SHOTS.find(x => t >= x.from && t < x.to) || SHOTS.at(-1);
  return shot.start + Math.round(((t - shot.from) / shot.rate) * 60);
};
/** Footage time at output frame `f`. */
export const timeAt = f => {
  const shot = [...SHOTS].reverse().find(x => f >= x.start) || SHOTS[0];
  return shot.from + ((f - shot.start) / 60) * shot.rate;
};

/** The mouse position at footage time t, following the recorder's eased glides. */
export const mouseAt = t => {
  let pos = { x: footage.viewport.width * 0.62, y: footage.viewport.height * 0.5 };
  for (const m of mice) {
    if (t < m.t) break;
    const p = Math.min(1, (t - m.t) / (m.ms / 1000));
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    pos = { x: m.from.x + (m.to.x - m.from.x) * e, y: m.from.y + (m.to.y - m.from.y) * e };
  }
  return pos;
};

// real values from the recording
const verifyText = marker('verify:done').text; // "Spectra: Improved — JavaScript CPU time: 1.56 s → 105 ms (−93%) (confidence: medium)"
const cpu = /CPU time: ([\d.]+ m?s) → ([\d.]+ m?s) \(([^)]+)\)/.exec(verifyText);
const renderTime = text => /·\s*([\d.]+ m?s) rendering/.exec(text)[1];
export const RESULT = {
  findings: /(\d+) findings/.exec(marker('profile:done').text)[1],
  verdict: /Spectra: (\w+)/.exec(verifyText)[1],
  confidence: /confidence: (\w+)/.exec(verifyText)[1],
  cpu: { before: cpu[1], after: cpu[2], delta: cpu[3] },
  render: { before: renderTime(marker('profile:done').lensText), after: renderTime(marker('verify:done').lensText) },
};

// keyboard shortcuts as they were pressed
export const KEYS = [
  { t: T('profile:palette'), keys: ['⌘', '⇧', 'P'] },
  { t: T('problems'), keys: ['⌘', '⇧', 'M'] },
  { t: T('edit') + 0.05, keys: ['⌃', 'G'] },
  { t: T('edit:saved') - 1.2, keys: ['⌘', 'S'] },
  { t: T('verify:palette') + 0.05, keys: ['⌘', '⇧', 'P'] },
];
