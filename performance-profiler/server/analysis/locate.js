/**
 * Finds where a function is *defined* in its source file.
 *
 * Webpack dev bundles carry no source map in this repo, so the profiler only
 * knows a function's name and its line in the bundle. Looking the name up in
 * the real file gives the developer a line to jump to. The result is a
 * best-effort match (flagged "located", not "exact").
 */
import fs from 'node:fs';
import path from 'node:path';

const escapeRe = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 'Foo.bar' -> 'bar', 'get x' -> 'x', '(anonymous in run)' -> 'run'; null when nothing searchable. */
export function searchableName(name) {
  if (!name) return null;
  const anon = /^\(anonymous in (.+)\)$/.exec(name);
  const base = (anon ? anon[1] : name).replace(
    /^(?:get|set|bound|async)\s+/,
    '',
  );
  const last = base.split('.').pop();
  return /^[A-Za-z_$][\w$]*$/.test(last) ? last : null;
}

function patterns(n) {
  const id = escapeRe(n);
  // Earlier entries are stronger evidence of a definition than later ones.
  return [
    new RegExp(`\\bfunction\\s*\\*?\\s*${id}\\s*[(<]`),
    new RegExp(`\\bclass\\s+${id}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s+${id}\\s*(?::[^=]+)?=`),
    new RegExp(
      `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:(?:static|public|private|protected|readonly|get|set)\\s+)*${id}\\s*(?:<[^>]*>)?\\s*\\([^;]*\\{\\s*$`,
    ),
    new RegExp(
      `\\b${id}\\s*[:=]\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|[A-Za-z_$][\\w$]*\\s*=>)`,
    ),
  ];
}

/** @returns {number | null} 1-based line of the most likely definition */
export function findDefinitionLine(source, name) {
  const n = searchableName(name);
  if (!n) return null;
  const lines = source.split('\n');
  const tests = patterns(n);
  let best = null;
  for (let i = 0; i < lines.length && best?.rank !== 0; i += 1) {
    const line = lines[i];
    if (!line.includes(n)) continue;
    for (let rank = 0; rank < tests.length; rank += 1) {
      if (tests[rank].test(line)) {
        if (!best || rank < best.rank) best = { rank, line: i + 1 };
        break;
      }
    }
  }
  return best ? best.line : null;
}

/** Caches file reads; `roots` are searched in order (same as the source viewer). */
export class SourceIndex {
  constructor(roots) {
    this.roots = roots;
    this.files = new Map();
  }

  read(rel) {
    if (this.files.has(rel)) return this.files.get(rel);
    let entry = null;
    if (!path.isAbsolute(rel) && !rel.split('/').includes('..')) {
      for (const root of this.roots) {
        try {
          const abs = path.join(root, rel);
          if (fs.statSync(abs).size <= 2 * 1024 * 1024) {
            entry = { abs, text: fs.readFileSync(abs, 'utf8') };
            break;
          }
        } catch {
          /* try the next root */
        }
      }
    }
    this.files.set(rel, entry);
    return entry;
  }

  /** @returns {{line: number | null, abs: string} | null} */
  lookup(file, name) {
    const entry = this.read(file);
    if (!entry) return null;
    return { line: findDefinitionLine(entry.text, name), abs: entry.abs };
  }

  absolutePath(file) {
    return this.read(file)?.abs || null;
  }
}
