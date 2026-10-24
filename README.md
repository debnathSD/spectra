<h1 align="center">Spectra</h1>

<p align="center">
  <b>Make your web app faster. Ask your AI agent, or run one command.</b>
  <br>
  <sub>React · Next.js · Vue · Angular · Svelte · any web frontend &nbsp;|&nbsp; Claude Code · Cursor · Copilot · Codex · Gemini · VS Code · CI</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@progen-labs/spectra"><img alt="npm version" src="https://img.shields.io/npm/v/@progen-labs/spectra?style=flat-square&color=0a84ff&label=npm"></a>
  <a href="https://github.com/progen-labs/spectra/actions/workflows/checks.yml"><img alt="tests" src="https://img.shields.io/github/check-runs/progen-labs/spectra/main?nameFilter=Tests%20%28Node%2022%2C%20ubuntu-latest%29&style=flat-square&label=tests"></a>
  <a href="https://www.npmjs.com/package/@progen-labs/spectra"><img alt="Downloads" src="https://img.shields.io/npm/dm/@progen-labs/spectra?style=flat-square&color=0a84ff"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/@progen-labs/spectra?style=flat-square&color=0a84ff"></a>
</p>

<p align="center">
  <a href="https://progen-labs.github.io/website/#spectra/docs/improve"><b>Documentation</b></a>
  &nbsp;·&nbsp;
  <a href="https://progen-labs.github.io/website/#spectra/demo"><b>2½-minute demo</b></a>
  &nbsp;·&nbsp;
  <a href="#get-started">Get started</a>
  &nbsp;·&nbsp;
  <a href="#measure-without-changing-anything">Measure only</a>
  &nbsp;·&nbsp;
  <a href="#project-health">Project health</a>
</p>

