#!/usr/bin/env node
/**
 * Captures the dashboard screenshots used by the Spectra documentation (on the
 * Progen Labs website) and measures where each annotated region is on them, so
 * the docs' numbered call-outs stay aligned whenever the screenshots are
 * refreshed. Not shipped in the npm package.
 *
 * Needs a running demo app (npm run demo) and a dashboard over a project that
 * has recordings of it (spectra dashboard --port 4400), then:
 *
 *   node scripts/docs-screenshots.mjs \
 *     --dashboard http://127.0.0.1:4400 --app http://localhost:5188/ \
 *     --live <live report id> --before id1,id2,id3 --after id4,id5,id6 \
 *     --out ../website/src/spectra-docs/images
 *
 * Writes <shot>.webp and manifest.json:
 *   { "<shot>": { "width", "height", "regions": { "<key>": [x, y, w, h] } } }
 * with regions as percentages of the image.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../server/chrome.js';
import { parseArgs } from '../server/args.js';

const { opt } = parseArgs(process.argv.slice(2));
const DASHBOARD = opt('dashboard', 'http://127.0.0.1:4400');
const APP = opt('app', 'http://localhost:5188/');
const OUT = path.resolve(opt('out', 'docs-screenshots'));
const LIVE = opt('live');
const BEFORE = String(opt('before', '')).split(',').filter(Boolean);
const AFTER = String(opt('after', '')).split(',').filter(Boolean);
const WIDTH = Number(opt('width', 1120)); // close to the docs column, so text stays legible
const SCALE = Number(opt('scale', 1.5));
if (!LIVE || !BEFORE.length || !AFTER.length) {
  console.error('usage: docs-screenshots.mjs --live <id> --before <ids> --after <ids> [--dashboard url] [--app url] [--out dir]');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const manifest = {};

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-shots-')),
  defaultViewport: null,
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

// ------------------------------------------------------------------ helpers

/** A region spec: 'selector', { sel, nth, text, all }, or an array (union). */
async function rectOf(spec) {
  const specs = (Array.isArray(spec) ? spec : [spec]).map(s => (typeof s === 'string' ? { sel: s } : s));
  return page.evaluate(list => {
    const rects = [];
    for (const s of list) {
      let els = [...document.querySelectorAll(s.sel)];
      if (s.text) els = els.filter(e => new RegExp(s.text).test(e.textContent.trim()));
      if (!s.all) els = els[s.nth || 0] ? [els[s.nth || 0]] : [];
      for (const e of els) rects.push(e.getBoundingClientRect());
    }
    if (!rects.length) return null;
    const x = Math.min(...rects.map(r => r.left));
    const y = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return { x: x + window.scrollX, y: y + window.scrollY, width: right - x, height: bottom - y };
  }, specs);
}

async function shoot(name, { viewport = 900, clip, pad = 14, maxHeight, regions = {}, prepare }) {
  await page.setViewport({ width: WIDTH, height: viewport, deviceScaleFactor: SCALE });
  await sleep(500);
  if (prepare) await prepare();
  await sleep(700);
  let c = clip ? await rectOf(clip) : { x: 0, y: 0, width: WIDTH, height: viewport };
  if (!c) throw new Error(`${name}: nothing matched the clip`);
  if (clip) {
    const x = Math.max(0, c.x - pad);
    const y = Math.max(0, c.y - pad);
    c = { x, y, width: Math.min(WIDTH - x, c.width + 2 * pad), height: c.height + 2 * pad };
  }
  if (maxHeight) c.height = Math.min(c.height, maxHeight);
  if (c.y + c.height > viewport + 1) console.warn(`  ! ${name}: clip runs past the viewport (${Math.round(c.y + c.height)} > ${viewport})`);
  await page.screenshot({ path: path.join(OUT, `${name}.webp`), type: 'webp', quality: 82, clip: c });

  const out = {};
  for (const [key, spec] of Object.entries(regions)) {
    const r = await rectOf(spec);
    if (!r) {
      console.warn(`  ! ${name}: region "${key}" not found`);
      continue;
    }
    const pct = (v, total) => Math.round((v / total) * 10000) / 100;
    const x = Math.max(r.x, c.x);
    const y = Math.max(r.y, c.y);
    const w = Math.min(r.x + r.width, c.x + c.width) - x;
    const h = Math.min(r.y + r.height, c.y + c.height) - y;
    if (w <= 0 || h <= 0) {
      console.warn(`  ! ${name}: region "${key}" is outside the shot`);
      continue;
    }
    out[key] = [pct(x - c.x, c.width), pct(y - c.y, c.height), pct(w, c.width), pct(h, c.height)];
  }
  manifest[name] = { width: Math.round(c.width), height: Math.round(c.height), regions: out };
  console.log(`✓ ${name}  ${Math.round(c.width)}×${Math.round(c.height)}  ${Object.keys(out).length} regions`);
}

