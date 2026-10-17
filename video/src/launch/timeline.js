// The launch film is cut to the music: 64 bars at 128 BPM after a two-beat
// pickup, about two minutes. Chapters start on bar lines.
import { PICKUP, beats } from '../theme.js';

/** The frame where bar n starts (bar 0 is the first downbeat). */
export const bar = n => beats(PICKUP + n * 4);

export const CHAPTERS = [
  { id: 'open', from: -0.5, to: 4 },
  { id: 'problem', from: 4, to: 8 },
  { id: 'mcp', from: 8, to: 16, title: 'MCP server', n: '01' },
  { id: 'claude', from: 16, to: 24, title: 'Claude Code plugin', n: '02' },
  { id: 'vscode', from: 24, to: 32, title: 'VS Code extension', n: '03' },
  { id: 'npm', from: 32, to: 36 },
  { id: 'cli', from: 36, to: 52, title: 'The CLI', n: '04' },
  { id: 'frameworks', from: 52, to: 56 },
  { id: 'open-source', from: 56, to: 60 },
  { id: 'end', from: 60, to: 64.6 },
];
export const DURATION = bar(64.6);
export const MUSIC = { musicEnd: bar(60), musicBreaks: [[32, 36]], poster: bar(2.4) };

// the CLI chapter: one bar for its title, then ten features of six beats each
export const CLI_FEATURES = [
  { scene: 'one-command', shift: 470, title: 'One command', body: 'npx spectra performance starts your dev server, profiles the app and shuts it down.', you: 'No setup, no config to write.', users: 'It measures what they actually do.' },
  { scene: 'journeys', title: 'Real user journeys', body: 'Finds the buttons, links and forms on the page and drives safe golden paths through them.', you: 'Every flow tested, without writing a script.', users: 'Slow clicks are caught, not just slow loads.' },
  { scene: 'culprit', title: 'The exact culprit', body: 'Every finding names the function, file and line, with the evidence and a fix.', you: 'Jump straight to the line that matters.', users: 'The real bottleneck gets fixed first.' },
  { scene: 'components', shift: 380, title: 'Component insight', body: 'Render counts, render time and wasted renders for every component.', you: 'See why a component re-rendered.', users: 'Fewer wasted renders, smoother pages.' },
  { scene: 'proof', title: 'Proof, not guesses', body: 'spectra compare reports what changed between runs, beyond the noise.', you: 'Know a fix worked before you ship it.', users: 'Only real wins reach production.' },
  { scene: 'budgets', title: 'Budgets that hold', body: 'Set limits in spectra.config.json; a run over budget exits with code 2.', you: 'Performance rules your build enforces.', users: 'The app never quietly gets slower.' },
  { scene: 'pull-requests', title: 'Pull request checks', body: 'The GitHub Action profiles each pull request against its base and posts the verdict.', you: 'Regressions show up in review.', users: 'Slowdowns are stopped before release.' },
  { scene: 'dashboard', title: 'Visual dashboard', body: 'Culprits, a page map, the call tree, long tasks and commit comparisons.', you: 'Explore every run visually, locally.', users: 'Problems are understood, then fixed.' },
  { scene: 'json', title: 'JSON for any tool', body: 'A versioned, schema-described result for scripts, dashboards and AI agents.', you: 'Wire it into anything you already use.', users: 'Performance tracked everywhere it matters.' },
  { scene: 'safe', title: 'Safe by default', body: 'Never clicks delete, pay or log out, and never submits a form that changes data.', you: 'Point it at any app without worry.', users: 'Their data is never touched.' },
];
export const CLI_FEATURE_BEATS = 6;
