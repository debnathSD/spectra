// Teaching AI agents about Spectra: what is written where, that it is
// idempotent, never touches the user's own text or files, comes back out
// cleanly, and that the install step only runs for a real project install.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TARGET_IDS, detectTargets, ensureAgentDocs, firstRunPlan, installAgentDocs, knowledge, removeAgentDocs, writeNote } from './agents.js';

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

test('the first run in a project writes the docs; not in CI, under npx, or after an opt-out', () => {
  const root = project();
  const pkgRoot = path.join(root, 'node_modules', '@progen-labs', 'spectra');
  fs.mkdirSync(pkgRoot, { recursive: true });
  const env = {};
  assert.deepEqual(firstRunPlan({ cwd: root, env, pkgRoot }), { root, mode: 'install', targets: undefined });
  // from a folder inside the project too
  fs.mkdirSync(path.join(root, 'src'));
  assert.equal(firstRunPlan({ cwd: path.join(root, 'src'), env, pkgRoot }).root, root);
  assert.match(firstRunPlan({ cwd: root, env: { CI: 'true' }, pkgRoot }).skip, /CI/);
  assert.match(firstRunPlan({ cwd: root, env: { SPECTRA_AGENT_DOCS: '0' }, pkgRoot }).skip, /SPECTRA_AGENT_DOCS/);
  // npx runs Spectra from its cache; a global install lives elsewhere too
  assert.match(firstRunPlan({ cwd: root, env, pkgRoot: path.join(tmp(), '_npx', 'node_modules', '@progen-labs', 'spectra') }).skip, /not run inside/);
  // Spectra's own repository
  assert.match(firstRunPlan({ cwd: root, env, pkgRoot: tmp() }).skip, /own repository/);
  // the project can turn it off, or pick the agents
  fs.writeFileSync(path.join(root, 'spectra.config.json'), '{ "agentDocs": false }');
  assert.match(firstRunPlan({ cwd: root, env, pkgRoot }).skip, /agentDocs/);
  fs.writeFileSync(path.join(root, 'spectra.config.json'), '{ "agentDocs": ["copilot", "nope"] }');
  assert.deepEqual(firstRunPlan({ cwd: root, env, pkgRoot }).targets, ['copilot']);
});

test('once per version: written once, refreshed after an update, never back after a removal', () => {
  const root = project();
  const pkgRoot = path.join(root, 'node_modules', '@progen-labs', 'spectra');
  fs.mkdirSync(pkgRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'spectra.config.json'), '{ "agentDocs": ["agents-md", "cursor"] }');
  const run = () => ensureAgentDocs({ cwd: root, env: {}, pkgRoot });
  assert.deepEqual(run().changed.map(r => r.file), ['AGENTS.md', '.cursor/rules/spectra.mdc']);
  assert.match(run().skip, /already done/);
  // an update rewrites only what is still there
  fs.rmSync(path.join(root, '.cursor'), { recursive: true });
  const agents = read(root, 'AGENTS.md');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), agents.replace('Spectra: frontend performance, measured', 'an older version'));
  writeNote(root, { version: '0.0.1' });
  assert.deepEqual(run().changed.map(r => r.file), ['AGENTS.md']);
  assert.equal(has(root, '.cursor/rules/spectra.mdc'), false);
  assert.equal(read(root, 'AGENTS.md'), agents);
  // removed by the user: stays removed
  removeAgentDocs({ root });
  writeNote(root, { removed: true });
  assert.match(run().skip, /removed/);
  assert.equal(has(root, 'AGENTS.md'), false);
});
