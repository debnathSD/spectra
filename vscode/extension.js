// Spectra for VS Code: profile the page from the editor, see each finding at
// its exact line (Problems panel), render counts and timings above components
// and functions (CodeLens), headline numbers in the status bar, and verify a
// change against a baseline. A thin client: every number comes from the
// project's Spectra CLI (`--json`), and results that the CLI or an AI
// assistant writes to .spectra/results show up here too.
'use strict';

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const model = require('./lib/model');
const runner = require('./lib/runner');

const SEVERITY = {
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

let output;
let problems;
let status;
const lensChanged = new vscode.EventEmitter();
let lensesByFile = new Map();
let shown = null; // the result file on screen, so the watcher doesn't redraw it twice
let busy = false;
let dashboard = null;
let context;

const cfg = () => vscode.workspace.getConfiguration('spectra');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');

/** The workspace folder to profile: the active editor's, else the first. */
function workspaceDir() {
  const folders = vscode.workspace.workspaceFolders || [];
  const active = vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
  const folder = active || folders[0];
  return folder ? folder.uri.fsPath : null;
}

function requireWorkspace() {
  const dir = workspaceDir();
  if (!dir) vscode.window.showWarningMessage('Spectra: open your project folder first.');
  return dir;
}

/** The CLI to run, refusing a project install too old for the extension. */
async function cliFor(dir) {
  const cli = runner.resolveCli(dir, cfg().get('cliPath'));
  if (cli.source === 'project' && cli.version && !model.atLeast(cli.version, model.MIN_VERSION)) {
    const pick = await vscode.window.showErrorMessage(
      `Spectra: this project has @progen-labs/spectra ${cli.version}; the extension needs ${model.MIN_VERSION} or later.`,
      'Update it',
    );
    if (pick) {
      const term = vscode.window.createTerminal({ name: 'Spectra', cwd: dir });
      term.show();
      term.sendText('npm install --save-dev @progen-labs/spectra@latest');
    }
    return null;
  }
  return cli;
}

// ------------------------------------------------------------------ showing results

function show(resultFile) {
  const dir = workspaceDir();
  if (!dir || !fs.existsSync(resultFile)) return null;
  let view;
  try {
    view = model.viewOf(resultFile, dir);
  } catch (err) {
    output.appendLine(`Could not read ${resultFile}: ${err.message}`);
    return null;
  }
  shown = { file: resultFile, mtime: fs.statSync(resultFile).mtimeMs };

  problems.clear();
  if (cfg().get('problems.enabled')) {
    const byFile = new Map();
    for (const d of view.diagnostics) {
      const diag = new vscode.Diagnostic(new vscode.Range(d.line, 0, d.line, 1000), d.message, SEVERITY[d.severity]);
      diag.source = 'Spectra';
      diag.code = d.code;
      if (!byFile.has(d.file)) byFile.set(d.file, []);
      byFile.get(d.file).push(diag);
    }
    for (const [file, list] of byFile) problems.set(vscode.Uri.file(file), list);
  }

  lensesByFile = new Map();
  for (const l of view.lenses) {
    const key = vscode.Uri.file(l.file).toString();
    if (!lensesByFile.has(key)) lensesByFile.set(key, []);
    lensesByFile.get(key).push(l);
  }
  lensChanged.fire();

  status.text = view.status.text;
  status.tooltip = view.status.tooltip;
  status.backgroundColor = view.status.warn ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  status.show();
  return view;
}

function showLatest() {
  const dir = workspaceDir();
  const latest = dir && model.latestResultFile(dir);
  if (latest) show(latest);
}

// ------------------------------------------------------------------ running Spectra

async function askUrl() {
  const last = context.workspaceState.get('spectra.lastUrl');
  const value = await vscode.window.showInputBox({
    title: 'Spectra: page to profile',
    prompt: 'A page on this machine, e.g. http://localhost:3000/settings. Leave empty and Spectra starts your dev server.',
    value: last !== undefined ? last : cfg().get('url'),
    ignoreFocusOut: true,
  });
  if (value === undefined) return undefined;
  await context.workspaceState.update('spectra.lastUrl', value.trim());
  return value.trim();
}

/** Runs one CLI command with a cancellable progress notification. */
async function run(dir, args, title) {
  const cli = await cliFor(dir);
  if (!cli) return null;
  if (busy) {
    vscode.window.showInformationMessage('Spectra is already running. Wait for it to finish, or cancel it.');
    return null;
  }
  busy = true;
  output.appendLine(`\n$ spectra ${args.join(' ')}   (${runner.describe(cli)})`);
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Spectra: ${title}`, cancellable: true },
      (progress, token) =>
        runner.runSpectra(cli, args, {
          cwd: dir,
          token,
          onOutput: text => output.append(text),
          onLine: line => progress.report({ message: line }),
        }),
    );
  } catch (err) {
    if (!err.cancelled) {
      const pick = await vscode.window.showErrorMessage(`Spectra: ${err.message}`, 'Show output');
      if (pick) output.show(true);
    }
    return null;
  } finally {
    busy = false;
  }
}

function resultPath(dir, kind) {
  const results = path.join(dir, '.spectra', 'results');
  fs.mkdirSync(results, { recursive: true });
  return path.join(results, `vscode-${kind}-${stamp()}.json`);
}

/** Profile the page load; options.url / options.runs skip the prompt (scripts, tests). */
async function profilePage(options = {}) {
  const dir = requireWorkspace();
  if (!dir) return null;
  const url = options.url !== undefined ? options.url : await askUrl();
  if (url === undefined) return null;
  const runs = options.runs || cfg().get('runs');
  const out = resultPath(dir, 'profile');
  const args = ['performance', '--mode', 'load', '--runs', String(runs), '--json', '--out', out];
  if (url) args.push('--url', url);
  const done = await run(dir, args, `profiling ${url || 'your dev server'} (${runs} runs)`);
  if (!done) return null;
  const view = show(out);
  if (!context.workspaceState.get('spectra.baseline')) await context.workspaceState.update('spectra.baseline', out);
  if (!options.quiet && view) {
    const n = view.result.findings.length;
    vscode.window
      .showInformationMessage(
        `Spectra: ${model.formatMs(view.result.summary.tbtMs)} blocking, LCP ${model.formatMs(view.result.summary.lcpMs)}, ${n} finding${n === 1 ? '' : 's'}${done.code === 2 ? ', over budget' : ''}.`,
        'Show problems',
        'Set as baseline',
        'Open dashboard',
      )
      .then(pick => {
        if (pick === 'Show problems') vscode.commands.executeCommand('workbench.actions.view.problems');
        if (pick === 'Set as baseline') context.workspaceState.update('spectra.baseline', out);
        if (pick === 'Open dashboard') openDashboard();
      });
  }
  return { resultFile: out, result: view && view.result };
}

/** Re-profile the baseline's page the same way and compare. */
async function verify(options = {}) {
  const dir = requireWorkspace();
  if (!dir) return null;
  const baseline = context.workspaceState.get('spectra.baseline');
  if (!baseline || !fs.existsSync(baseline)) {
    vscode.window.showInformationMessage('Spectra: profile the page first. Its result becomes the baseline to verify against.', 'Profile page load').then(pick => pick && profilePage());
    return null;
  }
  const base = model.readJson(baseline);
  const out = resultPath(dir, 'profile');
  const args = ['performance', '--mode', base.mode === 'live' ? 'live' : 'load', '--runs', String(base.runs.length), '--json', '--out', out, '--url', base.url];
  if (base.cpuThrottle > 1) args.push('--throttle', String(base.cpuThrottle));
  if (!(await run(dir, args, `re-profiling ${base.url} (${base.runs.length} runs)`))) return null;
  show(out);
  const compared = await run(dir, ['compare', baseline, out, '--json'], 'comparing');
  if (!compared) return null;
  const text = model.compareText(compared.json.comparison);
  output.appendLine(`\n${text.lines.join('\n')}`);
  if (!options.quiet) {
    const notify = text.bad ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    notify(text.short, 'Show details', 'Use as new baseline').then(pick => {
      if (pick === 'Show details') output.show(true);
      if (pick === 'Use as new baseline') context.workspaceState.update('spectra.baseline', out);
    });
  }
  return { comparison: compared.json.comparison, resultFile: out };
}

async function runGoldenPaths(options = {}) {
  const dir = requireWorkspace();
  if (!dir) return null;
  const url = options.url !== undefined ? options.url : await askUrl();
  if (url === undefined) return null;
  const out = resultPath(dir, 'golden-paths');
  const args = ['performance', '--json', '--paths', String(options.paths || cfg().get('goldenPaths')), '--out', out];
  if (url) args.push('--url', url);
  const done = await run(dir, args, 'running golden paths');
  if (!done) return null;
  const view = show(out);
  if (!options.quiet && view) {
    vscode.window.showInformationMessage(`Spectra: ${view.result.passed}/${view.result.total} journeys passed. Findings are in the Problems panel.`, 'Show problems', 'Open dashboard').then(pick => {
      if (pick === 'Show problems') vscode.commands.executeCommand('workbench.actions.view.problems');
      if (pick === 'Open dashboard') openDashboard();
    });
  }
  return { resultFile: out, result: view && view.result };
}

async function setBaseline() {
  const dir = requireWorkspace();
  if (!dir) return;
  const results = path.join(dir, '.spectra', 'results');
  const files = fs.existsSync(results)
    ? fs
        .readdirSync(results)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(results, f))
        .filter(f => {
          try {
            return model.readJson(f).kind === 'profile';
          } catch {
            return false;
          }
        })
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  if (!files.length) {
    vscode.window.showInformationMessage('Spectra: no profile results yet. Run "Spectra: Profile page load" first.');
    return;
  }
  const current = context.workspaceState.get('spectra.baseline');
  const items = files.slice(0, 20).map(f => {
    const r = model.readJson(f);
    return {
      label: path.basename(f),
      description: `${r.url} · ${r.runs.length} runs · TBT ${model.formatMs(r.summary.tbtMs)} · scripting ${model.formatMs(r.summary.scriptingMs)}${f === current ? ' · current baseline' : ''}`,
      file: f,
    };
  });
  const pick = await vscode.window.showQuickPick(items, { title: 'Spectra: baseline to verify against' });
  if (pick) await context.workspaceState.update('spectra.baseline', pick.file);
}

async function openDashboard() {
  const dir = requireWorkspace();
  if (!dir) return;
  if (!dashboard) {
    const cli = await cliFor(dir);
    if (!cli) return;
    try {
      dashboard = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Spectra: starting the dashboard' },
        () => runner.startDashboard(cli, dir, text => output.append(text)),
      );
      dashboard.child.on('exit', () => (dashboard = null));
    } catch (err) {
      vscode.window.showErrorMessage(`Spectra: ${err.message}`);
      return;
    }
  }
  try {
    await vscode.commands.executeCommand('simpleBrowser.show', dashboard.url);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(dashboard.url));
  }
}

function clear() {
  problems.clear();
  lensesByFile = new Map();
  lensChanged.fire();
  shown = null;
  const s = model.statusFrom(null);
  status.text = s.text;
  status.tooltip = s.tooltip;
  status.backgroundColor = undefined;
}

// ------------------------------------------------------------------ MCP for agent mode

/** Offers Spectra's MCP server to VS Code's agent mode (VS Code 1.101+). */
function registerMcp() {
  const lm = vscode.lm;
  if (!lm || typeof lm.registerMcpServerDefinitionProvider !== 'function' || !vscode.McpStdioServerDefinition) return;
  context.subscriptions.push(
    lm.registerMcpServerDefinitionProvider('spectra', {
      provideMcpServerDefinitions: async () => {
        const dir = workspaceDir();
        if (!dir || !cfg().get('mcp.enabled')) return [];
        const cli = runner.resolveCli(dir, cfg().get('cliPath'));
        const tooOld = cli.source === 'project' && cli.version && !model.atLeast(cli.version, '0.3.0');
        const command = tooOld ? 'npx' : cli.command;
        const prefix = tooOld ? ['-y', '@progen-labs/spectra@latest'] : cli.prefix;
        return [new vscode.McpStdioServerDefinition('Spectra', command, [...prefix, 'mcp', '--project', dir])];
      },
    }),
  );
}

// ------------------------------------------------------------------ activation

function activate(ctx) {
  context = ctx;
  output = vscode.window.createOutputChannel('Spectra');
  problems = vscode.languages.createDiagnosticCollection('spectra');
  status = vscode.window.createStatusBarItem('spectra.status', vscode.StatusBarAlignment.Left, 50);
  status.name = 'Spectra';
  status.command = 'spectra.profilePage';
  ctx.subscriptions.push(output, problems, status, lensChanged);

  ctx.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      {
        onDidChangeCodeLenses: lensChanged.event,
        provideCodeLenses: doc => {
          if (!cfg().get('codeLens.enabled')) return [];
          return (lensesByFile.get(doc.uri.toString()) || []).map(
            l =>
              new vscode.CodeLens(new vscode.Range(l.line, 0, l.line, 0), {
                title: l.title,
                tooltip: l.tooltip,
                command: 'spectra.lensInfo',
                arguments: [l],
              }),
          );
        },
      },
    ),
  );

  const commands = {
    'spectra.profilePage': profilePage,
    'spectra.verify': verify,
    'spectra.runGoldenPaths': runGoldenPaths,
    'spectra.setBaseline': setBaseline,
    'spectra.openDashboard': openDashboard,
    'spectra.clear': clear,
    'spectra.lensInfo': l =>
      vscode.window
        .showInformationMessage(`${l.title.replace(/^⚡ /, '')}. ${l.tooltip}.`, 'Verify against baseline', 'Open dashboard')
        .then(pick => {
          if (pick === 'Verify against baseline') verify();
          if (pick === 'Open dashboard') openDashboard();
        }),
    'spectra.showOutput': () => output.show(true),
  };
  for (const [id, fn] of Object.entries(commands)) ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // Results written by the CLI (--out), an AI assistant (MCP) or this extension.
  const watcher = vscode.workspace.createFileSystemWatcher('**/.spectra/results/*.json');
  const onResult = uri => {
    if (!cfg().get('watchResults')) return;
    const fresh = !shown || shown.file !== uri.fsPath || fs.statSync(uri.fsPath).mtimeMs !== shown.mtime;
    if (fresh && !busy) setTimeout(() => show(uri.fsPath), 300); // let the writer finish
  };
  watcher.onDidCreate(onResult);
  watcher.onDidChange(onResult);
  ctx.subscriptions.push(watcher);
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('spectra') && shown) show(shown.file);
    }),
  );

  registerMcp();
  clear();
  const dir = workspaceDir();
  if (dir && fs.existsSync(path.join(dir, 'package.json'))) status.show();
  showLatest();

  // returned API: lets scripts and tests drive the extension
  return { profilePage, verify, runGoldenPaths, show, diagnostics: () => problems, lenses: () => lensesByFile };
}

function deactivate() {
  if (dashboard) dashboard.child.kill();
}

module.exports = { activate, deactivate };