const clickText = (sel, text) =>
  page.evaluate(
    (sel, text) => {
      const el = [...document.querySelectorAll(sel)].find(e => new RegExp(text).test(e.textContent.trim()));
      if (!el) throw new Error(`no ${sel} matching ${text}`);
      el.click();
    },
    sel,
    text,
  );
const openTab = label => clickText('.tab-list button, .tab-list [role=tab]', `^${label}`);
const pickReport = async id => {
  await page.select('.report-picker select', id);
  await sleep(1200);
};

// The dashboard keeps a live event stream open, so wait for the UI, not the network.
async function load(style = 'glass', mode = 'dark') {
  await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    (s, m) => {
      localStorage.setItem('perf-profiler:theme', s);
      localStorage.setItem('perf-profiler:mode', m);
    },
    style,
    mode,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.report-picker select');
  await sleep(1200);
}

// ------------------------------------------------------------------ shots

await load();
await pickReport(LIVE);

await shoot('dashboard-overview', {
  viewport: 760,
  regions: {
    picker: '.report-picker',
    appearance: { sel: '.topbar .popover' },
    connect: '.connect',
    reportbar: '.report-bar',
    tabs: '.tab-list',
    hide: '.main-tabs .switch',
    content: '.culprits-hero',
  },
});

await shoot('dashboard-session', {
  clip: '.session',
  prepare: async () => {
    await page.evaluate(url => {
      const input = document.querySelector('.connect input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, url);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, APP);
    await clickText('.connect button', 'Advanced');
    await sleep(300);
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('label')].find(l => /Headless/.test(l.textContent));
      const box = label.querySelector('input');
      if (!box.checked) box.click();
    });
    await clickText('.connect button', 'Launch Chrome');
    await page.waitForSelector('.rec-strip', { timeout: 30_000 });
    await sleep(2500);
  },
  regions: {
    tab: '.session-row select',
    address: '.session-row input.address',
    nav: [{ sel: '.session-row button', text: '^Go$' }, { sel: '.session-row button', text: '^Reload$' }],
    pill: '.session-row .pill',
    close: { sel: '.session-row button', text: 'Close Chrome' },
    interaction: { sel: '.rec-strip button', text: 'Record interaction' },
    pageload: { sel: '.rec-strip button', text: 'Record page load' },
    options: '.rec-strip .popover',
  },
});
await clickText('button', '^Close Chrome$');
await sleep(1500);

await shoot('culprits-top', {
  viewport: 1300,
  clip: '.culprits-hero',
  regions: { sphere: '.hero-sphere', insight: '.insight', rank: '.rank-list' },
});

await shoot('culprits-vitals', {
  viewport: 2600,
  clip: ['.vitals-block', '.breakdown'],
  regions: { hero: '.vitals-hero', chips: '.vitals-secondary', breakdown: '.breakdown' },
});

await shoot('culprits-functions', {
  viewport: 3600,
  clip: ['.hot-functions thead', { sel: '.hot-functions tbody tr', nth: 6 }],
  regions: {
    own: { sel: '.hot-functions tbody tr', nth: 0 },
    editor: { sel: '.hot-functions .editor-link', nth: 0 },
    vendor: { sel: '.hot-functions tr.vendor-row', nth: 0 },
  },
});

await shoot('culprits-findings', {
  viewport: 3600,
  pad: 6,
  clip: ['.findings-toolbar', { sel: '.frows > li', nth: 2 }],
  regions: {
    filters: '.findings-toolbar .segmented',
    category: '.findings-toolbar select',
    expand: { sel: '.findings-toolbar button.ghost', all: true },
    group: { sel: '.frow.open .frow-head', nth: 0 },
    fix: { sel: '.frow.open .fix-callout', nth: 0 },
    culprits: { sel: '.frow.open .culprit-table', nth: 0 },
    members: { sel: '.frow.open .members', nth: 0 },
    next: { sel: '.frows > li', nth: 1 },
  },
});

await openTab('Page map');
await shoot('tab-page-map', {
  viewport: 1400,
  pad: 0,
  clip: '.page-map',
  regions: { frame: '.page-frame', marker: '.marker', list: '.page-list' },
});

await openTab('File tree');
await shoot('tab-file-tree', {
  viewport: 720,
  pad: 0,
  clip: '.tree-pane',
  regions: { toolbar: '.tree-toolbar', tree: '.tree-pane svg', legend: '.tree-pane .legend' },
});

await openTab('Call tree');
await shoot('tab-call-tree', {
  viewport: 720,
  pad: 0,
  clip: '.tree-pane',
  regions: { toolbar: '.tree-toolbar', tree: '.tree-pane svg' },
});

