/**
 * The Spectra backend API, framework-agnostic so it can be mounted by either
 * the Vite dev plugin (server/plugin.js) or the standalone dashboard server
 * (server/dashboard.js). `handle(req, res, next)` is Connect-style and expects
 * `req.url` to be relative to the API root (the `/api` prefix already removed).
 *
 *   GET  /status            connection, tabs, recording state, probe info
 *   POST /connect           {mode:'launch'|'attach', url?, browserURL?, headless?}
 *   POST /disconnect        POST /select-page {id}
 *   POST /navigate {url}    POST /reload
 *   POST /record/start      {mode, cpuThrottle?, saveTrace?, settleMs?}
 *   POST /record/stop
 *   GET  /reports           GET/DELETE /reports/:id
 *   POST /reports/:id/trace write the raw trace (GET downloads it)
 *   GET  /reports/:id/page.jpg  screenshot behind the report's page map
 *   GET  /evaluations       GET /evaluations/:id   golden-path aggregates
 *   GET  /source?path=      a source file (read-only, inside known roots)
 *   GET  /git/commit?rev=   author/subject/date of HEAD or a commit hash
 *   POST /compare/pdf       {comparison, kind} -> application/pdf
 *   GET  /events            Server-Sent Events: state + new reports
 */
import fs from 'node:fs';
import path from 'node:path';
import { COMPARE_VERSION } from '../shared/compare.js';
import {
  DEFAULT_TARGET_URL,
  FRONTEND_ROOT,
  REPORTS_DIR,
  SOURCE_ROOTS,
  TARGET_NAME,
} from './config.js';
import { gitInfo, isValidRev } from './git.js';
import { pdfFileName, renderComparisonPdf } from './pdf/render.js';
import {
  PerfSession,
  deleteReport,
  listReports,
  pageImageFile,
  readReport,
} from './recorder.js';

const MAX_SOURCE_BYTES = 1024 * 1024;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function readSource(rel) {
  if (
    !rel ||
    rel.includes('\0') ||
    path.isAbsolute(rel) ||
    rel.split(/[\\/]/).includes('..')
  )
    return null;
  for (const root of SOURCE_ROOTS) {
    const abs = path.join(root, rel);
    let real;
    try {
      real = fs.realpathSync(abs);
    } catch {
      continue;
    }
    if (
      !real.startsWith(fs.realpathSync(root) + path.sep) ||
      !fs.statSync(real).isFile()
    )
      continue;
    const size = fs.statSync(real).size;
    const fd = fs.openSync(real, 'r');
    try {
      const buf = Buffer.alloc(Math.min(size, MAX_SOURCE_BYTES));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return {
        path: rel,
        root,
        absolutePath: real,
        size,
        truncated: size > MAX_SOURCE_BYTES,
        content: buf.toString('utf8'),
      };
    } finally {
      fs.closeSync(fd);
    }
  }
  return null;
}

/** List saved golden-path evaluation aggregates (newest first). */
function listEvaluations() {
  let files = [];
  try {
    files = fs.readdirSync(REPORTS_DIR);
  } catch {
    return [];
  }
  return files
    .filter(f => f.startsWith('evaluation-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8'),
        );
        return {
          id: data.id,
          createdAt: data.createdAt,
          target: data.target,
          url: data.url,
          pathCount: Array.isArray(data.paths) ? data.paths.length : 0,
          passed: Array.isArray(data.paths)
            ? data.paths.filter(p => p.ok).length
            : 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readEvaluation(id) {
  if (!/^evaluation-[\w-]+$/.test(id)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(REPORTS_DIR, `${id}.json`), 'utf8'),
    );
  } catch {
    return null;
  }
}

/** Routes that act on the session and then answer with its fresh status. */
const ACTIONS = {
  'POST /connect': (session, body) => session.connect(body),
  'POST /disconnect': session => session.disconnect(),
  'POST /select-page': (session, body) => session.selectPage(body.id),
  'POST /navigate': (session, body) => session.navigate(body.url, body.signIn),
  'POST /reload': session => session.reload(),
  'POST /record/start': (session, body) => session.start(body),
};

