// Runs inside VS Code's extension host (see run.js).
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const step = (name, fn) => async () => {
  process.stdout.write(`  … ${name}\n`);
  await fn();
  process.stdout.write(`  ✓ ${name}\n`);
};

exports.run = async () => {
  const ext = vscode.extensions.getExtension('progen-labs.spectra');
  assert.ok(ext, 'the extension is installed');
  const api = await ext.activate();
  const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const row = vscode.Uri.file(path.join(ws, 'src', 'Row.jsx'));
  await vscode.workspace.getConfiguration('spectra').update('cliPath', process.env.SPECTRA_E2E_CLI, vscode.ConfigurationTarget.Global);

  const commands = await vscode.commands.getCommands(true);
  for (const id of ['spectra.profilePage', 'spectra.verify', 'spectra.runGoldenPaths', 'spectra.openDashboard', 'spectra.setBaseline'])
    assert.ok(commands.includes(id), `${id} is registered`);

  let profiled;
  await step('profile the page load (2 runs)', async () => {
    profiled = await api.profilePage({ url: process.env.SPECTRA_E2E_URL, runs: 2, quiet: true });
    assert.ok(profiled, 'a result');
    assert.equal(profiled.result.kind, 'profile');
  })();

  await step('findings land in the Problems panel at Row.jsx:3', async () => {
    const diags = vscode.languages.getDiagnostics(row).filter(d => d.source === 'Spectra');
    assert.ok(diags.length > 0, 'Row.jsx has Spectra problems');
    const slow = diags.find(d => /Row is slow to render/.test(d.message));
    assert.ok(slow, 'the slow-render finding');
    assert.equal(slow.range.start.line, 2);
    assert.equal(slow.severity, vscode.DiagnosticSeverity.Warning);
    process.stdout.write(`    ${slow.message.split('\n')[0]}\n`);
  })();

  await step('CodeLens above the Row component', async () => {
    await vscode.window.showTextDocument(row);
    const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', row);
    const titles = lenses.map(l => l.command && l.command.title).filter(Boolean);
    const lens = titles.find(t => t.startsWith('⚡ Spectra: Row'));
    assert.ok(lens, `a Row lens among ${JSON.stringify(titles)}`);
    process.stdout.write(`    ${lens}\n`);
  })();

  await step('verify against the baseline', async () => {
    const verified = await api.verify({ quiet: true });
    assert.ok(verified && verified.comparison, 'a comparison');
    assert.ok(['improved', 'regressed', 'mixed', 'neutral'].includes(verified.comparison.verdict));
    process.stdout.write(`    verdict: ${verified.comparison.verdict} (${verified.comparison.confidence})\n`);
  })();

  await step('MCP server offered to agent mode (VS Code 1.101+)', async () => {
    if (!vscode.lm || typeof vscode.lm.registerMcpServerDefinitionProvider !== 'function') {
      process.stdout.write('    (this VS Code has no MCP API: skipped)\n');
      return;
    }
    assert.ok(ext.packageJSON.contributes.mcpServerDefinitionProviders.some(p => p.id === 'spectra'));
  })();

  await vscode.workspace.getConfiguration('spectra').update('cliPath', undefined, vscode.ConfigurationTarget.Global);
};
