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
import { FRONTEND_ROOT, REPORTS_DIR, SOURCE_ROOTS, FRAMEWORK } from './config.js';
import { SourceIndex } from './analysis/locate.js';
import { gitInfo } from './git.js';
import { REPORT_SCHEMA_VERSION } from '../shared/result.js';
import { buildSignInUrl, hasLoginForm, looksSignedOut, normalizeSignIn, parsePairs, signInWithForm, waitForManualSignIn } from './signin.js';

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
    // the sign-in for this browser: kept in memory only, never saved or reported
    this.signIn = null;
    this.signedIn = false;
    this.prepared = '';
    this.addHeader = null;
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
    this.signIn = normalizeSignIn(signIn);
    this.signedIn = false;
    this.headless = mode !== 'attach' && headless;
    if (this.signIn?.method === 'manual' && this.headless)
      throw new Error('Signing in yourself needs a visible Chrome window: turn off Headless (or run with --headed).');
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
    this.setState('connecting');
    try {
      if (url) await this.navigate(url, signIn);
    } finally {
      // connected even when signing in failed: the page stays open to look at and retry
      this.setState('idle');
    }
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
    this.prepared = '';
    this.addHeader = null;
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
    // Inject a small runtime hint so the in-page probe can adapt to the detected
    // framework/bundler (react/vue/svelte/next) before the probe runs.
    try {
      await this.inject(`window.__SPECTRA_FRAMEWORK__ = ${JSON.stringify(
        FRAMEWORK,
      )};`);
    } catch (e) {
      // ignore injection errors
    }
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
   * Opens `url`, signed in. Chrome starts signed out, so with a sign-in (given
   * here, or kept from connect) it first sets up a browser login prompt, token,
   * cookies or storage entries, then loads the page; if the page still asks for
   * a login, or a login page was given, it signs in (form or link) or waits for
   * you to (manual), and lands on `url` afterwards. Once per browser.
   */
  async navigate(url, signIn) {
    this.requirePage();
    const given = normalizeSignIn(signIn);
    // new details (the dashboard's form changed): sign in again with them
    if (given && JSON.stringify(given) !== JSON.stringify(this.signIn)) {
      this.signIn = given;
      this.signedIn = false;
    }
    const s = this.signIn;
    const go = target =>
      this.page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
    if (s) await this.prepareSignIn(s, url);
    this.navigation = null;
    await go(url);
    if (!s) return;

    const signedOut = async () =>
      looksSignedOut(this.navigation, this.page.url()) || (await hasLoginForm(this.page));
    if (this.signedIn) {
      // a session can expire (or a journey sign out): sent back to the login page, sign in again
      if (!looksSignedOut(this.navigation, this.page.url())) return;
      this.signedIn = false;
    }
    if (s.method === 'link') {
      if (await signedOut()) {
        this.navigation = null;
        await go(buildSignInUrl(s.url, url));
      }
      return;
    }
    if (s.method === 'http' || s.method === 'token') {
      if (await signedOut())
        throw new Error(`The page still asks for a login after signing in with ${s.method === 'http' ? 'the browser login prompt' : 'the token, cookies or storage entries'}. Check the values.`);
      this.signedIn = true;
      return;
    }
    // form or manual: when the page asks for it, or straight away when a login page was given
    if (!s.url && !(await signedOut())) {
      this.signedIn = true;
      return;
    }
    const loginUrl = s.url ? buildSignInUrl(s.url, url) : '';
    const was = this.state;
    this.setState('signing-in', { method: s.method }); // the dashboard says what is going on
    try {
      if (s.method === 'manual') {
        if (loginUrl) await go(loginUrl);
        await waitForManualSignIn(this.page, { loginUrl, timeoutMs: s.waitMs });
      } else {
        try {
          await signInWithForm(this.page, { ...s, url: loginUrl });
        } catch (err) {
          // a login page that shows no form, on an app that is not asking for one: already signed in
          if (!(loginUrl && /No login form was found/.test(err.message) && !(await signedOut()))) throw err;
        }
      }
    } finally {
      this.setState(was);
    }
    this.signedIn = true;
    // back to the page to profile, unless the login brought us there
    const same = (a, b) => {
      try {
        const x = new URL(a);
        const y = new URL(b);
        return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
      } catch {
        return a === b;
      }
    };
    if (!same(this.page.url(), url)) {
      this.navigation = null;
      await go(url);
    }
    if (await signedOut())
      throw new Error(`Signed in, but ${new URL(url).pathname} still shows a login. Check the login page URL and the details.`);
  }

  /**
   * What must be in place before the first request: the answer to the
   * browser's login prompt, or the token's cookies, storage entries and header.
   * Cookies and storage are scoped to the page's origin, and the header is
   * added only to requests to that origin, so it never reaches third parties.
   */
  async prepareSignIn(s, url) {
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      return;
    }
    const key = `${origin}|${JSON.stringify(s)}`;
    if (this.prepared === key) return;
    if (s.method === 'http') await this.page.authenticate({ username: s.username, password: s.password });
    if (s.method === 'token') {
      const cookies = parsePairs(s.cookies);
      if (cookies.length) await this.page.setCookie(...cookies.map(([name, value]) => ({ name, value, url: origin })));
      const storage = parsePairs(s.storage);
      if (storage.length)
        await this.inject(
          `(() => { if (location.origin !== ${JSON.stringify(origin)}) return; try { ${storage
            .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
            .join(' ')} } catch (e) {} })();`,
          { now: false },
        );
    }
    // one header handler at a time: drop the last one (another origin or other details)
    const client = this.client;
    if (this.addHeader) {
      client.off('Fetch.requestPaused', this.addHeader);
      this.addHeader = null;
      await client.send('Fetch.disable').catch(() => {});
    }
    if (s.method === 'token' && s.headerName && s.headerValue) {
      const name = s.headerName;
      const value = s.headerValue;
      this.addHeader = e => {
        const headers = Object.entries(e.request.headers)
          .filter(([n]) => n.toLowerCase() !== name.toLowerCase())
          .map(([n, v]) => ({ name: n, value: v }));
        headers.push({ name, value });
        client.send('Fetch.continueRequest', { requestId: e.requestId, headers }).catch(() => {});
      };
      client.on('Fetch.requestPaused', this.addHeader);
      await client.send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/*`, requestStage: 'Request' }] });
    }
    this.prepared = key;
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
      // how this browser signs in, without any of the details
      signIn: this.signIn && { method: this.signIn.method, signedIn: this.signedIn },
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
    this.tracingActive = true;
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
    // A stop() that throws before Tracing.end leaves CDP tracing active, which
    // would make the next start() fail with "Tracing has already been started".
    // Tear it down so one bad recording can't poison the whole session.
    if (this.tracingActive && this.client) {
      this.tracingActive = false;
      this.client.send('Tracing.end').catch(() => {});
    }
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
      this.tracingActive = false;
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
      const built = await buildReport({
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
      // versioned so editors, CI and agents can tell which format they read
      const report = { schemaVersion: REPORT_SCHEMA_VERSION, ...built };
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
   * What the page looks like right now plus where each component sits on it
   * (React, Vue or Angular), so the report can point from a slow component to
   * its place on screen. The screenshot is taken for every page, with or
   * without components to pin. Best effort: a failure means no page map.
   */
  async capturePageView() {
    try {
      const { result } = await this.client.send('Runtime.evaluate', {
        expression:
          'window.__PERF_PROBE__ && __PERF_PROBE__.layout ? __PERF_PROBE__.layout() : ' +
          '{ width: innerWidth, height: innerHeight, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY), entries: [] }',
        returnByValue: true,
      });
      const layout = result.value;
      if (!layout?.width || !layout?.height) return null;
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

  /** Function -> source location for each React component seen, via [[FunctionLocation]] (Vue and Angular carry their own). */
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