/**
 * Build a Spectra API instance: its own PerfSession, an SSE client set, a
 * Connect-style `handle`, and a `dispose` for shutdown.
 */
export function createApi() {
  const session = new PerfSession();
  const clients = new Set();
  const broadcast = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };
  session.on('state', s => broadcast('state', s));
  session.on('report', r => broadcast('report', r));

  async function handle(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'GET /status')
        return send(res, 200, {
          ...(await session.status()),
          defaultUrl: DEFAULT_TARGET_URL,
          defaultName: TARGET_NAME,
        });
      if (route === 'POST /record/stop') {
        const report = await session.stop();
        return send(res, 200, { id: report.id });
      }
      if (route in ACTIONS) {
        await ACTIONS[route](session, await readBody(req));
        return send(res, 200, await session.status());
      }
      if (route === 'GET /reports') return send(res, 200, listReports());
      if (route === 'GET /evaluations')
        return send(res, 200, listEvaluations());
      const evalRoute = /^\/evaluations\/(evaluation-[\w-]+)$/.exec(url.pathname);
      if (evalRoute) {
        const data = readEvaluation(evalRoute[1]);
        return data
          ? send(res, 200, data)
          : send(res, 404, { error: 'No such evaluation' });
      }
      const traceRoute = /^\/reports\/([\w-]+)\/trace$/.exec(url.pathname);
      if (traceRoute) {
        const [, id] = traceRoute;
        const { path: file, size } = session.writeTrace(id);
        if (req.method === 'POST')
          return send(res, 200, { ok: true, path: file, size });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': size,
          'Content-Disposition': `attachment; filename="${id}.trace.json"`,
        });
        return fs.createReadStream(file).pipe(res);
      }
      const pageRoute = /^\/reports\/([\w-]+)\/page\.jpg$/.exec(url.pathname);
      if (pageRoute) {
        const file = pageImageFile(pageRoute[1]);
        if (!fs.existsSync(file))
          return send(res, 404, { error: 'No page image for this report' });
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': fs.statSync(file).size,
        });
        return fs.createReadStream(file).pipe(res);
      }
      if (url.pathname.startsWith('/reports/')) {
        const id = decodeURIComponent(url.pathname.slice('/reports/'.length));
        if (req.method === 'DELETE')
          return send(res, 200, (deleteReport(id), { ok: true }));
        const report = readReport(id);
        return report
          ? send(res, 200, report)
          : send(res, 404, { error: 'No such report' });
      }
      if (route === 'GET /git/commit') {
        const rev = url.searchParams.get('rev') || 'HEAD';
        const info = isValidRev(rev) ? gitInfo(FRONTEND_ROOT, rev) : null;
        return info
          ? send(res, 200, info)
          : send(res, 404, {
              error: `No commit “${rev}” in this repository (use a commit hash).`,
            });
      }
      if (route === 'POST /compare/pdf') {
        const { comparison, kind } = await readBody(req);
        if (
          comparison?.version !== COMPARE_VERSION ||
          !Array.isArray(comparison.metrics)
        ) {
          return send(res, 400, {
            error: 'Not a comparison produced by this tool.',
          });
        }
        const type = kind === 'detailed' ? 'detailed' : 'summary';
        const pdf = await renderComparisonPdf(comparison, type);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': pdf.length,
          'Content-Disposition': `attachment; filename="${pdfFileName(comparison, type)}"`,
          'Cache-Control': 'no-store',
        });
        return res.end(pdf);
      }
      if (route === 'GET /source') {
        const file = readSource(url.searchParams.get('path'));
        return file
          ? send(res, 200, file)
          : send(res, 404, {
              error: 'Source file not found in the known roots',
            });
      }
      if (route === 'GET /events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        res.write(`event: hello\ndata: {}\n\n`);
        clients.add(res);
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
        req.on('close', () => {
          clearInterval(heartbeat);
          clients.delete(res);
        });
        return undefined;
      }
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
    return next ? next() : send(res, 404, { error: 'Not found' });
  }

  async function dispose() {
    await session.disconnect().catch(() => {});
  }

  return { session, handle, dispose };
}