Spectra runs your app in Chrome, measures it, and finds the problems in **your own code**: the exact file, function,
line and component, with a suggested fix. Then it has each problem fixed, measures the change, and keeps only what
measurably helped. It works with the AI coding agent you already use, or on its own. Everything runs on your
machine: no account, no telemetry, no uploads. A [Progen Labs](https://github.com/progen-labs) project, free and
open source.

## Get started

**1. Install.** Node.js 22.12 or newer and a local Chrome, Chromium or Edge (Spectra drives the browser you have).

```bash
npm install --save-dev @progen-labs/spectra
npx spectra
```

`npx spectra` sets things up: it teaches your AI coding agent what Spectra does, in the file the agent reads for
your project (`AGENTS.md`, a Claude Code skill, Copilot instructions, a Cursor rule…). Nothing happens at install time.

**2. Ask your agent.** In Claude Code, Cursor, GitHub Copilot, Codex, Gemini CLI, Windsurf or any other coding agent,
in plain words:

> improve the performance

The agent runs Spectra's loop. Spectra measures the app and names the first problem: file, line, cost, suggested fix.
The agent makes that one change. Spectra runs your checks, measures again, and says **keep** or **undo**. Repeat.
Then the agent tells you what got faster, with the before → after numbers, and what it tried that didn't help.

Or let Spectra do the whole thing unattended, with a coding agent installed on your machine:

```bash
npx spectra improve
```

It finds the agent (Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor, OpenCode or Amp; `--agent` to choose),
works in a copy of your last commit, and puts the kept fixes on a branch, one commit each, with the measurements in
the commit messages. Your own files are never touched.

**3. Review.** The changes are in your working tree (`git diff`) or on the branch (`git log -p HEAD..spectra/improve-…`).
Commit, or merge, and you're done.

## What a session looks like

The guided loop on Spectra's React demo app. Each step is one short command, so any agent can drive it:

```
$ npx spectra improve next
spectra: measuring the baseline (3 page loads) …
Problem 1 of 5: Row is slow to render: 1442ms total, 0.2ms per render (7200×)
  Where: src/Row.jsx:3
  Cost: about 1.44 s, seen in 3 runs
  Where the time went:
    Row() in src/Row.jsx:3: 1.44 s (slow render)
  Suggested fix: Move expensive calculations into useMemo, virtualise long lists, …

Make ONE focused change in src/Row.jsx that removes or reduces this cost, keeping the behaviour exactly the same …
Then run:  npx spectra improve check

$ npx spectra improve check            # after the agent's change
spectra: running the checks (npm test) …
spectra: measuring the change …
✓ Kept: JavaScript CPU time: 1.55 s → 162 ms (−90%)
  also Row (src/Row.jsx) — render time: 1.44 s → 35.4 ms (−98%)
  Checks passed: npm test.
  Keep this change.

Problem 2 of 4: App rendered 60× (19/s)
  Where: src/main.jsx:15
  …

$ npx spectra improve check            # after a change that did nothing
✗ Undo this change: no measurable improvement: every change was within run-to-run noise.
  Revert the files you changed for this problem (and only those), then continue.

$ npx spectra improve report
Spectra improve — 1 of 2 problems fixed
  ✓ fixed       Row is slow to render … (src/Row.jsx:3): JavaScript CPU time: 1.55 s → 162 ms (−90%)
  ✗ undone      App rendered 60× (19/s) (src/main.jsx:15) — no measurable improvement
Overall, before → after: IMPROVED (confidence: medium)
  ✓ JavaScript CPU time: 1.55 s → 162 ms (−90%)
  ✓ Row (src/Row.jsx) — render time: 1.44 s → 35.4 ms (−98%)
```

## How it decides

Spectra makes every decision; the agent only edits.

- **Measured, not guessed.** Three page loads before and after each change, reduced to medians. A change counts
  only when it is bigger than the run-to-run noise, so a lucky run never decides.
- **Your checks first.** Your `test`, type-check and `build` scripts (or `--check "<cmd>"`) must pass after every
  change. A faster page that breaks is undone.
- **Your code only.** Problems in `node_modules` are reported, not fixed. A new critical problem in your own code
  undoes a change; a vendor chunk renamed between builds does not.
- **One change at a time, in order of cost.** A fix that also clears other problems skips them.
- **Unattended, in isolation.** A git worktree of your last commit with its own dev server; changes to
  `package.json`, lockfiles, configuration, tests or CI, deletions, or more than 150 lines are refused; nothing is
  pushed or merged.

The rules are Spectra's code, checked by a [test bench](https://progen-labs.github.io/website/#spectra/docs/harness-bench)
in CI: a real fix must be kept, a "faster" page that renders nothing must be caught, a cosmetic change must not count.
See [How improve decides](https://progen-labs.github.io/website/#spectra/docs/harness).

## What it works with

| | |
| --- | --- |
| **Frameworks** | Component names, render counts and timings for **React, Next.js, Vue and Angular**; source-mapped files and functions for **Svelte, SolidJS and any other build**. Detected in the page itself. |
| **AI agents** | Any agent that reads `AGENTS.md` (Codex, Copilot's coding agent, Cursor, Windsurf, Zed, Jules, Amp…), plus Claude Code (a skill), GitHub Copilot (instructions), Cursor, Windsurf, Cline, Roo Code and Gemini CLI, each in its own file. MCP clients get the loop as tools (`improve_next`, `improve_check`, `improve_report`); there is a [Claude Code plugin](https://progen-labs.github.io/website/#spectra/docs/claude-code). |
| **Unattended** | Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI, Cursor CLI, OpenCode, Amp, or any command of yours. |
| **Editors** | The [VS Code extension](https://marketplace.visualstudio.com/items?itemName=progen-labs.spectra-performance) shows each finding at its line and render counts above components. |
| **CI** | The [GitHub Action](https://progen-labs.github.io/website/#spectra/docs/github-action) profiles every pull request against its base commit and enforces your budgets. |
| **Apps behind a login** | Spectra [signs in first](https://progen-labs.github.io/website/#spectra/docs/signing-in): a login form (one or two steps, single sign-on, authenticator codes), you in the browser window, the browser prompt, a token or cookie, or a sign-in link. Secrets stay in memory. |

## Measure without changing anything

```bash
npx spectra performance                  # starts your dev server, finds the page's buttons, links and
                                         # forms, runs safe user journeys through them, reports each one
npx spectra performance --quick --runs 3 # one page, three loads, medians: the fast loop
npx spectra dashboard --open             # the visual dashboard: culprits, page map, call trees, PDFs
```

```
#  Golden path            Result    TBT    LCP  LongT  Top finding
—  Initial page load      PASS      0ms  128ms      0  [warning] main chunk served uncompressed
1  Click "Pricing"        PASS      0ms      —      0  [warning] Large DOM: 2,139 nodes
2  Click "Folders"        PASS      0ms      —      0  [critical] TreeNode re-rendered 1100× (96% wasted)
Automation: 8/8 golden paths passed.
```

![The Spectra dashboard: the top culprit of a recording, burn() in src/heavy.js, with its time and a suggested fix](docs/dashboard.webp)

Prove a change yourself with `npx spectra performance --quick --runs 5 --out before.json`, the same with `after.json`,
then `npx spectra compare before.json after.json`. Put limits in `spectra.config.json` and every run becomes a CI gate
(exit code 2 when over budget). `--json` prints a versioned result for scripts and editors. See
[Measure a page](https://progen-labs.github.io/website/#spectra/docs/cli-performance),
[Compare](https://progen-labs.github.io/website/#spectra/docs/compare),
[Budgets and CI](https://progen-labs.github.io/website/#spectra/docs/budgets) and
[JSON output](https://progen-labs.github.io/website/#spectra/docs/json-output).

## Commands

```
spectra improve [options]               Make the app faster, unattended (spectra improve --help)
spectra improve next|check|report|stop  The same, step by step, for your AI agent or you
spectra performance [options]           Measure only: golden-path journeys, or --quick
spectra compare <before> <after>        Did it get faster? Beyond run-to-run noise
spectra reports                         List saved reports
spectra dashboard [--open]              The dashboard UI
spectra mcp [--project <dir>]           MCP server for AI tools (stdio)
spectra agents [--remove]               Teach your AI agents what Spectra does
spectra --help                          Every option
```

Everything Spectra does runs on your machine, in a separate Chrome profile, on a development build (production
builds hide component timings). Reports go to `.spectra/` in your project; keep it out of git. Automatic exploration
never clicks delete, pay or log out, and never submits a form that changes data.

## Project health

<p align="center">
  <a href="https://github.com/progen-labs/spectra/actions/workflows/checks.yml"><img alt="tests" src="https://img.shields.io/github/check-runs/progen-labs/spectra/main?nameFilter=Tests%20%28Node%2022%2C%20ubuntu-latest%29&style=flat-square&label=tests"></a>
  <a href="https://github.com/progen-labs/spectra/actions/workflows/checks.yml"><img alt="lint" src="https://img.shields.io/github/check-runs/progen-labs/spectra/main?nameFilter=Lint&style=flat-square&label=lint"></a>
  <a href="https://github.com/progen-labs/spectra/actions/workflows/checks.yml"><img alt="npm audit" src="https://img.shields.io/github/check-runs/progen-labs/spectra/main?nameFilter=npm%20audit&style=flat-square&label=npm%20audit"></a>
  <a href="https://github.com/progen-labs/spectra/actions/workflows/checks.yml"><img alt="snyk" src="https://img.shields.io/github/check-runs/progen-labs/spectra/main?nameFilter=Snyk&style=flat-square&label=snyk"></a>
  <a href="https://socket.dev/npm/package/@progen-labs/spectra"><img alt="Socket" src="https://socket.dev/api/badge/npm/package/@progen-labs/spectra"></a>
  <a href="https://github.com/progen-labs/spectra/actions/workflows/checks.yml"><img alt="size budget" src="https://img.shields.io/github/check-runs/progen-labs/spectra/main?nameFilter=Size%20budget&style=flat-square&label=size%20budget"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/progen-labs/spectra"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/progen-labs/spectra/badge?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@progen-labs/spectra?activeTab=code"><img alt="unpacked size" src="https://img.shields.io/npm/unpacked-size/@progen-labs/spectra?style=flat-square&label=unpacked&color=0a84ff"></a>
</p>

Every pull request and push to `main` runs the same checks, and **spectra-bot** reports them in one comment on each
pull request: the tests on Node 22, 24 and 26 across Linux, macOS and Windows with a coverage floor, lint, `npm audit`
and Snyk, Socket's supply-chain score, size budgets, the links in the docs, the improve bench, the GitHub Action on the
demo app, CodeQL and the OpenSSF Scorecard. Every action is pinned to a commit, and CI installs from the committed
lockfile. Releases carry a changelog, the package, its SBOM and signed build attestations. See
[CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) and, for security issues, [SECURITY.md](SECURITY.md).

## Documentation

- **[The guide](https://progen-labs.github.io/website/#spectra/docs/improve)**: start with
  [Improve the performance](https://progen-labs.github.io/website/#spectra/docs/improve) and
  [Your AI agent](https://progen-labs.github.io/website/#spectra/docs/agents); then
  [Measure a page](https://progen-labs.github.io/website/#spectra/docs/cli-performance),
  [Budgets and CI](https://progen-labs.github.io/website/#spectra/docs/budgets),
  [MCP server](https://progen-labs.github.io/website/#spectra/docs/mcp-server),
  [How improve decides](https://progen-labs.github.io/website/#spectra/docs/harness), the
  [Findings reference](https://progen-labs.github.io/website/#spectra/docs/findings) and
  [Troubleshooting](https://progen-labs.github.io/website/#spectra/docs/troubleshooting).
- **[DOCS.md](DOCS.md)**: the in-repo manual, the technical deep dive, and how to contribute.

## License

MIT © 2026 Sourav Debnath (Progen Labs)

<p align="center">
  <a href="https://progen-labs.github.io/website/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://progen-labs.github.io/website/brand/progen-seed-mark.svg">
      <img alt="Progen Labs" src="https://progen-labs.github.io/website/brand/progen-seed-mark-light.svg" height="72">
    </picture>
  </a>
  <br>
  <sub>Spectra is a <a href="https://progen-labs.github.io/website/">Progen Labs</a> project: independent, open source, always free.</sub>
</p>
