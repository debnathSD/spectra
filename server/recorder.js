/**
 * Drives Chrome through the DevTools Protocol:
 *
 *   Tracing            main-thread timeline + V8 CPU samples (one clock)
 *   Debugger           script registry (ids -> urls, source maps, sources)
 *   Runtime            the in-page probe, function locations of components
 *   Performance/Memory heap, DOM nodes, listeners, layout counts
 *   Emulation          CPU throttling
 *   Page               injection before load, reload
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport } from './analysis/report.js';
import { SourceResolver } from './analysis/sources.js';
import { attachChrome, launchChrome } from './chrome.js';
import { FRONTEND_ROOT, REPORTS_DIR, SOURCE_ROOTS } from './config.js';
import { SourceIndex } from './analysis/locate.js';
import { gitInfo } from './git.js';
import { buildSignInUrl, looksSignedOut } from './signin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROBE_SOURCE = fs.readFileSync(
  path.join(here, 'probe.browser.js'),
  'utf8',
);

const TRACE_CATEGORIES = [
  '-*',
  'devtools.timeline',
  'v8.execute',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler',
  'toplevel',
  'blink.user_timing',
  'latencyInfo',
].join(',');

const MAX_RECORDING_MS = 120_000;

async function readStream(client, handle) {
  const chunks = [];
  for (;;) {
    const { data, base64Encoded, eof } = await client.send('IO.read', {
      handle,
      size: 1 << 20,
    });
    chunks.push(
      base64Encoded ? Buffer.from(data, 'base64').toString('utf8') : data,
    );
    if (eof) break;
  }
  await client.send('IO.close', { handle });
  return chunks.join('');
}

export class PerfSession extends EventEmitter {
  constructor() {
    super();
    this.browser = null;
    this.launched = false;
    this.page = null;
    this.client = null;
    this.scripts = new Map();
    this.pageIds = new WeakMap();
    this.nextPageId = 1;
    this.injected = [];
    this.state = 'disconnected';
    this.recording = null;
    this.lastError = '';
    this.lastTrace = null;
  }

  setState(state, extra = {}) {
    this.state = state;
    this.emit('state', { state, ...extra });
  }

  // ------------------------------------------------------------- connection

  async connect({
    mode = 'launch',
    url,
    browserURL,
    headless = false,
    signIn,
  }) {
    if (this.browser) await this.disconnect();
    this.browser =
      mode === 'attach'
        ? await attachChrome(browserURL || 'http://127.0.0.1:9222')
        : await launchChrome({ headless });
    this.launched = mode !== 'attach';
    this.browser.on('disconnected', () => {
      this.browser = null;
      this.page = null;
      this.client = null;
      this.recording = null;
      this.setState('disconnected');
    });
    const pages = await this.browser.pages();
    const page =
      pages.find(p => !/^devtools:|^chrome:/.test(p.url())) ||
      pages[0] ||
      (await this.browser.newPage());
    await this.attachPage(page);
    if (url) await this.navigate(url, signIn);
    this.setState('idle');
  }

  async disconnect() {
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    this.client = null;
    if (browser) {
      if (this.launched) await browser.close().catch(() => {});
      else await browser.disconnect();
    }
    this.setState('disconnected');
  }

  async listPages() {
    if (!this.browser) return [];
    const pages = await this.browser.pages();
    return Promise.all(
      pages
        .filter(p => !/^devtools:/.test(p.url()))
        .map(async p => {
          if (!this.pageIds.has(p)) this.pageIds.set(p, this.nextPageId++);
          return {
            id: this.pageIds.get(p),
            url: p.url(),
            title: await p.title().catch(() => ''),
            selected: p === this.page,
          };
        }),
    );
  }

  async selectPage(id) {
    const pages = await this.browser.pages();
    const page = pages.find(p => this.pageIds.get(p) === id);
    if (!page) throw new Error('That tab no longer exists.');
    await this.attachPage(page);
  }

  async attachPage(page) {
    if (this.client) await this.client.detach().catch(() => {});
    this.page = page;
    this.scripts.clear();
    this.injected = [];
    const client = await page.createCDPSession();
    this.client = client;
    client.on('Debugger.scriptParsed', e =>
      this.scripts.set(e.scriptId, {
        url: e.url,
        sourceMapURL: e.sourceMapURL,
      }),
    );
    client.on('Debugger.globalObjectCleared', () => this.scripts.clear());
    await client.send('Debugger.enable');
    await client.send('Page.enable');
    await client.send('Performance.enable');
    await this.inject(PROBE_SOURCE);
    this.navigation = null;
    page.on('response', res => {
      // Redirects (3xx) are intermediate; the final document decides if the page loaded.
      const status = res.status();
      if (
        res.request().isNavigationRequest() &&
        res.frame() === page.mainFrame() &&
        (status < 300 || status >= 400)
      ) {
        this.navigation = { url: res.url(), status };
      }
    });
    page.on('close', () => {
      if (this.page === page) {
        this.page = null;
        this.client = null;
        this.emit('state', { state: this.state });
      }
    });
  }

  /** Runs `source` before any script of every future document, and in the current one. */
  async inject(source, { now = true } = {}) {
    const { identifier } = await this.client.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source },
    );
    this.injected.push(identifier);
    if (now)
      await this.client
        .send('Runtime.evaluate', { expression: source })
        .catch(() => {});
    return identifier;
  }

  requirePage() {
    if (!this.client)
      throw new Error('No tab is connected. Connect to Chrome first.');
  }

  /**
   * Opens `url`. If that fails or lands on a login screen (the browser profile
   * starts signed out) and a sign-in URL template is given, signs in through it
   * and lands on `url` afterwards.
   */
  async navigate(url, signIn) {
    this.requirePage();
    const go = target =>
      this.page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
    this.navigation = null;
    await go(url);
    const signInUrl = buildSignInUrl(signIn, url);
    if (signInUrl && looksSignedOut(this.navigation, this.page.url())) {
      this.navigation = null;
      await go(signInUrl);
    }
  }

  async reload() {
    this.requirePage();
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  async probeInfo() {
    if (!this.client || this.state !== 'idle') return null;
    try {
      const { result } = await this.client.send('Runtime.evaluate', {
        expression: 'window.__PERF_PROBE__ ? __PERF_PROBE__.info() : null',
        returnByValue: true,
      });
      return result.value || null;
    } catch {
      return null;
    }
  }

  async status() {
    return {
      state: this.state,
      connected: Boolean(this.browser),
      launched: this.launched,
      pageUrl: this.page?.url() || '',
      pages: await this.listPages(),
      probe: await this.probeInfo(),
      navigation: this.navigation,
      recording: this.recording && {
        mode: this.recording.mode,
        startedAt: this.recording.startedAt,
        cpuThrottle: this.recording.cpuThrottle,
      },
      error: this.lastError,
    };
  }

  // -------------------------------------------------------------- recording

  async metrics() {
    const { metrics } = await this.client.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map(m => [m.name, m.value]));
  }

  async start({
    mode = 'live',
    cpuThrottle = 1,
    settleMs = 3000,
    saveTrace = false,
    ignoreCache = true,
  } = {}) {
    this.requirePage();
    if (this.state !== 'idle')
      throw new Error(`Cannot start while ${this.state}.`);
    this.lastError = '';
    const client = this.client;
    const rec = {
      mode,
      cpuThrottle,
      saveTrace,
      settleMs,
      startedAt: Date.now(),
      autostartId: null,
      timer: null,
      loaded: null,
    };
    this.recording = rec;

    if (cpuThrottle > 1)
      await client.send('Emulation.setCPUThrottlingRate', {
        rate: cpuThrottle,
      });
    if (mode === 'load') {
      // Registered after the probe script, so it runs after it on every new document.
      rec.autostartId = await this.inject(
        'window.__PERF_PROBE__ && window.__PERF_PROBE__.start();',
        { now: false },
      );
    } else {
      const info = await this.probeInfo();
      if (!info) await this.inject(PROBE_SOURCE);
      await client.send('Runtime.evaluate', {
        expression: '__PERF_PROBE__.start()',
      });
    }
    rec.metricsBefore = await this.metrics();
    await client.send('Tracing.start', {
      categories: TRACE_CATEGORIES,
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
    });
    rec.startedAt = Date.now();
    this.setState('recording', { mode });

    rec.timer = setTimeout(
      () => this.stop().catch(err => this.fail(err)),
      MAX_RECORDING_MS,
    ); // hard cap: traces grow fast
    if (mode === 'load') {
      rec.loaded = new Promise(resolve =>
        client.once('Page.loadEventFired', resolve),
      );
      await client.send('Page.reload', { ignoreCache });
      rec.loaded.then(() => {
        if (this.state !== 'recording') return;
        clearTimeout(rec.timer);
        rec.timer = setTimeout(
          () => this.stop().catch(err => this.fail(err)),
          settleMs,
        ); // let post-load work (data fetches, renders) finish
      });
    }
  }

  fail(err) {
    this.lastError = err.message;
    this.recording = null;
    this.setState(this.browser ? 'idle' : 'disconnected', {
      error: err.message,
    });
  }

  async stop() {
    const rec = this.recording;
    if (!rec || this.state !== 'recording') throw new Error('Not recording.');
    clearTimeout(rec.timer);
    const client = this.client;
    const page = this.page;
    this.setState('analyzing');
    try {
      const durationMs = Date.now() - rec.startedAt;
      const { result: snap } = await client.send('Runtime.evaluate', {
        expression:
          'window.__PERF_PROBE__ ? (__PERF_PROBE__.stop(), __PERF_PROBE__.snapshot()) : null',
        returnByValue: true,
      });
      const probe = snap.value || null;
      const metricsAfter = await this.metrics();
      const dom = await client.send('Memory.getDOMCounters').catch(() => null);

      const complete = new Promise(resolve =>
        client.once('Tracing.tracingComplete', resolve),
      );
      await client.send('Tracing.end');
      const { stream } = await complete;
      const traceText = await readStream(client, stream);
      const parsed = JSON.parse(traceText);
      const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;

      if (rec.cpuThrottle > 1)
        await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      if (rec.autostartId) {
        await client
          .send('Page.removeScriptToEvaluateOnNewDocument', {
            identifier: rec.autostartId,
          })
          .catch(() => {});
      }

      const pageView = await this.capturePageView();
      const locations = await this.componentLocations(probe);
      const resolver = new SourceResolver({
        root: FRONTEND_ROOT,
        scripts: this.scripts,
        getSource: async scriptId =>
          (await client.send('Debugger.getScriptSource', { scriptId }))
            .scriptSource,
      });
      const id =
        new Date(rec.startedAt)
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\..+/, '') + `-${rec.mode}`;
      const report = await buildReport({
        events,
        probe,
        metrics: { before: rec.metricsBefore, after: metricsAfter, dom },
        locations,
        resolver,
        sourceIndex: new SourceIndex(SOURCE_ROOTS),
        meta: {
          id,
          createdAt: new Date(rec.startedAt).toISOString(),
          url: page.url(),
          title: await page.title().catch(() => ''),
          mode: rec.mode,
          durationMs,
          cpuThrottle: rec.cpuThrottle,
          userAgent: await this.browser.userAgent(),
          git: gitInfo(FRONTEND_ROOT),
          navStatus: this.navigation?.status ?? null,
          navUrl: this.navigation?.url ?? '',
        },
      });
      this.lastTrace = { id: report.id, text: traceText };
      report.pageView = pageView
        ? { ...pageView.layout, hasImage: true }
        : null;
      this.saveReport(
        report,
        rec.saveTrace ? traceText : null,
        pageView?.image,
      );
      this.recording = null;
      this.setState('idle', { reportId: report.id });
      this.emit('report', { id: report.id });
      return report;
    } catch (err) {
      this.fail(err);
      throw err;
    }
  }

  /**
   * What the page looks like right now plus where each React component sits on
   * it, so the report can point from a slow component to its place on screen.
   * Best effort: any failure just means the report has no page map.
   */
  async capturePageView() {
    try {
      const { result } = await this.client.send('Runtime.evaluate', {
        expression:
          'window.__PERF_PROBE__ && __PERF_PROBE__.layout ? __PERF_PROBE__.layout() : null',
        returnByValue: true,
      });
      const layout = result.value;
      if (!layout?.entries?.length) return null;
      const shot = await this.client.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 72,
        clip: {
          x: 0,
          y: 0,
          width: layout.width,
          height: layout.height,
          scale: 1,
        },
      });
      return { layout, image: Buffer.from(shot.data, 'base64') };
    } catch {
      return null;
    }
  }

  /** Function -> source location for each React component seen, via [[FunctionLocation]]. */
  async componentLocations(probe) {
    const out = new Map();
    if (!probe?.components?.length) return out;
    const wanted = new Set(
      probe.components.filter(c => !c.source).map(c => c.id),
    );
    if (!wanted.size) return out;
    try {
      const list = await this.client.send('Runtime.evaluate', {
        expression: '__PERF_PROBE__.typeFns',
        returnByValue: false,
      });
      const props = await this.client.send('Runtime.getProperties', {
        objectId: list.result.objectId,
        ownProperties: true,
      });
      const fns = props.result.filter(
        p =>
          /^\d+$/.test(p.name) &&
          wanted.has(Number(p.name)) &&
          p.value?.objectId,
      );
      for (let i = 0; i < fns.length; i += 40) {
        await Promise.all(
          fns.slice(i, i + 40).map(async p => {
            const r = await this.client.send('Runtime.getProperties', {
              objectId: p.value.objectId,
              ownProperties: false,
            });
            const loc = r.internalProperties?.find(
              x => x.name === '[[FunctionLocation]]',
            )?.value?.value;
            if (loc) out.set(Number(p.name), loc);
          }),
        );
      }
    } catch {
      /* page navigated away: locations are optional */
    }
    return out;
  }

  saveReport(report, trace, pageImage) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORTS_DIR, `${report.id}.json`),
      JSON.stringify(report),
    );
    if (trace) fs.writeFileSync(traceFile(report.id), trace);
    if (pageImage) fs.writeFileSync(pageImageFile(report.id), pageImage);
  }

  /**
   * Makes sure reports/<id>.trace.json exists so it can be loaded into Chrome
   * DevTools. The latest recording's trace is kept in memory for this; older
   * ones exist only if "save raw trace" was ticked.
   */
  writeTrace(id) {
    const file = traceFile(id);
    if (!fs.existsSync(file)) {
      if (this.lastTrace?.id !== id) {
        throw new Error(
          'The raw trace of this recording was not kept. Only the most recent recording’s trace is held in memory (until you record again or stop the profiler); older ones need “save raw trace” ticked before recording.',
        );
      }
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
      fs.writeFileSync(file, this.lastTrace.text);
    }
    return { path: file, size: fs.statSync(file).size };
  }
}

export function traceFile(id) {
  return path.join(REPORTS_DIR, `${id}.trace.json`);
}

export function pageImageFile(id) {
  return path.join(REPORTS_DIR, `${id}.page.jpg`);
}

export function listReports() {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs
    .readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.json') && !f.endsWith('.trace.json'))
    .map(f => {
      try {
        const r = JSON.parse(
          fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8'),
        );
        return {
          id: r.id,
          createdAt: r.createdAt,
          url: r.meta.url,
          mode: r.meta.mode,
          durationMs: r.meta.durationMs,
          hasTrace: fs.existsSync(traceFile(r.id)),
          findings: r.findings.length,
          critical: r.findings.filter(x => x.severity === 'critical').length,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function readReport(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  const file = path.join(REPORTS_DIR, `${id}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

export function deleteReport(id) {
  if (!/^[\w-]+$/.test(id)) return;
  for (const suffix of ['.json', '.trace.json', '.page.jpg'])
    fs.rmSync(path.join(REPORTS_DIR, `${id}${suffix}`), { force: true });
}
