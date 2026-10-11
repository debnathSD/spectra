# @progen-labs/spectra

**Find out which file, which function and which component makes your frontend slow — automatically.**

Spectra is a CLI and dashboard that profiles a frontend build through the Chrome DevTools Protocol
(tracing + CPU sampling) plus a small in-page probe for component re-renders and Web Vitals. Run one
command and it starts your dev server, auto-discovers the actionable elements on the page, drives a set
of **golden-path journeys**, records each one, and reports a ranked list of culprits — each with the
exact function, file and line, the evidence, and a suggested fix.

Works with **React, Vue, Svelte, Angular and Next.js** builds (component-level attribution is deepest on
React today; a source-mapped generic profile covers the rest). A [Progen Labs](https://github.com/progen-labs)
project — open source, non-profit, no telemetry, no account required.

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
spectra performance [options]   Golden-path evaluation (default)
spectra dashboard [--port N]    Open the dashboard UI
spectra --help                  Full option list
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
| `--mode live\|load` | Classic single-page profile instead of the golden-path suite |

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
