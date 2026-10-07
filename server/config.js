import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const TOOL_ROOT = path.resolve(here, '..');

/** Frontend project root. Prefer `PERF_FRONTEND_DIR`, fall back to legacy var. */
export const FRONTEND_ROOT = path.resolve(
  process.env.PERF_FRONTEND_DIR || process.env.FRONTEND_DIR || path.join(TOOL_ROOT, '../..'),
);

/** Where source files are looked up when showing a file (first match wins). */
export const SOURCE_ROOTS = [
  FRONTEND_ROOT,
  path.join(TOOL_ROOT, 'fixtures/demo-app'),
];

export const REPORTS_DIR = path.join(TOOL_ROOT, 'reports');
export const CHROME_PROFILE_DIR =
  process.env.PERF_CHROME_PROFILE_DIR ||
  path.join(TOOL_ROOT, '.chrome-profile');

export const DEFAULT_TARGET_URL =
  process.env.PERF_TARGET_URL || 'http://localhost:3000/';

/** Human-friendly name for the profiled target (used in the UI and PDF). */
let inferredName = 'target-frontend';
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(FRONTEND_ROOT, 'package.json'), 'utf8'),
  );
  if (pkg && pkg.name) inferredName = pkg.name;
} catch {
  // ignore
}

export const TARGET_NAME =
  process.env.PERF_TARGET_NAME || process.env.FRONTEND_NAME || inferredName;
