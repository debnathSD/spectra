/**
 * Shared output plumbing for the CLI scripts. In --json mode stdout carries
 * nothing but the result document, so it can be piped (`| jq`, an editor, an
 * agent); every human-readable line goes to stderr instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPORTS_DIR, TOOL_ROOT } from './config.js';
import { formatValue } from '../shared/compare.js';

export const SPECTRA_VERSION = JSON.parse(
  fs.readFileSync(path.join(TOOL_ROOT, 'package.json'), 'utf8'),
).version;

/** 0 = done, 1 = could not run, 2 = ran, but a budget or a compare failed. */
export const EXIT = { OK: 0, ERROR: 1, CHECKS_FAILED: 2 };

export const reportFile = id => path.join(REPORTS_DIR, `${id}.json`);

/** Writes the result to --out and/or stdout (--json). */
export function writeResult(result, { json, out }) {
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

/**
 * process.exit() can cut a piped stdout short (pipes are asynchronous on
 * macOS), so exit only once everything written so far has been flushed.
 */
export function exitAfterFlush(code) {
  process.stdout.write('', () => process.exit(code));
}

const unitOf = unit => (unit === 'KB' ? 'bytes' : unit === 'count' ? 'count' : unit);
export const fmt = (unit, v) =>
  v == null ? '—' : formatValue(unitOf(unit), unit === 'KB' ? v * 1024 : v);

export function printBudgets(budgets, log) {
  if (!budgets) return;
  log(`\nBudgets: ${budgets.ok ? 'all within budget' : `${budgets.failed} over budget`}`);
  for (const c of budgets.checks) {
    const mark = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '–';
    const where = c.where && c.where !== 'median' ? `  (${c.where})` : '';
    const value = c.status === 'skipped' ? 'not measured' : fmt(c.unit, c.value);
    log(`  ${mark} ${c.label.padEnd(26)} ${value.padStart(12)}  limit ${fmt(c.unit, c.limit)}${where}`);
  }
}
