// Synthesises the soundtrack (synth.js) in Chrome: public/music/<id>.wav for
// each video, plus the sound effects. tracks: { id: { seconds, endAt } }.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VIDEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(VIDEO, '..');
const MUSIC = path.join(VIDEO, 'public', 'music');

export async function makeMusic(tracks) {
  fs.mkdirSync(MUSIC, { recursive: true });
  const require = createRequire(`${REPO}/package.json`);
  const puppeteer = require('puppeteer-core');
  const { findChrome } = await import(pathToFileURL(`${REPO}/server/chrome.js`).href);
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: path.join(VIDEO, 'scripts', 'synth.js') });
    for (const [id, { seconds, endAt }] of Object.entries(tracks)) {
      const wav = await page.evaluate((d, e) => window.renderMusic(d, { endAt: e }), seconds, endAt ?? seconds - 3);
      fs.writeFileSync(path.join(MUSIC, `${id}.wav`), Buffer.from(wav, 'base64'));
    }
    for (const name of await page.evaluate(() => window.SFX_NAMES)) {
      const wav = await page.evaluate(n => window.renderSfx(n), name);
      fs.writeFileSync(path.join(MUSIC, `${name}.wav`), Buffer.from(wav, 'base64'));
    }
  } finally {
    await browser.close();
  }
}
