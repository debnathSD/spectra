/**
 * Maps a position inside a running script to a file in the repo.
 *
 * Strategies, tried per script in order of precision:
 *   1. source map        exact original file, line and function name
 *   2. webpack markers   dev bundles built with `devtool: false` (this repo's
 *                        default) keep a `/***\/ "./src/x.tsx":` line in front of
 *                        every module, so a bundle line maps to its module
 *   3. script URL        Vite/ESM dev servers serve one script per file;
 *                        `webpack://` and `webpack-internal://` URLs embed the path
 *   4. bundle            anything else is reported as the bundle it came from
 */
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const posix = path.posix;
const MARKER = /^\/\*{3,}\/ "([^"]+)":\s*$/;
// The banner webpack prints above every module, including the inlined entry module
// (which has no quoted marker):   !*** ./src/main.jsx ***!
const BANNER = /^\s*!\*{3} (\S.*?) \*{3}!\s*$/;
const NATIVE = new Set([
  '(root)',
  '(program)',
  '(idle)',
  '(garbage collector)',
]);

export function isNativeFrame(functionName) {
  return NATIVE.has(functionName);
}

/** 'node_modules/@a/b/c.js' -> '@a/b', 'node_modules/x/y.js' -> 'x' */
export function packageOf(file) {
  const i = file.lastIndexOf('node_modules/');
  if (i === -1) return null;
  const rest = file.slice(i + 'node_modules/'.length).split('/');
  if (rest[0] === '.vite') {
    // Vite pre-bundles dependencies: .vite/deps/react-dom_client.js -> react-dom
    const name = (rest[rest.length - 1] || '')
      .replace(/\.js$/, '')
      .replace(/_.*$/, '');
    return name.startsWith('chunk-') ? 'vite-deps' : name;
  }
  return rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
}

/**
 * Normalises any of the path spellings bundlers produce to a repo-relative
 * posix path ('src/a/b.tsx', 'node_modules/react/index.js').
 */
