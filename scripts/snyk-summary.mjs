#!/usr/bin/env node
/**
 * Turns `snyk test --json-file-output` into the Snyk workflow's run summary:
 * how many known vulnerabilities, by severity, and the serious ones with the
 * package, the path that pulls it in and the fix. Exits 1 when any is high or
 * critical (the same bar as npm audit). Not shipped in the npm package.
 *
 *   node scripts/snyk-summary.mjs snyk.json
 */
import fs from 'node:fs';

const file = process.argv[2] || 'snyk.json';
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const results = Array.isArray(raw) ? raw : [raw];
if (results.some(r => r.error)) {
  console.error(`Snyk could not test: ${results.find(r => r.error).error}`);
  process.exit(1);
}

// one row per vulnerability and package version, however many paths lead to it
const seen = new Map();
for (const v of results.flatMap(r => r.vulnerabilities || [])) seen.set(`${v.id}@${v.packageName}@${v.version}`, v);
const vulns = [...seen.values()];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const count = s => vulns.filter(v => v.severity === s).length;
const serious = vulns.filter(v => v.severity === 'critical' || v.severity === 'high');
const deps = results.reduce((n, r) => n + (r.dependencyCount || 0), 0);

const fix = v =>
  v.isUpgradable && v.upgradePath?.[1]
    ? `upgrade to ${v.upgradePath.find(Boolean) || v.upgradePath[1]}`
    : v.fixedIn?.length
      ? `fixed in ${v.packageName}@${v.fixedIn.join(', ')}`
      : 'no fix yet';
const lines = [
  `### Snyk: ${vulns.length ? `${vulns.length} known vulnerabilit${vulns.length === 1 ? 'y' : 'ies'}` : 'no known vulnerabilities'}`,
  '',
  `${deps} dependencies tested. ${SEVERITIES.map(s => `${s}: ${count(s)}`).join(' · ')}`,
];
if (serious.length) {
  lines.push('', '| Severity | Package | Issue | Pulled in by | Fix |', '| --- | --- | --- | --- | --- |');
  for (const v of serious)
    lines.push(`| ${v.severity} | \`${v.packageName}@${v.version}\` | [${v.title}](https://security.snyk.io/vuln/${v.id}) | ${(v.from || []).slice(1, -1).join(' › ') || 'direct'} | ${fix(v)} |`);
}
const report = `${lines.join('\n')}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
process.exitCode = serious.length ? 1 : 0;
