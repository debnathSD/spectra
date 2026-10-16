# @progen-labs/spectra

**Find out which file, which function and which component makes your frontend slow — automatically.**

Spectra is a CLI and dashboard that profiles a frontend build through the Chrome DevTools Protocol
(tracing + CPU sampling) plus a small in-page probe for component re-renders and Web Vitals. Run one
command and it starts your dev server, auto-discovers the actionable elements on the page, drives a set
of **golden-path journeys**, records each one, and reports a ranked list of culprits — each with the
exact function, file and line, the evidence, and a suggested fix.

Deep component-level attribution for **React, Next.js, Vue and Angular** (component names, render counts
and per-component render/change-detection time; source files too, where the framework exposes them). For
**Svelte and any other build**, a source-mapped generic profile still pinpoints the slow files and
functions. A [Progen Labs](https://github.com/progen-labs) project — open source, non-profit, no
telemetry, no account required.

## Install

```bash
npm install --save-dev @progen-labs/spectra
```

Requirements: **Node 18+** and a local **Chrome / Chromium / Edge** (Spectra drives your installed
browser; it does not download one). If it can't find Chrome, set `CHROME_PATH` to the executable.

## Quick start

From the root of your project:

```bash
npx spectra performance
```

With no `--url`, Spectra:

1. detects your framework and starts your dev server (`npm run dev`/`start`/`serve`),
2. records a baseline page load,
3. auto-discovers the actionable elements (links, buttons, inputs, forms),
4. synthesizes and runs **golden-path journeys** — safely (see below),
5. prints a performance matrix and saves a report per journey, then stops the server.

```
#  Golden path            Result    TBT    LCP  LongT  Top finding
—  Initial page load      PASS      0ms  128ms      0  [warning] main chunk served uncompressed
1  Click "Pricing"        PASS      0ms      —      0  [warning] Large DOM: 2,139 nodes
2  Click "Folders"        PASS      0ms      —      0  [critical] TreeNode re-rendered 1100× (96% wasted)
...
Automation: 8/8 golden paths passed.
```

Then open the visual dashboard — ranked culprits, React re-renders, long tasks, the golden-path matrix,
**PDF export** and **commit-to-commit compare**:

```bash
npx spectra dashboard
```

## Commands

```
spectra performance [options]       Golden-path evaluation (default)
spectra performance --quick         One page-load profile (about 15 s)
spectra compare <before> <after>    Did it get faster? Noise-aware before/after
spectra reports                     List saved reports
spectra dashboard [--port N]        Open the dashboard UI
spectra --help                      Full option list
spectra --version
```

**`performance` options**

| Option | Description |
| --- | --- |
| `--url <page>` | Evaluate an already-running page; skips self-boot |
| `--paths <n>` | Max golden paths to run (default 12) |
| `--command "<cmd>"` | Override the dev-server command |
| `--boot-timeout <s>` | How long to wait for the dev server (default 60) |
| `--headed` | Show the browser window |
| `--sign-in <url>` | Sign-in URL template, e.g. `http://host/login/?redirect={url}` |
| `--quick` | One page-load profile instead of the golden-path suite: the fast loop |
| `--runs <n>` | Record n times and report the median (with `--quick` or `--mode`) |
| `--mode live\|load` | Classic single-page profile instead of the golden-path suite |
| `--json` | Print a machine-readable result on stdout (tables go to stderr) |
| `--out <file>` | Also write that result to a file (an input for `compare`) |
| `--config <file>` | Budgets file (default: `spectra.config.json` in your project) |

## Measure, change, verify

Performance numbers are noisy, so Spectra never trusts a single recording when you ask it whether a change
helped. Record a few runs before and after, then compare:

```bash
npx spectra performance --quick --runs 5 --out before.json
# …make your change…
npx spectra performance --quick --runs 5 --out after.json
npx spectra compare before.json after.json
```

```
Spectra compare — IMPROVED (confidence: medium)
  ✓ JavaScript CPU time: 1.52 s → 92.1 ms (−94%)
  ✓ Row (src/Row.jsx) — render time: 1.44 s → 7.4 ms (−99%)

Findings: 3 resolved · 2 new · 10 still present
  resolved  [critical] Row is slow to render: 1444ms total, 0.2ms per render (7200×)
```

Each side is reduced to its median, and a difference only counts when it is larger than the run-to-run
spread. A side can be a `--out` result file, a report id from `spectra reports`, a report file, or several
ids joined by commas.

## Budgets and CI

Put limits in `spectra.config.json` at your project root:

```json
{
  "$schema": "./node_modules/@progen-labs/spectra/schema/config.schema.json",
  "budgets": { "tbtMs": 200, "lcpMs": 2500, "cls": 0.1, "criticalFindings": 0 }
}
```

Every `spectra performance` run checks them: the median for `--quick`/`--mode`, every journey for the
golden-path suite. Metrics a recording did not measure are skipped, never failed. Available budgets:
`tbtMs`, `lcpMs`, `fcpMs`, `cls`, `inpMs`, `ttfbMs`, `longTaskCount`, `maxLongTaskMs`, `scriptingMs`,
`forcedLayoutCount`, `domNodes`, `heapUsedMb`, `transferKb`, `criticalFindings`, `findingCount`.

Exit codes make it a CI gate:

| Code | Meaning |
| --- | --- |
| `0` | Done, and within budget |
| `1` | Could not run (no Chrome, server down, bad config) |
| `2` | Ran, but a budget was exceeded, or `compare --fail-on-regression` found a regression |

## Machine-readable output

`--json` prints a small, versioned result on stdout and sends every human-readable line to stderr, so it can
be piped into `jq`, an editor or an AI agent. Each result has `schemaVersion` and a `kind` (`profile`,
`evaluation`, `compare` or `reports`) and points at the full reports on disk rather than embedding them.
Findings carry the file, line, cost in ms and a suggested fix. The format is described by a JSON Schema
shipped with the package (`schema/result.schema.json`); additive changes keep `schemaVersion`, breaking
changes bump it. Saved reports carry their own `schemaVersion` too.

## Safe by default

Auto-exploration never triggers destructive actions. Spectra detects controls that would mutate state —
anything labelled delete / pay / checkout / log out, logout links, and `POST`/`PUT`/`DELETE` form submits —
and **skips** them unless you explicitly allow them. Form fields are filled with synthetic values; GET
searches and navigations are fair game.

## Where results go

Reports are written to `.spectra/reports/` in your project (add it to `.gitignore`). Each golden path is a
full report you can open in `spectra dashboard`, export to PDF, or compare against another commit.

## How it works

Spectra launches Chrome via `puppeteer-core`, records a CDP trace + CPU profile, and injects a probe that
tracks component renders, slow interactions and Web Vitals. It maps sampled frames back to your source
through source maps (and bundler markers as a fallback), then ranks the files, functions and components
that cost the most main-thread time. See the
[deep-dive docs](https://github.com/progen-labs/spectra/blob/main/DOCS.md) for how capture, correlation
and report generation work.

## License

MIT © Progen Labs
