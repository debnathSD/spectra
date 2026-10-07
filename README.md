# Spectra

Find out **which file, which function and which React component** makes a frontend app slow.

You point it at the app running in your browser, press **Record**, use the page, press **Stop** — and it gives you a
ranked list of culprits, each with the exact function, file and line, the evidence, and a suggested fix. It drives a
real Chrome through the Chrome DevTools Protocol (tracing + CPU sampling) and adds a small in-page probe for React
re-renders and browser vitals.

- [Requirements](#requirements)
- [One-time setup](#one-time-setup)
- [Every time you profile](#every-time-you-profile)
- [Your first recording](#your-first-recording)
- [Signing in](#signing-in)
- [Appearance and themes](#appearance-and-themes)
- [Reading the report](#reading-the-report)
- [Comparing two commits (PR review)](#comparing-two-commits-pr-review)
- [Recording tips](#recording-tips)
- [Troubleshooting](#troubleshooting)
- [Command line](#command-line-ci-and-scripted-scenarios)
- [Configuration](#configuration)
- [How it works and how accurate it is](#how-it-works-and-how-accurate-it-is)
- [Technical deep dive: capture, correlation and report generation](#technical-deep-dive-capture-correlation-and-report-generation)
- [Privacy and safety](#privacy-and-safety)
- [Project layout and contributing](#project-layout-and-contributing)

---

## Requirements

| Need | Details |
| --- | --- |
| **Node 18 or newer** | ⚠️ Some frontends may pin an older Node version; this tool needs **Node 18+** (Vite 5, puppeteer-core). Use a separate terminal for it. With nvm: `nvm install 18 && nvm use` inside this folder (there is a `.nvmrc` here). |
| **Google Chrome** | Also works with Chromium or Microsoft Edge. Found automatically on macOS, Linux and Windows; otherwise set `CHROME_PATH` (see [Configuration](#configuration)). |
| **The frontend running locally** | The frontend development server (your app's dev server), e.g. `http://localhost:3000` or any host/port your app uses. See step 2 below. |
| A login for that app | You will sign in once per launch — see [Signing in](#signing-in). |

> **Profile a development build.** Production builds are minified and carry no per-file information, and React only
> reports render timings in development mode. Dev builds are slower than production, so trust the *ranking* of what is
> slow rather than the absolute milliseconds.

## One-time setup

```bash
cd performance-profiler
nvm use            # or otherwise make sure `node -v` prints v18 or newer
npm install        # standalone: it has its own package.json and is not part of any app
npm test           # optional sanity check: should end with "# fail 0"
```

Want to check the tool works before pointing it at your app? Run the bundled demo app, which has deliberate performance
bugs (a 260 ms click handler, a memoised component that receives fresh props, a component that re-renders for nothing,
layout thrashing, a layout shift):

```bash
npm run demo       # terminal A: serves the demo on http://localhost:5188
npm run dev        # terminal B: the profiler UI on http://localhost:5178
```

Open the profiler, launch Chrome with page `http://localhost:5188/`, record for a few seconds while clicking the demo's
buttons, and you should see each bug named in **Culprits**.

## Every time you profile

You need three things running. Use three terminals.

**1. Backend** — however you normally start your backend locally (e.g. an API server).

**2. Frontend dev server** (your app's dev server, usually running on a port like `3000`):

```bash
# Run your app's dev server (example):
npm run dev               # e.g. http://localhost:3000
```

Wait until your frontend dev server finishes compiling; open it in your normal browser once to confirm the app loads.

**3. The profiler** (Node 18+, in this folder `performance-profiler/`):

```bash
npm run dev               # http://localhost:5178   (PORT=5190 npm run dev to change the port)
```

Open <http://localhost:5178> in any browser. That page is the *control panel*; the app you are profiling opens in a
**separate Chrome window** that the tool launches for you.

## Your first recording

1. **Fill in the connect card** at the top of the profiler page:
  - **Page to profile** — the page you want to measure, e.g. `/path/to/page/` or `http://localhost:3000/path/to/page`.
   - **Sign-in URL** *(optional but recommended)* — open **Advanced** and enter your app's login URL with `{url}` where the page goes. For example:
    `http://localhost:3000/login/?redirect={url}`. Details in [Signing in](#signing-in).
     remembered next time. **Advanced** also holds **Headless** and **Attach to a running Chrome**.
2. Click **Launch Chrome**. A new Chrome window opens, signs in and loads your page. Wait until the page has fully
   rendered. The session card now has two rows: the page (browser tab, URL, **Go**, **Reload**, a green
   **✓ React 17.x** pill, **Close Chrome**) and the recording controls.
   - Amber “**! No React seen — reload**”? Press **Reload** once (the probe has to be installed before React loads).
3. Choose what to measure:
   - **● Record interaction** — press it, then *use the page in the Chrome window*: open a dashboard, scroll, type in the
     editor, switch tabs, open menus. Press **■ Stop & analyse** after **10–30 seconds**.
   - **Record page load** — reloads the page with the cache disabled and stops on its own a few seconds after the load
     event. Use this for startup cost, FCP and LCP.
   - **Options** — **CPU throttling** (4× / 6×) makes problems visible that your fast laptop hides; **Save raw trace
     for DevTools** keeps the trace for [Chrome's Performance panel](#recording-tips).
4. After a few seconds of analysis the **report opens automatically**. Start on the **Culprits** tab.
5. When you are done click **Close Chrome** (or just stop the profiler with Ctrl+C).

Every report is saved in `reports/` (git-ignored) and can be reopened from the drop-down at the top right, so you can
compare before and after a fix. **Delete** removes the selected one.

## Signing in

The Chrome window starts **signed out every time**. Apps normally use *session* cookies, and Chrome throws those away
when it closes — even though the tool keeps its profile in `.chrome-profile/`. Choose one of:

- **Sign-in URL (recommended).** Enter it once next to *Page to profile*. The tool opens your page directly; only if
  that fails or lands on a login screen does it sign in through the Sign-in URL and continue to the page. If you are
  already signed in it is not used. It also applies when you press **Go** in the toolbar.

  ```
  http://localhost:3000/login/?redirect={url}
  ```

  `{url}` is replaced with the (URL-encoded) path and query of the page to profile. On the CLI: `--sign-in "…{url}"`.

- **Sign in by hand** in the Chrome window after it opens, then continue.

Why `?browser=island` here: some local login routes pick tokens from specific query parameters. Adjust the Sign-in URL for
your app if it requires a special parameter. Do not include tokens in the URL. The token stays in the backend; **the
profiler never asks for, stores or logs a token or password**, and the Sign-in URL must not contain one.

If the page still answers with an HTTP error, the toolbar shows a red banner and the report starts with a critical
**“The page itself failed to load”** finding, because a recording of an error page tells you nothing about your app.

## Reading the report

Start with **Culprits**; use the other tabs to dig in. Switch on **Hide node_modules** (top right) to concentrate on your own code.
Above the tabs, the report bar shows what was recorded (mode, duration, CPU slowdown, source attribution, git commit) and holds **Snapshot for comparison** and **Trace for Chrome DevTools**.

### Culprits tab

1. **Top culprits sphere** — the (at most) 12 functions that cost the most, as labels on a slowly rotating sphere:
   label size shows time, colour shows severity (red critical, amber warning, blue note; the icon/word is always shown
   as well). **Drag** to spin it; hovering a label pauses the rotation. Next to it is the same list ranked, which is
   easier to read exactly, and an **insight card** for the hovered (or clicked) culprit: file and line with an
   **↗ editor** link, its time, how many findings it appears in, **What to do**, and **Show the finding**, which
   jumps to and expands that finding below. It is built from the findings' exact culprits, topped up with the
   slowest functions, and honours **Hide node_modules**. The rotation is off if your system asks for reduced motion.
2. **Vital signs** — four headline cards (**total blocking time, longest task, slowest interaction, wasted React
   renders**), each with a big value, a rating (**Good / Needs work / Poor**, as icon + label, not only colour) and a
   gauge whose coloured zones are the good / needs-work / poor ranges, with the actual value as a needle and the
   thresholds written underneath. The remaining six — LCP, FCP, layout shift, DOM nodes, JS heap growth, forced
   reflows — are compact one-line chips. LCP and FCP only appear for *page-load* recordings.
3. **Where main-thread time went** — one bar split into scripting, layout, style, paint, garbage collection,
   compile/parse and other.
4. **Slowest functions** — the top functions by time spent *in the function itself*, with file and line and an
   **↗ editor** link that opens VS Code at that spot.
5. **Findings** — the ranked list of concrete problems, built to be scanned:
   - **One line each**: severity badge (✕ / ! / i), title, file, category and an impact bar. Click a line to expand it
     (the first one starts open); **Expand all / Collapse all** are in the toolbar.
   - **Root causes are grouped.** Findings whose main culprit is the same function (typically many long tasks all
     caused by one library call) become one row, e.g. “`e.insertRule()` is behind 3 findings”, with the findings it
     causes nested inside. The row's impact is the *largest* of its members, not a sum, because they often overlap.
   - **Expanded**, a finding reads top-down: **What to do** (the fix, highlighted), **Why it matters** (the
     evidence), then a table of the exact culprits — `functionName()`, `path/to/File.tsx:line` and its time.
   - **Filters**: All / Critical / Warnings / Notes (with counts) and a category drop-down.

Findings you will commonly see:

| Finding | What it means | Typical fix |
| --- | --- | --- |
| **Long task** (with trigger, e.g. “click handler”) | JavaScript blocked the main thread for > 50 ms; the culprit box names the functions that consumed it. | Chunk the work, memoise, move it off the main thread. |
| **Component re-rendered N× with nothing changed** | React ran the component although props, state and context were identical. | `React.memo`, or stop the parent re-rendering. |
| **Component gets a new function/object for “prop” on every render** | The value is recreated each render with identical code/contents, which defeats `React.memo` and re-triggers effects. | `useCallback` / `useMemo`, or hoist it out. |
| **Forced reflow in `fn()`** | Code read layout (`offsetHeight`, `getBoundingClientRect`…) right after changing the DOM, forcing a synchronous layout. Repeated in one task it is *layout thrashing*. | Batch reads before writes; use ResizeObserver. |
| **Library X used N ms** | The library isn't slow by itself; the culprit box shows the app function that calls into it most. | Call it less often / with less data. |
| **Slow request / uncompressed / very large resource** | Network findings, with the URL. | Cache, compress, split. |
| **Setup: page failed / almost nothing ran** | The recording itself was not useful (error page, or you didn't interact). | See [Signing in](#signing-in) / [Recording tips](#recording-tips). |

**Reading the line numbers.** `File.ts:102` is exact (from a source map). `File.ts:≈102` with “line found by name”
means the dev bundle has no source map, so the tool located the function's *definition* by searching the real file for
its name — the file and function name are exact, the line is a best-effort match. **Anonymous callbacks** are labelled
after the function they live in, e.g. `(anonymous in rebuildShadowStrips)()`.

**Minified code.** Functions named `n()`, `t()` in files such as `packages/…/dist/index-XXXX.js` come from *pre-built,
minified bundles* checked into the repo. They can't be mapped back to source, but the tool still tells you which
bundle it is and how much time it costs; the call tree shows which app code calls into it.

### Other tabs

- **Page map** — a screenshot of the page *as it was when you pressed Stop*. The slowest React components are
  pointed out with **numbers in the left and right margins**, each joined by a thin line to its element (faintly
  outlined on the page). The numbers are spaced so they never overlap, however deeply the elements are nested, and only
  the numbers react to the pointer, so the map stays responsive. **Hover or focus a number** (or its row in the list on
  the right) to highlight that element and open a card with the component's file and line, self time, renders, wasted
  renders, why it rendered and a suggested fix; **click** it to open the source. Orange = most time, amber = mostly
  wasted renders, blue = minor. Limits: it needs a **React development build** and a recording made with this
  version of the tool (older reports show a “No page map” message); it shows the **viewport**, not the whole
  scrollable page; when a component appears many times only its largest instance is pointed out; page-sized
  wrappers are left out because they say nothing about where the time goes. It shows only what rendered *during the
  recording*.
- **File tree** — every folder and file is **coloured and sized by heat**, hottest first, with the paths to the top
  culprits pre-expanded. Choose the metric: CPU self time, main-thread blocking, React render time, wasted renders,
  render count, forced reflows. Click a folder to expand, a file to open the side panel (its functions, its React
  components, its source with hot functions marked in the gutter). Wheel scrolls, **Ctrl/Cmd + wheel** or pinch zooms.
  Dashed circles are library code.
- **Call tree** — top-down call paths with total and self time; opens on the function with the most self time. Click a
  circle to expand/collapse, a label to open its file.
- **React** — every component that rendered: renders, **wasted** renders, self time, average and slowest render.
  Click a row for *why it rendered* (props / state / hooks / context / parent) and which props changed, including the
  ones recreated with identical contents.
- **Long tasks** — a timeline of main-thread tasks and every task ≥ 50 ms with its trigger, a scripting/layout/style/
  paint/GC breakdown, and its top files and functions. Below: **forced reflows** with the guilty line.
- **Network & memory** — slowest / largest / uncompressed / repeated requests, layout shifts and the elements that
  moved, DOM node count, event listeners, heap growth.

## Comparing two commits (PR review)

The **Compare commits** tab answers the reviewer's question: *“after this developer's commit, what got better, what got
worse, and what stayed the same?”* It diffs two groups of recordings — one taken on the base commit, one on the commit under
review — shows the commit hash, **author**, date and message of each, and exports the result as a **PDF** (a short summary
or a detailed report).

### The workflow

1. **Base commit.** Check out the commit before the change (`git checkout <base>`), restart the dev server, and record the
   scenario **three times** (same page, same mode, same CPU setting). *Page load* mode is the most repeatable; for
   interaction recordings perform exactly the same actions each time.
2. On each recording press **Snapshot for comparison** (bar above the tabs). A small dialog shows the commit that was
   checked out when you recorded — hash, author, message — which you can correct by typing another hash and pressing
   **Look up**. Add an optional *scenario label* and **Download snapshot**. The file is named after the commit so it is
   recognisable later:

   ```
   perf_3fa516cd22_load_20261001-073209_dashboard-579.json
        └ commit ┘ └mode┘ └ date-time ┘ └ scenario label ┘
   ```
3. **Commit under review.** Check out the PR commit, restart the dev server, record the same scenario three times and
   download a snapshot of each.
4. Open the **Compare commits** tab. Upload the base snapshots on the **Before** side and the PR snapshots on the **After**
   side (drag and drop, or *Upload snapshot(s)*; several files at once is fine). If a file carries no commit information the
   hash is read from its file name and the author is looked up for you. Reports recorded on this machine can also be added
   straight from the drop-down, so the CLI (`npm run profile …`) works for repeatable runs without any snapshot step.
5. Read the verdict, then press **PDF summary** (for the PR description) or **PDF detailed report** (for the record).

> Why snapshots and not raw traces? A raw Chrome trace has no React data and no source-file attribution; the profiler
> *report* (which is what a snapshot is) holds everything that gets compared. Snapshots are small (typically < 1 MB).

### What you see

- **Commits** — each side's hash, author, date, message, branch, and a warning if it was recorded with **uncommitted
  changes** (the hash then may not describe exactly what was measured). Only the author's *name* is read from git, never
  the email. **⇄** swaps the sides.
- **Verdict** — *Improved*, *Regressed*, *Mixed* or *No significant change*, with a **confidence** level, and counts of
  metrics that improved / degraded / stayed the same. The verdict is decided only by the **key** metrics: total blocking
  time, long tasks, slowest interaction, LCP, layout shift, JavaScript CPU time, forced reflows, wasted React renders and
  JS heap growth. *Improved* = some improved and none degraded; *Regressed* = some degraded and none improved; *Mixed* = both.
- **Highlights** — the biggest moves in plain sentences, e.g. `Total blocking time: 423 ms → 61.4 ms (−85%)` or
  `Row (src/Row.jsx) — renders: 14,400 → 0 (−100%)`.
- **Can this comparison be trusted?** — checks that the two sides are comparable: same page, same mode, same CPU
  throttling, similar recording length, enough runs (3+ per side), React timings present, same file-attribution mode, no
  error pages, no near-idle recordings, no uncommitted changes, and not the same commit on both sides.
- **Metrics** — about 27 metrics in groups (responsiveness, loading, CPU and main thread, layout work, React, memory and DOM,
  network), each with before, after, change, a small bar and an **Improved / Degraded / Unchanged** label. Filter by result.
  Lower is better for every one of them.
- **What changed, in detail** — for **React components**, **files** and **functions**: what degraded, what is mixed, what
  improved, what is *newly active* (a new cost) and what is *no longer active* (a cost that went away, e.g. a component that
  stopped re-rendering after `React.memo`). Every row says exactly which sub-metric moved (renders, wasted renders, render
  time, CPU, blocking time, forced reflows…). Plus **Problems**: findings that are *new*, *resolved* or *persisting*, with
  the exact function and file, matched across recordings by identity rather than by position.

### How a change is decided

Performance numbers are noisy, so a single difference proves little. For each metric:

- With several runs per side, the **median** is used.
- A difference counts only if it is bigger than **all three** of: the metric's **absolute floor** (for example 50 ms for
  blocking time — a few ms is never a regression), its **relative floor** (for example 10%), and the **run-to-run spread**
  seen on either side. Everything else is *Unchanged*.
- A finding exists on a side only if it appears in at least half of that side's runs.
- Metrics that were not measured on both sides (for example LCP in an interaction recording) are shown as *not measured*,
  never as unchanged.

The floors are listed in the methodology appendix of the detailed PDF and live in `shared/compare.js` (`METRICS`,
`SUBS`) if your team wants to tune them.

### The PDF

Both variants are rendered by the headless Chrome this tool already needs (no extra install), on your machine; nothing is
uploaded anywhere. The file is named `perf-compare_<before>_<after>_<summary|detailed>.pdf`.

| | **Summary** (≈ 4 pages) | **Detailed report** (≈ 10 pages) |
| --- | --- | --- |
| Commit cards (hash, author, date, message, scenario, runs) | ✓ | ✓ |
| Verdict banner and confidence | ✓ | ✓ |
| Highlights | ✓ | ✓ |
| Key metrics with before / after / change bars | ✓ | all ~27 metrics, grouped |
| Components and files that changed most | top few | every changed component, file and function |
| Problems found | top few, new and resolved | all new, resolved and persisting, with culprits and fixes |
| Comparability checks | only the ones that failed | all |
| Recordings used, methodology and thresholds | – | ✓ |

Every PDF carries a footer with both commit hashes and page numbers. Results are never conveyed by colour alone: each one has
an icon (✓ ✕ =) and a word.

### Getting a trustworthy comparison

- Same machine, same browser, same CPU setting, same page and scenario on both sides. Absolute numbers differ between
  machines; only compare snapshots you recorded yourself.
- **Three runs per side.** With one run each the tool cannot measure noise and says so (confidence *medium* at best).
- Profile a **development build** on both sides, with the same dev-server settings.
- Make sure the working tree is clean when you record (otherwise the snapshot is flagged *uncommitted changes*).
- Want to see it work first? `npm run demo`, then record `http://localhost:5188/` three times (the “before”) and
  `http://localhost:5188/?fixed=1` three times (a simulated optimising commit that also adds one slow component), and compare.

## Recording tips

- **Do something.** A recording of an idle page is empty — the tool says so. Perform the exact interaction you suspect
  is slow (open the dashboard, drag a chart, type in the editor) while recording.
- **Keep it short and focused**: 10–30 s. Traces grow fast on big pages; there is a hard cap of 2 minutes.
- **Repeat the same scenario** before and after a change, and compare the reports from the drop-down.
- **Use CPU 4×** to make marginal problems obvious.
- **Ignore the first ~half second**: the tool discards the stall Chrome causes when it starts CPU profiling on a large
  app (it says so in the report's notes).
- A **memory leak** shows as steady *JS heap growth* over repeated actions: run the same action several times in one recording.
- **Want Chrome's own Performance panel too?** Click **Trace for Chrome DevTools** in the report bar above the tabs, then in
  Chrome open DevTools → **Performance** → **Load profile…** (the ↑ icon) and pick `reports/<id>.trace.json`. Note that the
  report itself (`reports/<id>.json`) is this tool's own format and **cannot** be loaded into DevTools — only the raw
  trace can. The trace of the **most recent recording** is kept in memory so the button always works right after
  recording; for older reports it only works if **save raw trace** was ticked before recording.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `npm install` / `npm run dev` fails with syntax or engine errors | You are on Node 16 (the app's version). Switch this terminal to Node 18+ (`nvm use` in this folder). |
| **“Chrome was not found”** | Set `CHROME_PATH` to the executable, e.g. `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run dev`. |
| Chrome opens on `{"message":"Internal error"}` at `/login/?next=…` | The login route may require a special query parameter (see [Signing in](#signing-in)). Fill in the **Sign-in URL**, close Chrome and launch again. |
| Red banner “The page answered HTTP 4xx/5xx” | The page failed to load — usually not signed in, or the backend/dev server is down. Check <http://localhost:3000> in a normal browser. |
| Amber pill “No React seen — reload the tab” | Press **Reload** (or use **Record page load**). The probe must load before React. |
| “production build: no timings” | React is a production build. Profile the dev server, not a built bundle. |
| Report says “Almost nothing ran…” | You recorded an idle page. Interact while recording, or use **Record page load**. |
| Everything is attributed to `bundle:main.js` and notes say “no source maps and no webpack module markers” | You are profiling a production/minified bundle. Use the dev server. |
| Lines show `≈` | Expected for webpack dev bundles (no source maps): the line is located by function name. |
| “Analysing…” takes very long or fails on a huge trace | Record for less time; close other heavy tabs; avoid CPU 6× on very long sessions. |
| **Attach** can't connect | Start Chrome yourself with `--remote-debugging-port=9222 --user-data-dir=/tmp/perf-chrome` (recent Chrome refuses the debugging port on your *default* profile) and use `http://127.0.0.1:9222`. |
| Port 5178 is in use | `PORT=5190 npm run dev`. |
| “Chrome could not start because another Chrome is already using the profile…” | The UI's Chrome window (or another CLI run) holds `.chrome-profile/`. Click **Close Chrome** in the UI first, or run the second one with its own profile: `PERF_CHROME_PROFILE_DIR=/tmp/perf-chrome-2 npm run profile -- …`. |
| Compare: “This is a raw Chrome trace” | You uploaded a `.trace.json`. Comparison needs the profiler **report**: open it and use **Snapshot for comparison** (the trace has no React or source-file data). |
| Compare: “No commit … in this repository” | The hash is not in your local clone. `git fetch` the PR branch first, then press **Look up** again. |
| Compare: “Chrome was not found” when saving a PDF | PDFs are printed by headless Chrome. Set `CHROME_PATH` (see Configuration). |
| “The raw trace of this recording was not kept” | Only the newest recording's trace is held in memory. Tick **save raw trace** before recording if you want to keep it, or re-record. |
| The launched Chrome has none of your extensions, bookmarks or logins | Expected: it is a separate, clean profile so extensions don't distort measurements. |
| Signed out again after closing Chrome | Expected (session cookies); the Sign-in URL handles it automatically. |

If something else is wrong, the profiler's terminal prints server-side errors, and the red bar on the page shows the
message returned to the UI.

## Command line (CI and scripted scenarios)

Runs headless, prints the top culprits (with their exact functions) and saves the same report the UI shows.

  ```bash
# startup profile
npm run profile -- --url http://localhost:3000/path/to/page/ --mode load \
  --sign-in "http://localhost:3000/login/?redirect={url}"

# 15 s idle-interaction profile at 4x CPU slowdown
npm run profile -- --url http://localhost:3000/ --duration 15 --throttle 4

# scripted scenario: the module default-exports async page => { … } (a puppeteer Page)
npm run profile -- --url http://localhost:3000/ --scenario ./my-scenario.mjs

# other flags: --headed (watch it run), --save-trace (also keep the raw trace)
```

The headless browser starts signed out too, so pass `--sign-in` for pages that need a login.

## Configuration

Environment variables (all optional):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5178` | Port of the profiler UI. |
| `CHROME_PATH` | auto-detected | Chrome/Chromium/Edge executable. |
| `PERF_TARGET_URL` | `http://localhost:3000/` | Pre-filled “Page to profile”. |
| `PERF_TARGET_NAME` | inferred from the frontend's `package.json` or `PERF_TARGET_NAME` | Human-friendly name shown in the UI and PDFs. |
| `PERF_CHROME_ARGS` | *(none)* | Extra Chrome flags, space separated. |
| `PERF_CHROME_PROFILE_DIR` | `./.chrome-profile` | The tool's private Chrome profile. Use a different one to run the CLI while the UI's Chrome is open. |
| `PERF_FRONTEND_DIR` | `../..` (or an absolute path) | Root used to map files and show source. |

Data on disk (both git-ignored): `reports/` (saved reports, plus optional `.trace.json` files) and `.chrome-profile/` (the tool's private Chrome profile).

## How it works and how accurate it is

```
Chrome ──CDP──▶ Tracing      main-thread tasks, layout, style, paint, GC, V8 CPU samples (one clock)
               Debugger      script ids, source-map URLs, script sources
               Runtime       in-page probe: React fibers + PerformanceObserver vitals
               Performance / Memory / Emulation   heap, DOM nodes, layout counts, CPU throttling
```

- **CPU samples** are recorded inside the trace, so they line up with tasks exactly and survive page reloads.
- **File attribution** works even without source maps. In order of precision: (1) a **source map**; (2) **webpack module
  markers** — this repo's dev config uses `devtool: false`, but webpack still writes a `/***/ "./src/x.tsx":` line and a
  `!*** ./src/x.tsx ***!` banner before every module, so a bundle line maps back to its module; (3) the **script URL**
  (Vite/ESM servers, `webpack://` URLs); (4) otherwise the bundle name. The header of each report says which was used.
- **Lines**: exact when a source map exists; otherwise the function's definition is looked up by name in the real file
  and marked `≈`.
- **React**: the probe installs a `__REACT_DEVTOOLS_GLOBAL_HOOK__` before React loads (React 16.9+, 17, 18), walks each
  commit and compares every rendered component with its previous version to decide *why* it rendered and whether the
  render was wasted. A component's file comes from its function's real location.
- **Builtins** (`Array.sort`, `performance.now`…) are billed to the JavaScript function that called them, and anonymous
  callbacks are named after their enclosing function.
- **Noise control**: the CPU-profiler start-up stall is discarded; LCP/FCP are only reported for page-load recordings;
  ratio-based rules need real activity before they fire.
- Rule thresholds live at the top of each rule in `server/analysis/findings.js`.

**Limits.** The probe and profiler add overhead (the report shows the probe's own cost) — compare recordings taken the
same way. Webpack-concatenated modules are attributed to the first module of the group. Line numbers are best-effort
without source maps. React data needs a development or profiling React build. It measures *your machine*, not production.

## Technical deep dive: capture, correlation and report generation

The sections above are the user manual. This one is the implementation: exactly what is captured while you
interact with the page, on what clock, and the concrete algorithm that turns millions of raw events into the
few dozen sentences on the Culprits tab. Everything below is traceable to a file in `server/`.

### 1. Three instruments recording at once

A recording is not one data source — it is three, started together in `PerfSession.start()`
(`server/recorder.js`) and merged afterwards in `buildReport()` (`server/analysis/report.js`):

| Instrument | CDP domain | What it captures | Code |
| --- | --- | --- | --- |
| **Browser trace** | `Tracing.start` | Every main-thread task Chrome itself performs: layout, style recalculation, paint, GC, script evaluation, timers, event dispatch — as nested, timed spans. | `server/analysis/trace.js` |
| **V8 CPU profile** | *(carried inside the same trace)* | A sampled call stack of the actual JavaScript running, at roughly sub-millisecond resolution, independent of what Chrome's own instrumentation points call out. | `server/analysis/cpu.js` |
| **In-page probe** | `Page.addScriptToEvaluateOnNewDocument` + `Runtime.evaluate` | What Chrome's trace *cannot* see from outside the page: which React component rendered, why, whether it was wasted, plus Web Vitals (long tasks as the browser defines them, layout shifts, LCP/FCP, slow interactions). | `server/probe.browser.js` |

They run concurrently for the whole recording and are reconciled only once, after `Tracing.end`, inside
`buildReport()`. Nothing is sampled or inferred after the fact from a single log — each instrument is a live,
independent recorder for the whole window between **Record** and **Stop**.

### 2. The browser trace: how "currently running activity" is captured

`client.send('Tracing.start', { categories, transferMode: 'ReturnAsStream', streamFormat: 'json' })` asks Chrome's
tracing subsystem to emit timestamped events for a fixed set of categories (`TRACE_CATEGORIES` in
`recorder.js`): `devtools.timeline`, `v8.execute`, `disabled-by-default-devtools.timeline(.frame|.stack)`,
`disabled-by-default-v8.cpu_profiler`, `toplevel`, `blink.user_timing`, `latencyInfo`. This is the same
instrumentation Chrome's own DevTools Performance panel uses — the profiler is not polling or guessing; it is
asking the browser to narrate its own work as it happens.

Each event is a JSON object with a **phase** (`ph`): `X` for a complete, already-timed span (`ts` + `dur`), or a
`B`/`E` pair for one that was still open when traced. `threadEvents()` folds every `B`/`E` pair for one thread into
an `X` span, so every event downstream has a start and a duration on the same microsecond clock. The whole trace
easily holds tens of thousands of events for a 20-second recording — nothing in this pipeline looks at events one
at a time by hand; everything is reduced algorithmically.

**Finding the main thread.** A trace multiplexes every renderer process/thread Chrome is running (compositor,
raster, GPU, other tabs). `findMainThread()` looks for `thread_name` metadata events named `CrRendererMain` and,
if more than one such thread exists in the trace (more than one tab/process was open), keeps the one with the
most total `RunTask` time — the one that was actually busy running your page.

**Building the task tree.** `buildTree()` turns the flat, sorted list of spans for that one thread into a proper
tree: a stack-based sweep where a new event becomes a child of whatever span on the stack still contains its
start time, and a parent's `self` time is reduced by every child subtracted from it. The result is a forest whose
roots are Chrome's own top-level scheduler quanta, the `RunTask` events — each one is literally "the main thread
did something, uninterrupted, for this many microseconds."

**Classifying the work.** Every event name is bucketed into one of eight categories by `categoryOf()`:
`scripting` (`FunctionCall`, `EventDispatch`, `TimerFire`, `EvaluateScript`, `RunMicrotasks`, XHR callbacks…),
`compile` (V8 parse/compile), `style` (`UpdateLayoutTree`, `RecalculateStyles`), `layout` (`Layout`), `paint`
(`Paint`, `PrePaint`, `Layerize`, `Commit`…), `gc` (anything matching `/GC|Scavenge|MajorGC|MinorGC/`, excluding
the scheduler's own `RunTask`/`ThreadControllerImpl` wrapper names), `parse` (HTML/CSS parsing) and `other`. A
depth-first `visit()` walks the whole tree once, summing each leaf's own `self` time into its category's running
total — that sum is the "Where main-thread time went" bar on the Culprits tab.

**Finding what triggered each task.** For every `RunTask` root, `describeTrigger()` searches its subtree for the
*outermost, longest-running* event from a fixed set of entry-point event names (`EventDispatch`, `TimerFire`,
`FireAnimationFrame`, `FireIdleCallback`, XHR events, `EvaluateScript`, `RunMicrotasks`, `FunctionCall`,
`ParseHTML`). Whichever one wins supplies the human label — `"click handler"`, `"timer"`,
`"requestAnimationFrame"`, `"script evaluation"` — and the long-task culprit on the Culprits tab is literally
that label plus the breakdown of what ran inside it.

**Long tasks and total blocking time.** Any `RunTask` whose total duration is **≥ `LONG_TASK_US` = 50,000 µs
(50 ms)** is a long task — the same 50 ms threshold the Long Tasks API and web-vitals tooling use. Total Blocking
Time is the sum, over every long task, of `duration − 50 ms` — the part of each task that could not have been
interrupted to handle input.

**Forced reflow and layout thrashing.** While walking the tree, `visit()` also tracks the nearest scripting
ancestor of every node (`SCRIPT_PARENTS` = the same set as `scripting`). If a `Layout` or
`UpdateLayoutTree`/`RecalculateStyles` event occurs **underneath** a scripting ancestor — i.e. script, not the
browser's own render pipeline, triggered it — it is recorded as a **forced reflow**, together with whatever JS
call stack the trace captured for it (`beginData.stackTrace`, when Chrome attaches one) and the `dirtyObjects` /
`totalObjects` counts Blink reports for that layout pass. If **three or more** forced layouts happen inside a
single task (`THRASH_THRESHOLD = 3`), that task is flagged as **layout thrashing**: alternating DOM writes and
layout-forcing reads in a loop.

**A hard safety cap.** `MAX_RECORDING_MS = 120_000` in `recorder.js` stops any recording automatically after two
minutes, because trace volume grows roughly linearly with wall-clock time and an unbounded recording would
eventually exhaust memory in both Chrome and the profiler's Node process.

### 3. The V8 CPU profile: capturing exactly which code ran

Tracing categories alone tell you *that* 260 ms of "scripting" happened inside a task — not *which function*.
That comes from a second data stream multiplexed into the very same trace: `disabled-by-default-v8.cpu_profiler`
makes V8 run its own sampling CPU profiler (stack-sampling at a fixed interval, independent of the Tracing
domain's event instrumentation) for the lifetime of the recording, and periodically flush what it has sampled as
`Profile` / `ProfileChunk` trace events.

**Why this needs its own reassembly.** `Profile` (one, naming the time the profiler started and the thread) and
`ProfileChunk` (many, each carrying a batch of call-tree nodes, the sequence of sampled node ids, and the time
delta since the previous sample) are emitted by *V8's own profiler thread*, not the renderer main thread being
profiled — so they cannot be found by filtering on the renderer thread's `pid`/`tid`. `extractCpuProfile()`
instead groups them by `(pid, profile id)`. Because that id is scoped only to one V8 isolate, two unrelated
profiles in the same Chrome process — this repo's own page and some other tab, or Chrome's internal WebUI pages —
can both be `"0x1"`. The code guards against this explicitly: whenever a chunk's call-tree node ids collide with
ids already seen for the current group, it starts a **new** logical profile rather than silently merging two
unrelated call trees into one (a real bug this exposed during development — see the project history in
`server/test-analysis.js`'s "CPU profile chunks are paired with their header" test). Of the resulting candidate
profiles, the one whose thread matches the main thread found in step 2 is kept; if that pairing fails for some
reason, the profile with the most samples in that process is used as the next best guess.

**Reconstructing wall-clock sample times.** `cp.samples` is a flat array of node ids (which call stack was
sampled), and `timeDeltas` the microseconds since the *previous* sample. `analyzeCpuProfile()` walks both arrays
once to build a monotonically increasing `sampleTs` array on the **same trace-clock epoch as the browser trace**
(`profile.startTime` is itself a `ts` value from the `Profile` event). This is what lets a window of CPU samples
be matched to a specific `RunTask` span or a specific forced-reflow event later — both are on one shared clock.

**Self time, total time and recursion.** Each call-tree node accumulates `self` time from every sample where it
was the leaf of the stack (`sampleDur[i]`, the gap to the next sample, standing in for "how long that stack was
running"). `total` time is computed with one iterative post-order pass (explicit stack, not recursive — call
trees from a real app can be tens of thousands of nodes deep) so a function's own time plus everything it called
is summed exactly once, even through recursive call chains, by tracking an "on-stack" counter per function/file
key rather than re-adding time already counted higher up the same recursive chain.

**Attributing anonymous and native frames.** Two reattributions happen in the same pass, mirroring how a human
reading a stack trace would reason about it:
- A node with no `url` at all (`Array.prototype.sort`, `performance.now`, …) is a V8/C++ builtin with nothing to
  show a developer. `node.rep` walks up to the nearest ancestor that *does* have a real script, and the builtin's
  self time is folded into that ancestor instead of being reported as unattributable.
- A node whose function name is empty (`(anonymous)`) is renamed to `(anonymous in <enclosingFunction>)`, where
  the enclosing function is the nearest **named** function anywhere up its own call chain — so a callback passed
  to `.forEach()` inside `renderRows()` is reported as `(anonymous in renderRows)`, not as an unlocatable blank
  name sixteen stack frames removed from anything recognisable.

**Per-library attribution ("vendor drivers").** For every sample whose resolved location falls inside
`node_modules` (`loc.vendor`), the code walks upward past any further library/native/builtin frames to the
*first application frame that called into it*. That is how a finding like "Library lodash used 340ms of CPU" can
also say *which of your own functions* is responsible for calling it that often.

**Windowed and point queries.** Two binary searches over the sorted `sampleTs` array answer the two questions the
report needs repeatedly: `windowSelf(cpu, from, to)` sums self time per function for every sample inside a time
range (used to blame a specific long task), and `nodeAt(cpu, timestamp)` finds the call stack active at one
instant (used to blame a forced reflow that has no stack trace of its own, by looking at what was running at its
midpoint). Both are `O(log n)` against profiles with tens of thousands of samples rather than a linear scan per
query.

### 4. The in-page probe: capturing what the trace cannot see

Trace events and CPU samples describe *the engine's* work — they have no concept of "component" or "render".
`server/probe.browser.js` is injected as plain, dependency-free JavaScript via
`Page.addScriptToEvaluateOnNewDocument`, which guarantees it runs **before any of the page's own scripts**,
including React itself — this ordering is why the toolbar needs you to **Reload** once after launching: the hook
below has to exist before React's renderer registers with it.

**Hijacking React's own instrumentation, not reimplementing it.** React already calls a well-known global hook —
`window.__REACT_DEVTOOLS_GLOBAL_HOOK__` — on every commit, specifically so that the React DevTools extension can
inspect it. If the hook doesn't exist yet, the probe installs a minimal stand-in with the methods React expects
(`inject`, `onCommitFiberRoot`, …); if React DevTools is already present, the probe instead wraps the *existing*
`onCommitFiberRoot`, so both can coexist. Either way, every commit — of either React 17's legacy renderer or
React 18's concurrent one — calls into `onCommit()`.

**Walking the fiber tree per commit.** React's internal "fiber" tree *is* the render tree, each node a function or
class component with a `tag` identifying its kind (`walkCommit()` recognises function components, class
components, `forwardRef` and `memo`-wrapped components). For each one that actually did work this commit (its
`flags`/`effectTag` has the `PerformedWork` bit set, or it has no previous version at all — i.e. it just mounted),
`record()`:
- adds one to that component's render count, keyed by **function identity** (`typeIdOf()`, a `WeakMap` from the
  component function itself to a stable integer id — this is what lets "Row" rendering 14,000 times be reported
  as one row in the React tab instead of 14,000 separate entries);
- computes **self time** as `fiber.actualDuration` (React's own per-fiber timing, present only in development or
  profiling builds — `sawTimings` records whether this was ever available at all) minus the summed
  `actualDuration` of its direct children, so a slow parent is not blamed for time actually spent inside a slow
  child;
- diffs `memoizedProps` between this fiber and its previous version (`fiber.alternate`) to find which **prop keys**
  changed, compares hook state via each hook's `queue` (present only on `useState`/`useReducer` hooks — deliberately
  excluding `useMemo`/`useEffect`/`useRef` hooks, whose internal state mutates on every render regardless and would
  otherwise look like a reason the component re-rendered), compares class-component state directly, and walks
  `dependencies.firstContext` linked lists to detect a changed context value;
- if **none** of props, state, hooks or context actually changed, the render is marked **wasted** — React did the
  work anyway, purely because its parent re-rendered.

**Detecting props that are recreated but not actually different.** For every prop whose reference changed,
`classifyPropChange()` goes one step further: if both the old and new values are functions, it compares their
`Function.prototype.toString()` source text — identical source but different identity means a fresh closure was
created (classically, an inline arrow function with no `useCallback`). If both are plain objects, a depth-limited
structural equality check (`looseEqual()`, capped at depth 3 and 50 keys, and explicitly bailing out on anything
with a `$$typeof` — React elements — to avoid comparing rendered trees as if they were data) catches a
`{ label: 'x' }` literal rebuilt every render with the same shape. This check is capped at the first
`DEEP_COMPARE_LIMIT = 300` renders of a component, since the point is to characterise the pattern once, not re-run
an O(size²) comparison tens of thousands of times for a component that renders in a tight loop.

**Independently verifying every component's exact source line.** The probe cannot read source maps or file
contents — it runs inside the sandboxed page. So rather than trust `displayName`/`fiber._debugSource` alone (the
latter is the *call site* that created the JSX, not the function's own definition, and was deliberately dropped
from this pipeline for that reason), every distinct component **function object** is kept, by reference, in
`probe.typeFns`. After the recording stops, `PerfSession.componentLocations()` asks the CDP `Runtime` domain
directly for each function's `[[FunctionLocation]]` internal property — the actual `(scriptId, line, column)`
V8 recorded when it parsed that function, batched 40 at a time to bound the round trips. This is the same
mechanism DevTools itself uses to jump to a function's definition, and it is what lets a component be attributed
to a real file and line even when no two components share a name.

**Web Vitals, captured the same way the browser reports them to real users.** The probe separately wires up a
`PerformanceObserver` for `longtask`, `long-animation-frame`, `layout-shift`, `largest-contentful-paint`, `paint`
and `event` (the Event Timing API, thresholded at 40 ms via `durationThreshold`, with `interactionId` used to
deduplicate the several DOM events — `pointerdown`, `pointerup`, `click`, …— that make up one user interaction
into a single slowest-sub-phase breakdown of input delay / processing time / presentation delay). Every entry
records its own `startTime` on `performance.now()`'s clock and is filtered, on snapshot, to only those that
occurred after the current recording's `probe.start()` — so vitals from before you pressed Record never leak into
the report.

**Where each component is on screen (the Page map).** The probe also remembers every React root it has seen.
After the trace has been drained, `probe.layout()` walks the live fiber tree once; for each component that rendered
during the recording it takes the bounding boxes of the *outermost DOM nodes it renders* (descending until the first
host element, never into portals), unions them, clips to the viewport and drops anything under 16 px. Per component
it keeps up to six rects (largest first) and the result is capped at the 300 slowest components, keyed by the same
`typeIdOf()` id the React tab uses (the report's `react.components[].id`). `capturePageView()` then takes a
viewport-sized JPEG with `Page.captureScreenshot` at scale 1, so the rect coordinates are in the image's own pixels.
The screenshot is saved as `reports/<id>.page.jpg`, the geometry as `report.pageView` (no image data in the JSON,
so reports and snapshots stay small), and `GET /api/reports/:id/page.jpg` serves it. It is taken *after* tracing
ends, so it never adds events to the trace, and any failure simply leaves the report without a page map.

### 5. The record/stop lifecycle, in the exact order it happens

```
connect()        attachPage(): enable Debugger/Page/Performance, inject the probe script
                  (script registry starts filling as Debugger.scriptParsed events arrive)
navigate()        load the target page (retrying through the Sign-in URL if it looks signed out)
start()           optional: Emulation.setCPUThrottlingRate
                  live mode:  Runtime.evaluate("__PERF_PROBE__.start()")  — probe starts recording now
                  load mode:  inject an autostart script, then Page.reload — probe starts at the next navigation
                  Performance.getMetrics()  — snapshot "before" (heap, layout count, …)
                  Tracing.start({ categories, transferMode: 'ReturnAsStream' })
(you interact with the page — this is the window every instrument above is recording)
stop()            Runtime.evaluate("__PERF_PROBE__.stop(); __PERF_PROBE__.snapshot()")  — probe snapshot taken first
                  Performance.getMetrics()  — snapshot "after";  Memory.getDOMCounters()
                  Tracing.end → read the IO stream back to a JSON string → parse
                  capturePageView()  — __PERF_PROBE__.layout() + Page.captureScreenshot (best effort)
                  componentLocations()  — batched Runtime.getProperties calls for [[FunctionLocation]]
                  buildReport()  — everything below
```

The probe's `stop()`/`snapshot()` is deliberately evaluated **before** the trace is drained, so that the two
describe the same window as closely as possible, and `Performance.getMetrics()` is read both immediately before
`Tracing.start` and immediately after `Tracing.end`, so the memory/DOM/layout-count *deltas* in the report are a
tight before/after of exactly the recorded interval, not of the whole session.

### 6. Mapping code back to source files

Everything above identifies code by `(scriptId, line, column)` inside whatever bundle Chrome loaded — not by
file path. `server/analysis/sources.js`'s `SourceResolver` turns that into a real repo path, trying four
strategies **per script**, in order of how trustworthy the result is:

1. **Source map.** If `Debugger.scriptParsed` reported a `sourceMapURL`, it is fetched and parsed with
   `@jridgewell/trace-mapping`, and `originalPositionFor()` gives an exact original file, line and function name.
2. **Webpack module markers.** This repo's webpack dev config uses `devtool: false` (no source map at all), but
   webpack still writes a `/***/ "./src/x.tsx":` comment immediately before every module's compiled body, plus a
   `!*** ./src/x.tsx ***!` banner above the one inlined entry module (which has no quoted marker of its own).
   `indexWebpackModules()` scans the bundle's text **once** for every such marker and records its line number;
   `moduleAt()` then binary-searches that sorted list to answer "which module's code is at bundle line N" in
   `O(log n)`. This is how the tool gets accurate per-file attribution against a dev build that has no source map
   whatsoever.
3. **Script URL.** Vite/ESM dev servers serve one script per source file, so the URL itself *is* the path
   (`normalizePath()` also understands `webpack://…` and `webpack-internal://…` URLs for other setups).
4. **Bundle name.** Anything else (a built, minified `.chunk.js`) is reported as the bundle it came from, since
   there is nothing more precise to say.

Every `(scriptId, line, column)` is resolved at most once and cached (`resolve()`'s internal `cache` map keyed on
`scriptId:line:column`), because the same hot line is sampled thousands of times in a typical recording.

**Locating a definition when there is no source map.** Strategy 2 only gives a *bundle* line. When a function's
bundle line is known but not its real line, `server/analysis/locate.js`'s `findDefinitionLine()` searches the
actual source file for the most likely place that function is *defined* — not merely mentioned — using five
patterns, each tried in order of how strong a signal it is: a `function name(` declaration, a `class Name`
declaration, a `const/let/var name =` binding, a method-shorthand definition (`name(…) {` at the start of a
line, accounting for `static`/`get`/`set`/access modifiers), and an arrow-function assignment
(`name = (…) => ` or `name: (…) =>`). The function name itself is normalised first (`searchableName()`): a
method like `Grid.componentDidUpdate` is reduced to `componentDidUpdate`, and `(anonymous in buildRows)` is
reduced to `buildRows` — if the wrapper function can be found, that is a legitimate place to point a developer
even though the exact anonymous line inside it cannot be. A line found this way is marked `lineKind: 'located'`
and rendered in the UI with a leading `≈`, as distinct from `'exact'` (source-mapped) — the file and function
name are always exact; only the *line* is a best-effort match in this mode.

### 7. Joining everything into one report

`buildReport()` is the one function that sees all three instruments together. For every file touched by the CPU
profile, it accumulates: `selfMs`/`totalMs` from the call-tree aggregation in step 3; `blockMs`, its *share* of
blocking time apportioned from whichever long tasks its code ran inside, weighted by `(task's self time in that
file ÷ task's total self time)` of the task's blocking portion (duration beyond the 50 ms threshold); `forcedMs`
from any forced reflow whose blamed stack frame resolved to that file; and, via `summarizeReact()`, `reactMs`,
`renders` and `wasted` for every React component whose source file was resolved in step 6. A file's hottest
functions are kept (filtered to those with ≥ 0.3 ms self or ≥ 3 ms total, to keep the per-file function list
focused), and, for application (non-vendor) files, each function's display line is independently re-resolved
through `locate()` — so even a source-mapped file falls back to the located-by-name line if the mapped position
didn't carry one.

**Discarding profiler start-up noise.** Starting the V8 CPU profiler forces it to walk and index every function
in a large application's code — this itself briefly blocks the main thread, and would otherwise be
misreported as a mysterious ~200 ms "long task" containing no application JavaScript at all, right at the very
start of every *live* recording. `isStartupArtifact()` detects exactly this signature — within the first 500 ms
of the recording, almost entirely `other` time, and almost no actual sampled JavaScript inside it — and excludes
those tasks from long-task reporting, total blocking time, and the main-thread timeline, while adding an explicit
note to the report so the omission is never silent.

**Recognising an unhelpful recording.** If total active CPU time is under 300 ms, React committed fewer than 5
times, and no long task occurred, the recording is flagged as effectively idle — "Almost nothing ran" — rather
than silently producing a report with nothing in it. Likewise, if the page's own top-level navigation returned
an HTTP status ≥ 400 (tracked throughout the session via a `page.on('response')` listener that only looks at the
main frame's final, non-redirect response), the report leads with a critical "page failed to load" finding
instead of analysing whatever error page happened to be open.

### 8. From numbers to sentences: `findings.js`

`buildFindings()` is a fixed sequence of independent rules, each one pattern-matching the joined report for one
specific shape of problem, and each one, when it fires, attaching `culprits`: the exact `{fn, file, line,
lineKind, abs}` tuples responsible, carried straight through from steps 3 and 6 above rather than re-derived.
Representative thresholds, all literal constants near the top of the relevant rule: a long task is **critical**
at ≥ 200 ms CPU self time and **warning** below that; a file is called out once it has ≥ 80 ms self time (or, once
there is at least 500 ms of total activity to make a percentage meaningful, once it is responsible for ≥ 10 % of
all CPU); a component's wasted-render rate is only flagged once it has re-rendered at least 5 times *and* at
least 30 % of those were wasted; three or more forced layouts inside one task is reported as thrashing separately
from the individual forced-reflow entries. Every rule attaches an `impactMs` the final list is sorted by (within
severity: critical, then warning, then info), so the single most expensive, most certain problem is always first.

### Known limits of the correlation (so the numbers aren't over-trusted)

- **Two clocks, not fully reconciled.** Trace events (`RunTask`, CPU samples) are timestamped on Chrome's
  internal tracing clock, relative to `trace.firstTs`. The in-page probe's React commit and Web Vitals timestamps
  are `performance.now()` values, relative to `probe.startedAt`. Both are monotonic and both cover the same
  recorded window, but the report does **not** currently compute the offset between them, so "long task at 1.52s"
  (trace-relative) and "Row rendered 14,760× (2,293/s)" (probe-relative) each describe the recording's own
  timeline correctly, but are not guaranteed to be millisecond-aligned *against each other* on the same axis.
  Treat the two timelines as independently accurate, not as one merged one.
- **Sampling, not instrumentation, for the CPU profile.** V8's CPU profiler is a statistical sampler: a function
  that runs for less than one sampling interval between two samples can be entirely missed. This mainly affects
  very fast, very frequent functions; the main-thread **trace** categories (step 2) are complete instrumentation
  and are not subject to this.
- **The probe's own cost is included in `probeOverheadMs`**, but not otherwise subtracted from what it measures —
  walking the fiber tree on every commit is itself JavaScript execution that the CPU profiler will have sampled.
- **`located` lines are a best-effort name search**, not a parser — a very common short name, or a function
  wrapped in multiple HOCs, can occasionally match a different, coincidentally-matching definition in the same
  file.

## Privacy and safety

- Everything runs locally. The UI server binds to `localhost`; **don't pass `--host`** unless you accept exposing your
  source tree and browser session to your network.
-- The API only reads files inside the configured frontend root (and the demo app) and refuses path traversal.
- No credential is ever entered into, stored by or written to a report by this tool. Reports contain performance data,
  file paths, function names and URLs (including query strings, which may contain IDs) — review a report before sharing it.
- The **Page map screenshot** (`reports/<id>.page.jpg`) is a picture of the profiled page and can show whatever data
  was on screen (names, numbers, customer data). Reports are git-ignored, but treat the image like the report: review it
  before sharing, and **Delete** removes it together with the report.
- The tool's Chrome profile (`.chrome-profile/`) can contain cookies for the app after you sign in; it is git-ignored.

## Project layout and contributing

```
server/probe.browser.js    in-page probe (React hook + vitals + component screen positions), injected before the app loads
server/chrome.js           find / launch / attach Chrome
server/recorder.js         CDP orchestration: start/stop, trace stream, metrics, sign-in, component locations
server/signin.js           Sign-in URL template + "signed out?" detection
server/git.js              commit / author lookup (name only, never the email)
server/pdf/                comparison PDF: print-ready HTML (template.js) + headless-Chrome printing (render.js)
shared/compare.js          the diff engine; used by BOTH the Compare tab and the PDF, so they always agree
shared/snapshot.js         snapshot file naming, validation, commit-from-filename
server/analysis/           trace.js · cpu.js · sources.js · locate.js · report.js · findings.js
server/plugin.js           Vite plugin: /api/* endpoints + Server-Sent Events
server/cli.js              headless runner
src/                       React + d3 UI (App, components/, hooks/, heat.js, layout.js)
src/theme.js, themes.css   theme + light/dark mode (CSS variables per theme; see Appearance and themes)
src/culprits.js            merges findings into the top culprits and groups findings by root cause
src/components/            CulpritsHero + CulpritSphere (top culprits), FindingsList, Vitals, PageMap, AppearanceMenu, Popover, …
fixtures/demo-app/         app with deliberate performance bugs (npm run demo); ?fixed=1 is the "optimised" variant
reports/  .chrome-profile/ generated data (git-ignored)
```

- `npm test` runs the analysis unit tests (`node --test`). Test files are named `test-*.js`, deliberately **not**
  `*.test.js`, because the repo's jest `testRegex` covers `tools/` and would otherwise try to run them.
- Format with the repo's Prettier config: `../../node_modules/.bin/prettier --write server src`.
- The tool is plain JS/JSX with its own dependencies (`npm install` in this folder only). `npm run build` produces a
  static UI, but the API lives in the dev server, so always use `npm run dev`.
- Styling is plain CSS. **Colours come only from the variables in `src/themes.css`** (one block per theme × mode); do
  not hard-code colours in `styles.css` or components, or they will look wrong in one of the four palettes.
- To add a culprit rule, add it to `buildFindings` in `server/analysis/findings.js` (return evidence, `culprits` and a
  `fix`) and cover it in `server/test-analysis.js`.

## Appearance and themes

Open **Appearance** in the top bar and choose:

- **Theme** — **Liquid Glass** (frosted, translucent panels, capsule buttons, soft gradient backdrop) or **Space**
  (deep-space mission-control look: starfield, indigo/cyan glow, tighter corners).
- **Mode** — **Light**, **Dark** or **Auto** (follows your operating system and changes live when it does).

Both themes have a full light and dark palette, so there are four looks. The choice is remembered in this browser
(`localStorage`) and applied before the first paint, so there is no flash of the wrong theme. To add a theme, add a
`:root[data-theme='…'][data-mode='…']` block to `src/themes.css` with the same variables and list it in `src/theme.js`.
