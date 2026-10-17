# Spectra for VS Code

**See the file, function and component that make your frontend slow, at the exact line, and prove each fix
with before/after measurements.** Free and open source, by [Progen Labs](https://github.com/progen-labs).

Spectra drives Chrome against your dev server, records the page, and maps the cost back to your source:
React, Next.js, Vue and Angular components (render counts, render time, wasted renders) and the functions and
files behind long tasks, forced reflows and slow loads. This extension puts those results where you work.

## Features

- **Profile page load** (`Spectra: Profile page load`): records the page three times and reports the medians.
  Leave the URL empty and Spectra starts your dev server for you.
- **Problems at the right line**: every finding appears in the Problems panel and as a squiggle at the file and
  line responsible, with the suggested fix.
- **CodeLens** above the costliest components and functions:
  `⚡ Spectra: Row · 7,200 renders · 1.44 s rendering` or `⚡ Spectra: burn() · 1.43 s own time (92% of CPU)`.
- **Status bar**: blocking time, LCP and scripting time of the last run. Click to profile again.
- **Verify against baseline** (`Spectra: Verify against baseline`): after a change, re-profile the same way and see
  whether it *measurably* helped. A change counts only when it is bigger than the run-to-run noise.
- **Run golden paths**: discover the page's journeys (navigation, clicks, forms, never anything destructive) and
  profile each one.
- **Open dashboard**: the full Spectra dashboard (culprits, page map, call tree, long tasks, compare commits,
  PDFs) in VS Code's Simple Browser.
- **Works with AI assistants**: results that Claude Code, another MCP client or the CLI (`--out`) write to
  `.spectra/results` appear here automatically, and on VS Code 1.101 or later Spectra's MCP server is offered to
  agent mode.

## Requirements

- Node.js 18 or newer, and Chrome, Chromium or Edge (Spectra drives the browser you have).
- Your project's dev server, or a page running on this machine.
- Spectra itself: the extension uses your project's `@progen-labs/spectra` (0.2.0 or later) when it is installed,
  and otherwise runs the latest version with `npx`. To install it:

  ```bash
  npm install --save-dev @progen-labs/spectra
  ```

## Commands

| Command | What it does |
| --- | --- |
| Spectra: Profile page load | Profile the page and show the findings, CodeLens and status |
| Spectra: Verify against baseline | Re-profile the baseline's page the same way and compare |
| Spectra: Choose baseline | Pick which earlier result to verify against |
| Spectra: Run golden paths | Profile the page's discovered user journeys |
| Spectra: Open dashboard | Open the Spectra dashboard inside VS Code |
| Spectra: Clear results | Remove the problems, CodeLens and status |
| Spectra: Show output | The CLI's output, including full comparison details |

## Settings

| Setting | Default | |
| --- | --- | --- |
| `spectra.url` | empty | Page to profile; empty starts your dev server |
| `spectra.runs` | `3` | Recordings per profile (medians are reported) |
| `spectra.goldenPaths` | `6` | Maximum journeys for Run golden paths |
| `spectra.problems.enabled` | `true` | Findings in the Problems panel |
| `spectra.codeLens.enabled` | `true` | CodeLens above components and functions |
| `spectra.watchResults` | `true` | Show results written to `.spectra/results` by the CLI or an AI assistant |
| `spectra.mcp.enabled` | `true` | Offer Spectra's MCP server to agent mode |
| `spectra.cliPath` | empty | Advanced: path to the Spectra CLI |

## Privacy

Everything runs on your machine: no account, no telemetry. Reports are saved in `.spectra/` in your project;
keep it out of git.

## Learn more

- [Documentation](https://progen-labs.github.io/website/#spectra/docs/vscode)
- [Spectra on npm](https://www.npmjs.com/package/@progen-labs/spectra) and [GitHub](https://github.com/progen-labs/spectra)
