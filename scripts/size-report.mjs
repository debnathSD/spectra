#!/usr/bin/env node
/**
 * What Spectra costs the people who install it, checked against budgets: the
 * npm package (packed and unpacked), the install (everything `npm install`
 * puts in node_modules, dependencies included), and the dashboard bundle
 * (size-limit, the "size-limit" budgets in package.json). Run after
 * `npm run build`. Prints a table, adds it to the GitHub job summary, and
 * exits 1 when anything is over budget. Not shipped in the npm package.
 *
 *   npm run size
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the budgets for what users download and install (the dashboard's are in package.json)
const BUDGET = { packedKb: 450, unpackedKb: 1500, installMb: 35, installPackages: 40 };

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const size = bytes => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(2)} MB` : `${(bytes / 1000).toFixed(1)} kB`);
const dirSize = dir => {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) total += fs.statSync(p).size;
  }
  return total;
};

const rows = [];
const check = (what, value, limit, show) => rows.push({ what, value: show(value), limit: show(limit), ok: value <= limit });

// 1. the npm package
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-size-'));
const [pack] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp]));
check('npm package, packed', pack.size, BUDGET.packedKb * 1000, size);
check('npm package, unpacked', pack.unpackedSize, BUDGET.unpackedKb * 1000, size);

// 2. what `npm install` adds to a project (runtime dependencies only, like a user's install)
const project = path.join(tmp, 'project');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), '{"name":"size-check","private":true}');
run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', path.join(tmp, pack.filename)], { cwd: project });
const modules = path.join(project, 'node_modules');
const packages = run('npm', ['ls', '--all', '--omit=dev', '--parseable'], { cwd: project }).trim().split('\n').length - 1;
check('Install size (with dependencies)', dirSize(modules), BUDGET.installMb * 1e6, size);
check('Packages installed', packages, BUDGET.installPackages, n => String(n));

// 3. the dashboard bundle (size-limit)
for (const r of JSON.parse(run('npx', ['size-limit', '--json'])))
  rows.push({ what: r.name, value: size(r.size), limit: size(r.sizeLimit), ok: r.passed });

fs.rmSync(tmp, { recursive: true, force: true });

const over = rows.filter(r => !r.ok);
const table = [
  '| | Size | Budget | |',
  '| --- | ---: | ---: | --- |',
  ...rows.map(r => `| ${r.what} | ${r.value} | ${r.limit} | ${r.ok ? '✅' : '❌ over budget'} |`),
].join('\n');
const report = `### Spectra ${pack.version}: package and bundle size\n\n${table}\n\n${pack.entryCount} files in the package.${over.length ? `\n\n**Over budget:** ${over.map(r => r.what).join(', ')}.` : ''}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
process.exitCode = over.length ? 1 : 0;
