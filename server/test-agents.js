// Teaching AI agents about Spectra: what is written where, that it is
// idempotent, never touches the user's own text or files, comes back out
// cleanly, and that the install step only runs for a real project install.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TARGET_IDS, detectTargets, installAgentDocs, knowledge, postinstallPlan, removeAgentDocs } from './agents.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-agents-')));
const project = (files = {}) => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"acme"}');
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), text);
  }
  return root;
};
const read = (root, f) => fs.readFileSync(path.join(root, f), 'utf8');
const has = (root, f) => fs.existsSync(path.join(root, f));

test('the knowledge doc covers what an agent needs', () => {
  const doc = knowledge();
  for (const s of ['npx spectra performance', 'spectra compare', '--json', 'summary', 'findings', 'spectra.config.json', 'SPECTRA_LOGIN_PASSWORD', 'Never ask the user to paste a password'])
    assert.ok(doc.includes(s), `missing: ${s}`);
  // one level deeper inside a shared file
  assert.match(knowledge({ nested: true }), /^## Spectra/);
});

test('every agent gets its own file, with the format it reads', () => {
  const root = project();
  const results = installAgentDocs({ root, targets: TARGET_IDS });
  assert.ok(results.every(r => r.result === 'created'), JSON.stringify(results));
  assert.match(read(root, '.claude/skills/spectra/SKILL.md'), /^---\nname: spectra\ndescription: "Spectra/);
  assert.match(read(root, '.cursor/rules/spectra.mdc'), /^---\ndescription: ".+"\nglobs:\nalwaysApply: false\n---/);
  assert.match(read(root, '.github/instructions/spectra.instructions.md'), /^---\napplyTo: "\*\*"\n/);
  assert.match(read(root, '.windsurf/rules/spectra.md'), /^---\ntrigger: model_decision\n/);
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) assert.match(read(root, f), /<!-- spectra:start -->[\s\S]+<!-- spectra:end -->/);
  // a second run changes nothing
  assert.ok(installAgentDocs({ root, targets: TARGET_IDS }).every(r => r.result === 'unchanged'));
});

test("the user's own text and files are left alone", () => {
  const mine = '# Our agents\n\nUse pnpm, never npm.\n';
  const root = project({ 'AGENTS.md': mine, '.cursor/rules/spectra.mdc': 'my own rule\n' });
  const results = installAgentDocs({ root, targets: ['agents-md', 'cursor'] });
  assert.equal(results.find(r => r.id === 'cursor').result, 'skipped (a file of yours is already there)');
  assert.equal(read(root, '.cursor/rules/spectra.mdc'), 'my own rule\n');
  const agents = read(root, 'AGENTS.md');
  assert.ok(agents.startsWith(mine.trim()));
  // the user edits around the block; an update replaces only the block
  fs.writeFileSync(path.join(root, 'AGENTS.md'), `${agents}\n## Later\n\nMore notes.\n`);
  const edited = read(root, 'AGENTS.md').replace('Spectra: frontend performance, measured', 'an older version');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), edited);
  assert.equal(installAgentDocs({ root, targets: ['agents-md'] })[0].result, 'updated');
  const updated = read(root, 'AGENTS.md');
  assert.ok(updated.startsWith(mine.trim()) && updated.endsWith('## Later\n\nMore notes.\n'));
  assert.equal(updated.match(/spectra:start/g).length, 1);
  // and removing it gives the user's text back
  removeAgentDocs({ root });
  assert.equal(read(root, 'AGENTS.md'), `${mine.trim()}\n\n## Later\n\nMore notes.\n`);
  assert.equal(read(root, '.cursor/rules/spectra.mdc'), 'my own rule\n');
});

test('removing deletes what Spectra made, and the folders it made', () => {
  const root = project({ '.github/workflows/ci.yml': 'on: push\n' });
  installAgentDocs({ root, targets: TARGET_IDS });
  const removed = removeAgentDocs({ root });
  assert.equal(removed.length, TARGET_IDS.length + 1); // and CLAUDE.md
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.claude', '.cursor', '.windsurf', '.clinerules', '.roo', '.github/instructions']) assert.equal(has(root, f), false, f);
  assert.equal(read(root, '.github/workflows/ci.yml'), 'on: push\n');
  assert.deepEqual(removeAgentDocs({ root }), []);
});

test('the agents in use are detected from the project and the home folder', () => {
  const home = tmp();
  const root = project({ '.cursor/mcp.json': '{}' });
  assert.deepEqual(detectTargets({ root, home }), ['agents-md', 'cursor']);
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.vscode'));
  assert.deepEqual(detectTargets({ root, home }), ['agents-md', 'claude', 'cursor', 'copilot']);
});

test('the install step runs only for a real project install', () => {
  const root = project();
  const pkgRoot = path.join(root, 'node_modules', '@progen-labs', 'spectra');
  fs.mkdirSync(pkgRoot, { recursive: true });
  const env = { INIT_CWD: root };
  assert.deepEqual(postinstallPlan({ env, pkgRoot }), { root, targets: undefined });
  assert.match(postinstallPlan({ env: { ...env, CI: 'true' }, pkgRoot }).skip, /CI/);
  assert.match(postinstallPlan({ env: { ...env, SPECTRA_AGENT_DOCS: '0' }, pkgRoot }).skip, /SPECTRA_AGENT_DOCS/);
  assert.match(postinstallPlan({ env: { ...env, npm_config_global: 'true' }, pkgRoot }).skip, /global/);
  assert.match(postinstallPlan({ env: {}, pkgRoot }).skip, /INIT_CWD/);
  // npx runs Spectra from its cache, not from the project
  assert.match(postinstallPlan({ env, pkgRoot: path.join(tmp(), '_npx', 'node_modules', '@progen-labs', 'spectra') }).skip, /not installed into this project/);
  // installing Spectra's own dependencies
  assert.match(postinstallPlan({ env: { INIT_CWD: pkgRoot }, pkgRoot }).skip, /own repository/);
  // the project can turn it off, or pick the agents
  fs.writeFileSync(path.join(root, 'spectra.config.json'), '{ "agentDocs": false }');
  assert.match(postinstallPlan({ env, pkgRoot }).skip, /agentDocs/);
  fs.writeFileSync(path.join(root, 'spectra.config.json'), '{ "agentDocs": ["copilot", "nope"] }');
  assert.deepEqual(postinstallPlan({ env, pkgRoot }).targets, ['copilot']);
});
