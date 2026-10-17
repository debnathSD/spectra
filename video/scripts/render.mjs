// Renders the videos with their music: node scripts/render.mjs [id ...]
// Ids: vscode, claude-code, mcp-server (default: all). Writes the master,
// out/<id>.mp4, a lighter copy for the website, out/web/<id>.mp4 (with 1.5 dB
// of audio headroom), and a poster, out/<id>.jpg. The music is synthesised (synth.js) to each video's
// exact length, so its final chord hits as the end card lands (props.musicEnd).
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMusic } from './music.mjs';

const VIDEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(VIDEO, 'out');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['vscode', 'claude-code', 'mcp-server'];
fs.mkdirSync(path.join(OUT, 'web'), { recursive: true });

// the ffmpeg that ships with Remotion
const { dir: FF } = createRequire(import.meta.url)(`@remotion/compositor-${process.platform}-${process.arch}`);
export const webEncode = id =>
  execFileSync(
    path.join(FF, 'ffmpeg'),
    ['-y', '-loglevel', 'error', '-i', path.join(OUT, `${id}.mp4`), '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-af', 'volume=-1.5dB', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', path.join(OUT, 'web', `${id}.mp4`)],
    { env: { ...process.env, DYLD_LIBRARY_PATH: FF, LD_LIBRARY_PATH: FF } },
  );

const entryPoint = path.join(VIDEO, 'src', 'index.jsx');
const pack = () => bundle({ entryPoint, publicDir: path.join(VIDEO, 'public') });

// 1. how long is each video?
let serveUrl = await pack();
const tracks = {};
for (const id of ids) {
  const c = await selectComposition({ serveUrl, id });
  tracks[id] = { seconds: c.durationInFrames / c.fps, endAt: c.props.musicEnd / c.fps };
}

// 2. music sized to each video, and the sound effects
await makeMusic(tracks);
serveUrl = await pack();

// 3. the videos
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id });
  const outputLocation = path.join(OUT, `${id}.mp4`);
  let last = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 16,
    x264Preset: 'slow',
    pixelFormat: 'yuv420p',
    imageFormat: 'png',
    audioBitrate: '192k',
    outputLocation,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== last) console.log(`${id}: ${pct}%`), (last = pct);
    },
  });
  await renderStill({ composition, serveUrl, output: path.join(OUT, `${id}.jpg`), frame: composition.props.poster ?? Math.round(2.2 * composition.fps), imageFormat: 'jpeg', jpegQuality: 88, scale: 2 / 3 });
  webEncode(id);
  const mb = file => (fs.statSync(file).size / 1024 / 1024).toFixed(1);
  console.log(`${id}: ${tracks[id].seconds.toFixed(1)} s, master ${mb(outputLocation)} MB, web ${mb(path.join(OUT, 'web', `${id}.mp4`))} MB`);
}
