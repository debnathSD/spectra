#!/usr/bin/env node
// ESLint's JSON output as annotations on the lines (stdout) and as the PR
// report's note (written to --note), each problem linked to its file and line.
//   npx eslint . -f json -o eslint.json; node scripts/ci/lint-note.mjs eslint.json --note ci-notes/lint.md
import fs from 'node:fs';
import { annotate, fileLink } from './links.mjs';

const [file] = process.argv.slice(2);
const noteAt = process.argv.indexOf('--note');
const results = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const problems = (results || []).flatMap(r => r.messages.map(m => ({ file: r.filePath, ...m })));
for (const p of problems) annotate(p.file, p.line, `ESLint ${p.ruleId || ''}`, p.message);
const files = new Set(problems.map(p => p.file)).size;
const note = !results
  ? 'ESLint did not run to the end.'
  : problems.length
    ? [
        `ESLint: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}.`,
        '',
        ...problems.slice(0, 25).map(p => `- ${fileLink(p.file, p.line)} ${p.message}${p.ruleId ? ` (\`${p.ruleId}\`)` : ''}`),
        ...(problems.length > 25 ? [`- …and ${problems.length - 25} more`] : []),
      ].join('\n')
    : 'ESLint: no problems.';
if (noteAt > 0) fs.writeFileSync(process.argv[noteAt + 1], `${note}\n`);
else console.log(note);
