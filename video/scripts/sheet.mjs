// A contact sheet of several compositions at one moment:
// node scripts/sheet.mjs <second> <out.png> <id> [id …]
// Tiling needs a full ffmpeg build: $FFMPEG, or ffmpeg on the PATH.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [sec, out, ...ids] = process.argv.slice(2);
const dir = path.join(VIDEO, 'out', 'stills');
fs.mkdirSync(dir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(VIDEO, 'src', 'index.jsx'), publicDir: path.join(VIDEO, 'public') });
const files = [];
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id, chromiumOptions: { gl: 'angle' } });
  const output = path.join(dir, `${id}-${sec}.png`);
  await renderStill({ composition, serveUrl, output, frame: Math.min(composition.durationInFrames - 1, Math.round(Number(sec) * composition.fps)), chromiumOptions: { gl: 'angle' } });
  files.push(output);
}
const cols = Math.min(3, files.length);
const rows = Math.ceil(files.length / cols);
const layout = files.map((_, i) => `${(i % cols) === 0 ? '0' : Array.from({ length: i % cols }, (_, k) => `w${k}`).join('+')}_${Math.floor(i / cols) === 0 ? '0' : Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+')}`).join('|');
const inputs = files.flatMap(f => ['-i', f]);
const pad = cols * rows - files.length;
execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', ...inputs, ...(pad ? ['-f', 'lavfi', '-i', `color=black:s=960x540`] : []), '-filter_complex', `${files.map((_, i) => `[${i}]scale=960:540[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black`, path.join(VIDEO, 'out', out)]);
console.log(`out/${out}`);
