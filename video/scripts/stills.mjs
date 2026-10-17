// Preview frames without a full render: node scripts/stills.mjs <id> <second> [second ...]
// Writes out/stills/<id>-<second>.png.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMusic } from './music.mjs';

const VIDEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [id, ...seconds] = process.argv.slice(2);
const dir = path.join(VIDEO, 'out', 'stills');
fs.mkdirSync(dir, { recursive: true });
if (!['impact.wav', `${id}.wav`].every(f => fs.existsSync(path.join(VIDEO, 'public', 'music', f)))) await makeMusic({ [id]: { seconds: 10 } });
const serveUrl = await bundle({ entryPoint: path.join(VIDEO, 'src', 'index.jsx'), publicDir: path.join(VIDEO, 'public') });
const composition = await selectComposition({ serveUrl, id });
console.log(`${id}: ${(composition.durationInFrames / composition.fps).toFixed(1)} s`);
for (const sec of seconds) {
  const output = path.join(dir, `${id}-${sec}.png`);
  await renderStill({ composition, serveUrl, output, frame: Math.min(composition.durationInFrames - 1, Math.round(Number(sec) * composition.fps)) });
}
console.log('done');
