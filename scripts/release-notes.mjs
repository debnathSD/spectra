#!/usr/bin/env node
// The release notes for one version: its section of CHANGELOG.md. Exits 1 when
// the changelog has none, so a release can't go out without its notes.
//   node scripts/release-notes.mjs 0.6.2 > notes.md
//   node scripts/release-notes.mjs "VS Code extension 0.2.0"
import fs from 'node:fs';

const version = process.argv[2];
const text = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const sections = text.split(/^(?=## )/m);
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const section = sections.find(s => new RegExp(`^## ${escaped} \\(`).test(s));
if (!section) {
  console.error(`CHANGELOG.md has no "## ${version} (date)" section: add one before releasing.`);
  process.exit(1);
}
console.log(`${section.split('\n').slice(1).join('\n').trim()}\n\nThe whole history is in [CHANGELOG.md](https://github.com/progen-labs/spectra/blob/main/CHANGELOG.md).`);
