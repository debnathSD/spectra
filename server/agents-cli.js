/**
 * spectra agents: puts Spectra's knowledge doc where AI agents read their
 * project instructions (server/agents.js), or takes it out again.
 *
 *   spectra agents                 the agents this project or machine uses, and AGENTS.md
 *   spectra agents --all           every supported agent
 *   spectra agents --only claude,copilot
 *   spectra agents --remove        take it out of every agent's files
 *   spectra agents --list          the supported agents, and which ones were detected
 *   spectra agents --print         print the knowledge doc
 *   … --dir <project>  --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './args.js';
import { TARGETS, TARGET_IDS, describe, detectTargets, installAgentDocs, knowledge, removeAgentDocs, writeNote } from './agents.js';

const { opt, flag } = parseArgs(process.argv.slice(2), { values: ['dir', 'only'] });
const root = path.resolve(opt('dir', process.cwd()));
const dryRun = flag('dry-run');

if (flag('help') || process.argv.includes('-h')) {
  console.log(`usage: spectra agents [--all | --only <ids>] [--remove] [--list] [--print] [--dir <project>] [--dry-run]

Teaches your AI agents about Spectra: what it does, which command answers which
request, and how to read the results. It writes Spectra's knowledge doc where
each agent reads its project instructions, so you can ask in plain words
("why is checkout slow?", "did my change help?") and the agent runs Spectra.
It happens by itself the first time Spectra runs in a project; this does it by hand.

Agents: ${TARGET_IDS.join(', ')}
Off for a project: "agentDocs": false in spectra.config.json (or SPECTRA_AGENT_DOCS=0).`);
  process.exit(0);
}

if (flag('print')) {
  console.log(knowledge());
  process.exit(0);
}

if (flag('list')) {
  const found = new Set(detectTargets({ root }));
  for (const t of TARGETS) console.log(`  ${found.has(t.id) ? '✓' : ' '} ${t.id.padEnd(10)} ${t.file.padEnd(46)} ${t.name}`);
  console.log('\n✓ = written by default (detected in this project or on this machine). --all writes every one.');
  process.exit(0);
}

if (flag('remove')) {
  const results = removeAgentDocs({ root, dryRun });
  // and don't bring them back on the next run
  if (!dryRun) writeNote(root, { removed: true });
  console.log(results.length ? `${dryRun ? 'Would remove' : 'Removed'} Spectra's knowledge doc:\n${describe(results)}` : 'Nothing to remove.');
  process.exit(0);
}

let targets;
if (flag('all')) targets = TARGET_IDS;
else if (opt('only')) {
  targets = String(opt('only')).split(',').map(s => s.trim()).filter(Boolean);
  const unknown = targets.filter(id => !TARGET_IDS.includes(id));
  if (unknown.length) {
    console.error(`spectra: unknown agent ${unknown.join(', ')} (known: ${TARGET_IDS.join(', ')})`);
    process.exit(1);
  }
}
const results = installAgentDocs({ root, targets, dryRun });
if (!dryRun) writeNote(root, { version: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version });
console.log(`${dryRun ? 'Would write' : 'Wrote'} Spectra's knowledge doc for your AI agents:\n${describe(results)}`);
console.log('\nAsk your agent in plain words, e.g. "why is the checkout page slow?" or "did my last change make it faster?".');
console.log('Remove it with: npx spectra agents --remove');
