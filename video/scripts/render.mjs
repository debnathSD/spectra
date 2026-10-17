// Renders the videos with their music: node scripts/render.mjs [id ...]
// Ids: vscode, claude-code, mcp-server (default: all). Writes the master,
// out/<id>.mp4, a lighter copy for the website, out/web/<id>.mp4, and a
// poster, out/<id>.jpg. Both videos' sound is normalised to -16 LUFS. The music is synthesised
// (synth.js) to each video's exact length, so its final chord hits as the end
// card lands (props.musicEnd). With --audio, only the sound is rendered again
// and swapped into the existing videos, which is much faster.
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
const args = process.argv.slice(2);
const audioOnly = args.includes('--audio');
const named = args.filter(a => !a.startsWith('--'));
const ids = named.length ? named : ['vscode', 'claude-code', 'mcp-server'];
fs.mkdirSync(path.join(OUT, 'web'), { recursive: true });

// the ffmpeg that ships with Remotion
const { dir: FF } = createRequire(import.meta.url)(`@remotion/compositor-${process.platform}-${process.arch}`);
const LOUDNESS = 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000';
const ffmpeg = (...a) => execFileSync(path.join(FF, 'ffmpeg'), ['-y', '-loglevel', 'error', ...a], { env: { ...process.env, DYLD_LIBRARY_PATH: FF, LD_LIBRARY_PATH: FF } });
const webEncode = id =>
  ffmpeg('-i', path.join(OUT, `${id}.mp4`), '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', path.join(OUT, 'web', `${id}.mp4`));
// swaps a new soundtrack into a rendered video, keeping its picture as it is
const swapAudio = (file, wav, bitrate = '192k') => {
  const tmp = `${file}.tmp.mp4`;
  ffmpeg('-i', file, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', LOUDNESS, '-c:a', 'aac', '-b:a', bitrate, '-shortest', '-movflags', '+faststart', tmp);
  fs.renameSync(tmp, file);
};

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

// 3a. only the sound
if (audioOnly) {
  for (const id of ids) {
    const composition = await selectComposition({ serveUrl, id });
    const wav = path.join(OUT, `${id}.wav`);
    await renderMedia({ composition, serveUrl, codec: 'wav', outputLocation: wav });
    swapAudio(path.join(OUT, `${id}.mp4`), wav);
    swapAudio(path.join(OUT, 'web', `${id}.mp4`), wav, '160k');
    fs.rmSync(wav);
    console.log(`${id}: new soundtrack in out/${id}.mp4 and out/web/${id}.mp4`);
  }
  process.exit(0);
}

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
  const wav = path.join(OUT, `${id}.wav`);
  await renderMedia({ composition, serveUrl, codec: 'wav', outputLocation: wav });
  swapAudio(outputLocation, wav);
  fs.rmSync(wav);
  webEncode(id);
  const mb = file => (fs.statSync(file).size / 1024 / 1024).toFixed(1);
  console.log(`${id}: ${tracks[id].seconds.toFixed(1)} s, master ${mb(outputLocation)} MB, web ${mb(path.join(OUT, 'web', `${id}.mp4`))} MB`);
}