await openTab('Components');
await shoot('tab-components', {
  viewport: 1300,
  pad: 0,
  clip: '.react-panel',
  prepare: () => clickText('.react-panel td button.link', 'Wasted$'),
  regions: {
    summary: '.react-panel .summary-row',
    columns: '.react-panel table.data thead',
    row: '.react-panel tr.open',
    why: '.react-panel tr.detail',
  },
});

await openTab('Long tasks');
await shoot('tab-long-tasks', {
  viewport: 1600,
  pad: 0,
  clip: '.long-tasks',
  maxHeight: 760,
  regions: {
    timeline: '.long-tasks svg.timeline',
    head: { sel: '.task-list .task-head', nth: 0 },
    breakdown: { sel: '.task-list .breakdown-bar', nth: 0 },
    cols: { sel: '.task-list .task-cols', nth: 0 },
  },
});

// the network tab is most telling for a page load
await pickReport(BEFORE[0]);
await openTab('Network & memory');
await shoot('tab-network', {
  viewport: 1900,
  pad: 0,
  clip: '.network',
  maxHeight: 760,
  regions: { summary: '.network .summary-row', requests: { sel: '.network table.data', nth: 0 } },
});
await pickReport(LIVE);

await openTab('Golden paths');
await shoot('tab-golden-paths', {
  viewport: 900,
  pad: 0,
  clip: '.eval-panel',
  regions: { head: '.eval-head', target: '.eval-target', matrix: '.eval-matrix' },
});

// compare: fill both sides from the saved reports
await openTab('Compare commits');
await page.setViewport({ width: WIDTH, height: 4200, deviceScaleFactor: SCALE });
await sleep(500);
for (const [label, ids] of [['Before', BEFORE], ['After', AFTER]])
  for (const id of ids) {
    await page.select(`select[aria-label="Add a saved report to ${label}"]`, id);
    await sleep(600);
  }
await sleep(1500);

await shoot('compare-side', {
  viewport: 4200,
  clip: { sel: '.side-picker', nth: 0 },
  regions: {
    hash: { sel: '.side-picker label.field', nth: 0 },
    facts: '.side-picker .git-facts',
    upload: '.side-picker .dropzone',
    saved: { sel: 'select[aria-label^="Add a saved report"]' },
    runs: '.side-picker .run-chips',
  },
});

await shoot('compare-verdict', {
  viewport: 4200,
  clip: ['.compare-toolbar', '.compare-results ul.checks'],
  regions: {
    commits: '.commit-pair',
    pdf: '.pdf-buttons',
    verdict: '.verdict-banner',
    highlights: '.compare-results ul.icons',
    checks: '.compare-results ul.checks',
  },
});

await shoot('compare-metrics', {
  viewport: 4200,
  clip: ['.compare-results .segmented', '.compare-table'],
  maxHeight: 640,
  regions: { filter: '.compare-results .segmented', table: '.compare-table' },
});

await shoot('compare-details', {
  viewport: 4200,
  pad: 2,
  clip: [{ sel: '.compare-results div.tabs', nth: 0 }, '.detail-pane'],
  regions: { tabs: { sel: '.compare-results div.tabs', nth: 0 }, pane: '.detail-pane' },
});

// appearance: the menu, then the four looks side by side
await load();
await pickReport(LIVE);
await shoot('appearance-menu', {
  viewport: 760,
  clip: ['.topbar', '[role=dialog]'],
  prepare: async () => {
    await clickText('.topbar .popover button', 'Appearance');
  },
  regions: {
    button: '.topbar .popover button',
    theme: { sel: '.appearance fieldset', nth: 0 },
    mode: { sel: '.appearance fieldset', nth: 1 },
  },
});

const looks = [];
for (const [style, mode] of [['glass', 'dark'], ['glass', 'light'], ['space', 'dark'], ['space', 'light']]) {
  await page.setViewport({ width: 1120, height: 700, deviceScaleFactor: 1 });
  await load(style, mode);
  await pickReport(LIVE);
  const data = await page.screenshot({ type: 'png', encoding: 'base64' });
  looks.push({ id: `${style}-${mode}`, data });
}
await page.setContent(
  `<body style="margin:0;background:transparent">
     <div id="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;width:${WIDTH}px">
       ${looks.map(l => `<img id="${l.id}" src="data:image/png;base64,${l.data}" style="width:100%;display:block;border-radius:10px">`).join('')}
     </div>
   </body>`,
);
await page.setViewport({ width: WIDTH, height: 760, deviceScaleFactor: SCALE });
await sleep(500);
await shoot('appearance-looks', {
  viewport: 760,
  clip: '#grid',
  pad: 0,
  regions: Object.fromEntries(looks.map(l => [l.id, `#${l.id}`])),
});

fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nWrote ${Object.keys(manifest).length} screenshots and manifest.json to ${OUT}`);
await browser.close();