export function normalizePath(raw, root) {
  let p = raw;
  p = p
    .replace(/^webpack-internal:\/\/\/?/, '')
    .replace(/^webpack:\/\/[^/]*\//, '');
  p = p.replace(/^file:\/\//, '');
  p = p.replace(/[?#].*$/, '').split(' + ')[0];
  if (p.startsWith('/@fs/')) p = p.slice(4);
  const nm = p.lastIndexOf('node_modules/');
  if (nm !== -1) return p.slice(nm);
  if (root && posix.isAbsolute(p) && p.startsWith(`${root}/`))
    p = p.slice(root.length + 1);
  p = posix
    .normalize(p)
    .replace(/^(\.\.\/)+/, '')
    .replace(/^\.\//, '')
    .replace(/^\//, '');
  return p;
}

function pathFromUrl(url, root) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return normalizePath(decodeURIComponent(u.pathname), root);
    }
  } catch {
    /* not an absolute URL */
  }
  return normalizePath(url, root);
}

function looksLikeBundle(p) {
  return (
    /\.(?:chunk|bundle)\.js$|(?:^|\/)(?:static\/assets|assets|dist)\//.test(
      p,
    ) || /\.[0-9a-f]{8,}\.js$/.test(p)
  );
}

function decodeDataUrl(url) {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  return m[1]
    ? Buffer.from(m[2], 'base64').toString('utf8')
    : decodeURIComponent(m[2]);
}

export class SourceResolver {
  /**
   * @param {object} options
   * @param {string} options.root        absolute path of the frontend project root
   * @param {Map<string, {url: string, sourceMapURL?: string}>} options.scripts  by scriptId
   * @param {(scriptId: string) => Promise<string>} options.getSource  Debugger.getScriptSource
   * @param {(url: string) => Promise<string>} [options.fetchText]
   */
  constructor({ root, scripts, getSource, fetchText }) {
    this.root = root;
    this.scripts = scripts;
    this.getSource = getSource;
    this.fetchText = fetchText || (async url => (await fetch(url)).text());
    this.strategies = new Map(); // scriptId -> {kind, ...}
    this.cache = new Map();
    this.kinds = new Set();
  }

  /** Load maps / marker indexes for every script that is about to be resolved. */
  async prepare(scriptIds) {
    await Promise.all([...new Set(scriptIds)].map(id => this.prepareOne(id)));
  }

  async prepareOne(scriptId) {
    if (this.strategies.has(scriptId)) return;
    const script = this.scripts.get(scriptId);
    if (!script || !script.url) {
      this.strategies.set(scriptId, { kind: 'none' });
      return;
    }
    const { url, sourceMapURL } = script;

    if (/^(?:webpack|webpack-internal):/.test(url)) {
      this.strategies.set(scriptId, { kind: 'url' });
      return;
    }
    if (sourceMapURL) {
      try {
        const text = sourceMapURL.startsWith('data:')
          ? decodeDataUrl(sourceMapURL)
          : await this.fetchText(new URL(sourceMapURL, url).href);
        // Resolving against the script URL turns 'heavy.js' or '../src/x.ts' into a full URL.
        this.strategies.set(scriptId, {
          kind: 'map',
          map: new TraceMap(JSON.parse(text), url),
        });
        this.kinds.add('sourcemap');
        return;
      } catch {
        /* unreachable or malformed map: fall through */
      }
    }
    try {
      const source = await this.getSource(scriptId);
      const markers = indexWebpackModules(source);
      if (markers.length) {
        this.strategies.set(scriptId, { kind: 'markers', markers });
        this.kinds.add('webpack-markers');
        return;
      }
    } catch {
      /* script gone */
    }
    this.strategies.set(scriptId, { kind: 'url' });
    this.kinds.add('urls');
  }

  /**
   * @returns {{file: string, vendor: boolean, pkg: string|null, line: number|null, name: string|null, exact: boolean}}
   */
  resolve(scriptId, url, line, column, functionName) {
    const key = `${scriptId}:${line}:${column}`;
    let hit = this.cache.get(key);
    if (hit) return hit;
    hit = this.resolveUncached(scriptId, url, line, column, functionName);
    this.cache.set(key, hit);
    return hit;
  }

  resolveUncached(scriptId, url, line, column) {
    const strategy = this.strategies.get(scriptId) || { kind: 'url' };
    if (strategy.kind === 'map' && line >= 0) {
      const pos = originalPositionFor(strategy.map, {
        line: line + 1,
        column: Math.max(column, 0),
      });
      if (pos.source) {
        return this.finish(
          pathFromUrl(pos.source, this.root),
          pos.line,
          pos.name,
          true,
        );
      }
    }
    if (strategy.kind === 'markers' && line >= 0) {
      const id = moduleAt(strategy.markers, line);
      if (id)
        return this.finish(normalizePath(id, this.root), null, null, false);
    }
    if (!url) return this.finish('(native)', null, null, false);
    if (/^(?:pptr:|chrome-extension:|extensions::|devtools:)/.test(url))
      return this.finish('(injected)', null, null, false);
    const p = pathFromUrl(url, this.root);
    return this.finish(
      looksLikeBundle(p) ? `bundle:${posix.basename(p)}` : p.replace(/^\//, ''),
      null,
      null,
      false,
    );
  }

  finish(file, line, name, exact) {
    const pkg = packageOf(file);
    return { file, vendor: Boolean(pkg), pkg, line, name, exact };
  }
}

const MODULE_ID = /^(?:\.{1,2}\/|webpack\/)/;

/** [{line, id}] sorted by line (0-based) for every webpack module start marker. */
export function indexWebpackModules(source) {
  const markers = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    const c = l.charCodeAt(0);
    // markers start with '/*' ; banners with optional spaces then '!*'
    const m = c === 47 ? MARKER.exec(l) : BANNER.exec(l);
    // a module's quoted marker and its banner name the same module: keep the first
    if (m && MODULE_ID.test(m[1]) && markers[markers.length - 1]?.id !== m[1])
      markers.push({ line: i, id: m[1] });
  }
  return markers;
}

export function moduleAt(markers, line) {
  let lo = 0;
  let hi = markers.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid].line <= line) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found === -1) return null;
  const id = markers[found].id;
  return id.startsWith('webpack/') ? null : id;
}
