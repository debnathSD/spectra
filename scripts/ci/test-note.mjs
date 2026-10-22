#!/usr/bin/env node
// The PR report's line for one test run: counts from `node --test` output, and
// the names of failing tests. Usage: node scripts/ci/test-note.mjs <output> "<label>"
import fs from 'node:fs';

const [file, label = ''] = process.argv.slice(2);
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const num = name => Number((text.match(new RegExp(`^ℹ ${name} (\\d+)`, 'm')) || [])[1] ?? NaN);
const [tests, pass, fail, skipped, ms] = ['tests', 'pass', 'fail', 'skipped', 'duration_ms'].map(num);
if (Number.isNaN(tests)) {
  console.log(`${label}: the tests did not run to the end.`);
  process.exit(0);
}
console.log(`${label}: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} (${Math.round(ms / 1000)} s).`);
// "✖ name (12ms)" lines name the failing tests; the summary repeats them, so keep each once
const failing = [...new Set([...text.matchAll(/^\s*✖ (.+?) \(\d[\d.]*m?s\)$/gm)].map(m => m[1]))].filter(n => !/^failing tests:?$/.test(n));
if (fail && failing.length) console.log(failing.slice(0, 10).map(n => `  - ${n}`).join('\n'));
