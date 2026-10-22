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
 *   node scripts/size-report.mjs [--root <checkout>] [--json <file>] [--compare <base.json>] [--markdown <file>]
 *
 * --root measures another checkout (built), such as a pull request's base;
 * --json saves the numbers; --compare adds the change against saved numbers;
 * --markdown also writes the table to a file.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const arg = name => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const ROOT = path.resolve(arg('root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
// the budgets for what users download and install (the dashboard's are in package.json)
const BUDGET = { packedKb: 450, unpackedKb: 1500, installMb: 35, installPackages: 40 };

const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', ...opts });
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
const add = (key, what, value, limit, kind = 'bytes') => rows.push({ key, what, value, limit, kind });

// 1. the npm package
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-size-'));
const [pack] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp]));
add('packed', 'npm package, packed', pack.size, BUDGET.packedKb * 1000);
add('unpacked', 'npm package, unpacked', pack.unpackedSize, BUDGET.unpackedKb * 1000);

// 2. what `npm install` adds to a project (runtime dependencies only, like a user's install)
const project = path.join(tmp, 'project');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), '{"name":"size-check","private":true}');
run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', path.join(tmp, pack.filename)], { cwd: project });
const packages = run('npm', ['ls', '--all', '--omit=dev', '--parseable'], { cwd: project }).trim().split('\n').length - 1;
add('install', 'Install size (with dependencies)', dirSize(path.join(project, 'node_modules')), BUDGET.installMb * 1e6);
add('packages', 'Packages installed', packages, BUDGET.installPackages, 'count');

// 3. the dashboard bundle (size-limit)
for (const r of JSON.parse(run('npx', ['size-limit', '--json'])))
  add(`bundle:${r.name}`, r.name, r.size, r.sizeLimit);

fs.rmSync(tmp, { recursive: true, force: true });

const json = arg('json');
if (json) fs.writeFileSync(json, `${JSON.stringify({ version: pack.version, files: pack.entryCount, rows }, null, 2)}\n`);

const base = arg('compare') && fs.existsSync(arg('compare')) ? JSON.parse(fs.readFileSync(arg('compare'), 'utf8')) : null;
const show = (r, v) => (r.kind === 'count' ? String(v) : size(v));
const change = r => {
  const b = base?.rows.find(x => x.key === r.key);
  if (!b) return '–';
  const d = r.value - b.value;
  if (d === 0) return 'no change';
  const pct = b.value ? ` (${d > 0 ? '+' : ''}${((d / b.value) * 100).toFixed(1)}%)` : '';
  return `${d > 0 ? '🔺 +' : '🔻 −'}${show(r, Math.abs(d))}${pct}`;
};
const over = rows.filter(r => r.value > r.limit);
const table = [
  `| | Size | Budget |${base ? ' vs base |' : ''} |`,
  `| --- | ---: | ---: |${base ? ' ---: |' : ''} --- |`,
  ...rows.map(r => `| ${r.what} | ${show(r, r.value)} | ${show(r, r.limit)} |${base ? ` ${change(r)} |` : ''} ${r.value <= r.limit ? '✅' : '❌ over budget'} |`),
].join('\n');
const report = `### Spectra ${pack.version}: package and bundle size\n\n${table}\n\n${pack.entryCount} files in the package.${over.length ? `\n\n**Over budget:** ${over.map(r => r.what).join(', ')}.` : ''}\n`;
console.log(report);
if (arg('markdown')) fs.writeFileSync(arg('markdown'), table + (over.length ? `\n\n**Over budget:** ${over.map(r => r.what).join(', ')}.` : '') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
process.exitCode = over.length ? 1 : 0;
