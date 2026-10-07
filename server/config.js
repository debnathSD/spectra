import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const TOOL_ROOT = path.resolve(here, '..');

/** superset-frontend, unless overridden with SUPERSET_FRONTEND_DIR. */
export const FRONTEND_ROOT = path.resolve(
  process.env.SUPERSET_FRONTEND_DIR || path.join(TOOL_ROOT, '../..'),
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
  process.env.PERF_TARGET_URL || 'http://localhost:9000/';
