#!/usr/bin/env node
// The PR report's note for one test run: the counts from `node --test`, and
// each failing test with its file and line, the error, and where in Spectra's
// code it was thrown (also as annotations on those lines).
//   node scripts/ci/test-note.mjs <output> "<label>" --note <file>   (annotations on stdout)
import fs from 'node:fs';
import { annotate, fileLink, repoPath } from './links.mjs';

const [file, label = ''] = process.argv.slice(2);
const noteAt = process.argv.indexOf('--note');
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const num = name => Number((text.match(new RegExp(`^ℹ ${name} (\\d+)`, 'm')) || [])[1] ?? NaN);
const [, pass, fail, skipped, ms] = ['tests', 'pass', 'fail', 'skipped', 'duration_ms'].map(num);
const out = [];
if (Number.isNaN(pass)) {
  out.push(`${label}: the tests did not run to the end.`);
} else {
  // with --experimental-test-coverage: "ℹ all files | 73.87 | 74.23 | 77.01 |", and any minimum it missed
  const all = text.match(/^ℹ all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/m);
  const coverage = all ? ` Coverage: lines ${Number(all[1]).toFixed(1)}%, branches ${Number(all[2]).toFixed(1)}%, functions ${Number(all[3]).toFixed(1)}%.` : '';
  out.push(`${label}: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} (${Math.round(ms / 1000)} s).${coverage}`);
  for (const miss of text.matchAll(/^ℹ Error: ([\d.]+% \w+ coverage does not meet threshold of [\d.]+%)/gm)) out.push(`  - **Below the coverage minimum:** ${miss[1]}`);
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
    out.push(`  - **${name}** (${tfile ? fileLink(tfile, tline) : 'unknown file'}): ${error.replace(/[\\|]/g, '\\$&').slice(0, 300)}${frame ? ` · thrown at ${fileLink(frame.file, frame.line)}` : ''}`);
  }
}
// annotations went to stdout above; the note goes to its file (or stdout without --note)
if (noteAt > 0) fs.writeFileSync(process.argv[noteAt + 1], `${out.join('\n')}\n`);
else console.log(out.join('\n'));
