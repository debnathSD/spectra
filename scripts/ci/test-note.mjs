#!/usr/bin/env node
// The PR report's note for one test run: the counts from `node --test`, and
// each failing test with its file and line, the error, and where in Spectra's
// code it was thrown (also as annotations on those lines).
//   node scripts/ci/test-note.mjs <output> "<label>"     (the note on stdout's last lines)
import fs from 'node:fs';
import { annotate, fileLink, repoPath } from './links.mjs';

const [file, label = ''] = process.argv.slice(2);
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const num = name => Number((text.match(new RegExp(`^ℹ ${name} (\\d+)`, 'm')) || [])[1] ?? NaN);
const [, pass, fail, skipped, ms] = ['tests', 'pass', 'fail', 'skipped', 'duration_ms'].map(num);
const out = [];
if (Number.isNaN(pass)) {
  out.push(`${label}: the tests did not run to the end.`);
} else {
  out.push(`${label}: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} (${Math.round(ms / 1000)} s).`);
  // the summary after "✖ failing tests:" has, per failure: "test at <file>:<line>:<col>", "✖ <name> (…)", the error, its stack
  const summary = text.split(/^✖ failing tests:\s*$/m)[1] || '';
  for (const block of summary.split(/^(?=test at )/m).filter(b => b.startsWith('test at '))) {
    const [, tfile, tline] = block.match(/^test at (.+?):(\d+):\d+/) || [];
    const name = (block.match(/^\s*✖ (.+?)(?: \(\d[\d.]*m?s\))?$/m) || [])[1] || 'a test';
    // the error: its first lines, up to the stack
    const lines = block.split('\n').slice(2);
    const stackAt = lines.findIndex(l => /^\s*at /.test(l));
    const error = lines.slice(0, stackAt < 0 ? 4 : Math.min(stackAt, 6)).map(l => l.trim()).filter(Boolean).join(' ');
    // the first stack frame in Spectra's own code, not in node_modules or Node itself
    const frame = [...block.matchAll(/\(((?:file:\/\/)?[^()\s]+?):(\d+):\d+\)/g)].map(m => ({ file: repoPath(m[1]), line: m[2] })).find(f => !f.file.startsWith('..') && !f.file.includes('node_modules') && !f.file.startsWith('node:'));
    if (tfile) annotate(tfile, tline, 'Test failed', `${name}: ${error}`);
    out.push(`  - **${name}** (${tfile ? fileLink(tfile, tline) : 'unknown file'}): ${error.replace(/\|/g, '\\|').slice(0, 300)}${frame ? ` · thrown at ${fileLink(frame.file, frame.line)}` : ''}`);
  }
}
// annotations went to stdout above; the note is printed last, after a marker
console.log(`---note---\n${out.join('\n')}`);
