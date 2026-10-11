/**
 * Standalone dashboard server for installed Spectra: serves the prebuilt UI
 * (dist/) and mounts the same backend API as the Vite dev plugin, so an npm
 * consumer gets the full dashboard — culprits, PDF export, commit compare,
 * live recording — with no dev toolchain.
 *
 * Run directly (node server/dashboard.js [--port N] [--open]) or import
 * startDashboard().
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi } from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, '..');
const DIST = process.env.SPECTRA_DASHBOARD_DIST || path.join(PKG_ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function serveStatic(res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const safe = path.normalize(rel);
  if (safe.startsWith('..') || path.isAbsolute(safe)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  let file = safe ? path.join(DIST, safe) : path.join(DIST, 'index.html');
  // SPA fallback: unknown path with no file extension serves the app shell.
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = err => {
      server.removeListener('error', onError);
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

/**
 * Start the dashboard. Tries `port`, then a few above it if busy.
 * @returns {Promise<{ url:string, port:number, close:()=>Promise<void> }>}
 */
export async function startDashboard({ port = 4321, host = '127.0.0.1' } = {}) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(
      `dashboard assets not found at ${DIST}. In a dev checkout, build them first with "npm run build".`,
    );
  }
  const api = createApi();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/api' || u.pathname.startsWith('/api/')) {
      req.url = req.url.slice('/api'.length) || '/';
      return api.handle(req, res, null);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      return res.end('Method not allowed');
    }
    serveStatic(res, u.pathname);
  });

  let chosen = port;
  for (let i = 0; i < 10; i++) {
    try {
      await listen(server, chosen, host);
      break;
    } catch (err) {
      if (err.code === 'EADDRINUSE' && i < 9) {
        chosen += 1;
        continue;
      }
      throw err;
    }
  }

  const url = `http://localhost:${chosen}`;
  const close = async () => {
    await api.dispose();
    await new Promise(r => server.close(r));
  };
  return { url, port: chosen, close };
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    /* best effort */
  }
}

// Direct invocation: node server/dashboard.js [--port N] [--open]
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--port');
  const port = pi !== -1 ? Number(args[pi + 1]) : Number(process.env.PORT) || 4321;
  const { url, close } = await startDashboard({ port });
  console.log(`\nSpectra dashboard running at ${url}`);
  console.log('Reports and evaluations from this project are listed there.');
  console.log('Press Ctrl+C to stop.\n');
  if (args.includes('--open')) openBrowser(url);
  const shutdown = async () => {
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
