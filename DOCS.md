# Spectra

Find out **which file, which function and which component** makes a frontend app slow.

You point it at the app running in your browser, press **Record**, use the page, press **Stop** — and it gives you a
ranked list of culprits, each with the exact function, file and line, the evidence, and a suggested fix. It drives a
real Chrome through the Chrome DevTools Protocol (tracing + CPU sampling) and adds a small in-page probe for component
re-renders (React, Next.js, Vue and Angular) and browser vitals. Any other frontend still gets its slow files and
functions. Apps behind a login work too: Spectra [signs in first](#signing-in).

> **The full guide**, with annotated screenshots of every screen, is on the Progen Labs website:
> <https://progen-labs.github.io/website/#spectra/docs/introduction>. This file is the in-repo manual, the technical
> deep dive and the contributor guide.

**Two ways to run it.** The dashboard walkthrough below uses the commands of a checkout of this repository; with the
installed package, use `npx spectra dashboard` wherever it says `npm run dev`. Everything else is the same.

| | Installed in your project | From a checkout of this repository |
| --- | --- | --- |
| Install | `npm install --save-dev @progen-labs/spectra` | `npm install` in this folder |
| Profile from the terminal | `npx spectra performance` (golden paths), `npx spectra performance --quick` | `npm run profile -- --url … --mode load` |
| Compare, list reports | `npx spectra compare …`, `npx spectra reports` | `node bin/spectra.js compare …` |
| Dashboard | `npx spectra dashboard` → <http://127.0.0.1:4321> | `npm run dev` → <http://localhost:5178> |
| Reports are saved in | `.spectra/reports/` in your project | `reports/` in this folder |

- [Requirements](#requirements)
- [One-time setup](#one-time-setup)
- [Every time you profile](#every-time-you-profile)
- [Your first recording](#your-first-recording)
- [AI agents know Spectra](#ai-agents-know-spectra)
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
- [The AI fix harness](#the-ai-fix-harness)
- [Privacy and safety](#privacy-and-safety)
- [Project layout and contributing](#project-layout-and-contributing)

---

## Requirements

| Need | Details |
| --- | --- |
| **Node 22.12 or newer** | ⚠️ Some frontends may pin an older Node version; this tool needs **Node 22.12+** (its Chrome driver, puppeteer-core, does). Use a separate terminal for it if needed. With nvm: `nvm install 22 && nvm use 22`. |
| **Google Chrome** | Also works with Chromium or Microsoft Edge. Found automatically on macOS, Linux and Windows; otherwise set `CHROME_PATH` (see [Configuration](#configuration)). |
| **The frontend running locally** | The frontend development server (your app's dev server), e.g. `http://localhost:3000` or any host/port your app uses. See step 2 below. |
| A login for that app (optional) | If your app requires sign-in, Spectra signs in for you (or waits while you do) — see [Signing in](#signing-in). |

> **Profile a development build.** Production builds are minified and carry no per-file information, and React only
> reports render timings in development mode. Dev builds are slower than production, so trust the *ranking* of what is
> slow rather than the absolute milliseconds.

## One-time setup

```bash
cd performance-profiler
nvm use 18         # or otherwise make sure `node -v` prints v18 or newer
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

**3. The profiler** (Node 22.12+, in this folder `performance-profiler/`):

```bash
npm run dev               # http://localhost:5178   (PORT=5190 npm run dev to change the port)
```

Open <http://localhost:5178> in any browser. That page is the *control panel*; the app you are profiling opens in a
**separate Chrome window** that the tool launches for you.

## Your first recording

1. **Fill in the connect card** at the top of the profiler page:
  - **Page to profile** — the page you want to measure, e.g. `/path/to/page/` or `http://localhost:3000/path/to/page`.
  - **My app needs a sign-in** *(only if the page requires a login)* — turn it on and pick how your app signs in: a
    login form (username and password, optional authenticator codes), signing in yourself, the browser's login
    prompt, a token or cookie, or a sign-in link. Details in [Signing in](#signing-in).
  - **Advanced** holds **Headless** and **Attach to a running Chrome**.
2. Click **Launch Chrome**. A new Chrome window opens, signs in and loads your page. Wait until the page has fully
   rendered. The session card now has two rows: the page (browser tab, URL, **Go**, **Reload**, **✓ Signed in** when
   Spectra signed in, a green framework pill such as **✓ React 18.x**, **✓ Vue** or **✓ Angular**, **Close Chrome**)
   and the recording controls.
   - “**No component framework seen**” on a React, Vue or Angular app? Press **Reload** once (the probe has to be
     installed before the framework loads). On any other app it is expected: files and functions are still profiled.
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

## AI agents know Spectra

The first time Spectra runs in a project it is installed in, it writes its knowledge doc ([`agents/spectra.md`](agents/spectra.md): the
`spectra improve` loop an agent runs when asked to improve the performance, which command answers which other request,
how to read the results, the rules) where AI coding agents read
their project instructions: a block in `AGENTS.md` (Codex, GitHub Copilot's coding agent, Cursor, Windsurf, Zed and
others), and for the agents the project or machine uses, `.claude/skills/spectra/SKILL.md` plus a note in `CLAUDE.md`,
`.github/instructions/spectra.instructions.md` (GitHub Copilot), `.cursor/rules/spectra.mdc`,
`.windsurf/rules/spectra.md`, `.clinerules/spectra.md`, `.roo/rules/spectra.md` and `GEMINI.md`. There is no install
script (so package managers and supply-chain scanners have nothing to flag): `bin/spectra.js` does it on the first bare `npx spectra`
(which prints a short intro) or the first `improve`, `performance`, `compare`, `reports` or `dashboard` in the project, once per Spectra version (a note in
`.spectra/agent-docs.json` remembers it; after an update it only refreshes what is already there). Never in CI, under
`npx` without an install, for a global install, after `spectra agents --remove`, or with `SPECTRA_AGENT_DOCS=0` or
`"agentDocs": false` in `spectra.config.json`. Shared files are only touched between
`<!-- spectra:start -->` and `<!-- spectra:end -->`; Spectra's own files carry a `spectra:managed` marker, and a file
without it is never overwritten. `npx spectra agents` does it by hand,
`--list` shows what was detected, and `--remove` takes it all out (`server/agents.js`).

## Signing in

The Chrome window starts **signed out**: apps normally use *session* cookies, and Chrome throws those away when it
closes, even though the tool keeps its own Chrome profile (in your temp directory, under `spectra-chrome/`). Tell
Spectra how your app signs in, and it signs in before it records anything:

| Method | For | What Spectra does |
| --- | --- | --- |
| **Login form** (`form`) | A username and password on your app's login page or its identity provider (OAuth, OpenID Connect, SAML) | Finds the fields (in the page, in iframes and inside web components), clicks a plain **Sign in** button first if the form is behind one, types like a person so framework-controlled inputs see it, handles two-step logins (username, **Next**, password), and answers an authenticator-code step when given the TOTP secret |
| **I'll sign in myself** (`manual`) | SMS or email codes, push approvals, passkeys, CAPTCHAs | Opens the login page in a visible window and waits (5 minutes by default) until the login is gone |
| **Browser prompt** (`http`) | HTTP Basic or Digest | Answers the prompt |
| **Token or cookie** (`token`) | A header, cookies or localStorage entries the app accepts | Sets them before the app loads; a header goes only to the page's own origin |
| **Sign-in link** (`link`) | A URL that signs in by itself | Opens it when the page lands on a login screen; `{url}` in it becomes the page to return to |

**In the dashboard**: turn on **My app needs a sign-in** under *Page to profile*. The page URL, the method, the login
page, the username and any selectors are remembered in your browser; passwords, codes, tokens and cookies stay in that
tab's memory only. **Go** signs in again with the same details when the page asks.

**On the command line** (and so in CI, the VS Code extension, the MCP server and `spectra improve`, which all run it):

```bash
SPECTRA_LOGIN_PASSWORD="$TEST_PASSWORD" npx spectra performance --login-url http://localhost:3000/login --login-user demo@example.com
npx spectra performance --login manual --login-url https://staging.example.com/login
```

| Option | Description |
| --- | --- |
| `--login <method>` | `form`, `link`, `http`, `token` or `manual`; guessed when left out |
| `--login-url <url>` | The login page, or the sign-in link (`{url}` becomes the page to return to) |
| `--login-user <name>` | The username or email (or `SPECTRA_LOGIN_USER`) |
| `--login-wait <s>` | How long to wait for a manual sign-in (default 300) |
| `--login-start`, `--login-user-field`, `--login-password-field`, `--login-submit`, `--login-code-field <css>` | Point at the controls when Spectra can't find them |
| `--sign-in <url>` | The 0.4 sign-in URL template; the same as `--login link --login-url <url>` |

Secrets only come from the environment: `SPECTRA_LOGIN_PASSWORD`, `SPECTRA_LOGIN_TOTP_SECRET` (the base32 secret behind
an authenticator app's QR code), `SPECTRA_LOGIN_HEADER` (`Name: value`), `SPECTRA_LOGIN_COOKIES` and
`SPECTRA_LOGIN_STORAGE` (`name=value; name2=value2`).

**In `spectra.config.json`**, for every tool at once (the non-secret parts only; Spectra refuses a file that holds a
password, a code secret, a header value, cookies or storage entries):

```json
{ "signIn": { "method": "form", "url": "http://localhost:3000/login", "username": "demo@example.com" } }
```

**Keeping secrets safe.** Secrets stay in memory: they are never written to disk, a report, a log or an error message,
and the dashboard's status never carries them. Signing in happens before recording, so no trace contains it. Spectra
never solves CAPTCHAs: it stops before sending anything and asks you to sign in yourself. Use a test account where you
can. If a session expires and the app sends Spectra back to its login page, Spectra signs in again.

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
2. **Vital signs** — four headline cards (**total blocking time, longest task, slowest interaction, wasted
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

- **Page map** — a screenshot of the page *as it was when you pressed Stop*, for any app. The slowest React, Vue or
  Angular components are
  pointed out with **numbers in the left and right margins**, each joined by a thin line to its element (faintly
  outlined on the page). The numbers are spaced so they never overlap, however deeply the elements are nested, and only
  the numbers react to the pointer, so the map stays responsive. **Hover or focus a number** (or its row in the list on
  the right) to highlight that element and open a card with the component's file and line, self time, renders, wasted
  renders, why it rendered and a suggested fix; **click** it to open the source. Orange = most time, amber = mostly
  wasted renders, blue = minor. Limits: the pins need a **development build** of React, Vue or Angular (any other
  app gets the screenshot alone) and a recording made with Spectra 0.5 or later (older reports show a “No page map”
  message); it shows the **viewport**, not the whole
  scrollable page; when a component appears many times only its largest instance is pointed out; page-sized
  wrappers are left out because they say nothing about where the time goes. It shows only what rendered *during the
  recording*.
- **File tree** — every folder and file is **coloured and sized by heat**, hottest first, with the paths to the top
  culprits pre-expanded. Choose the metric: CPU self time, main-thread blocking, component render time, wasted renders,
  component renders, forced reflows. Click a folder to expand, a file to open the side panel (its functions, its
  components, its source with hot functions marked in the gutter). Wheel scrolls, **Ctrl/Cmd + wheel** or pinch zooms.
  Dashed circles are library code.
- **Call tree** — top-down call paths with total and self time; opens on the function with the most self time. Click a
  circle to expand/collapse, a label to open its file.
- **Components** — every React, Vue or Angular component that rendered, under the framework's name: renders,
  **wasted** renders, self time, average and slowest render.
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
   straight from the drop-down, so CLI runs (`spectra performance --quick --runs 3`, or `npm run profile …` in a checkout)
   need no snapshot step. From the terminal, [`spectra compare`](#several-runs-medians-and-compare) gives the same
   verdict without the dashboard.
5. Read the verdict, then press **PDF summary** (for the PR description) or **PDF detailed report** (for the record).

> Why snapshots and not raw traces? A raw Chrome trace has no component data and no source-file attribution; the profiler
> *report* (which is what a snapshot is) holds everything that gets compared. Snapshots are small (typically < 1 MB).

### What you see

- **Commits** — each side's hash, author, date, message, branch, and a warning if it was recorded with **uncommitted
  changes** (the hash then may not describe exactly what was measured). Only the author's *name* is read from git, never
  the email. **⇄** swaps the sides.
- **Verdict** — *Improved*, *Regressed*, *Mixed* or *No significant change*, with a **confidence** level, and counts of
  metrics that improved / degraded / stayed the same. The verdict is decided only by the **key** metrics: total blocking
  time, long tasks, slowest interaction, LCP, layout shift, JavaScript CPU time, forced reflows, wasted component renders and
  JS heap growth. *Improved* = some improved and none degraded; *Regressed* = some degraded and none improved; *Mixed* = both.
- **Highlights** — the biggest moves in plain sentences, e.g. `Total blocking time: 423 ms → 61.4 ms (−85%)` or
  `Row (src/Row.jsx) — renders: 14,400 → 0 (−100%)`.
- **Can this comparison be trusted?** — checks that the two sides are comparable: same page, same mode, same CPU
  throttling, similar recording length, enough runs (3+ per side), component timings present, same file-attribution mode, no
  error pages, no near-idle recordings, no uncommitted changes, and not the same commit on both sides.
- **Metrics** — about 27 metrics in groups (responsiveness, loading, CPU and main thread, layout work, components, memory and DOM,
  network), each with before, after, change, a small bar and an **Improved / Degraded / Unchanged** label. Filter by result.
  Lower is better for every one of them.
- **What changed, in detail** — for **components**, **files** and **functions**: what degraded, what is mixed, what
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
  Chrome open DevTools → **Performance** → **Load profile…** (the ↑ icon) and pick `<id>.trace.json` from the reports folder. Note that the
  report itself (`<id>.json`) is this tool's own format and **cannot** be loaded into DevTools — only the raw
  trace can. The trace of the **most recent recording** is kept in memory so the button always works right after
  recording; for older reports it only works if **save raw trace** was ticked before recording.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `npm install` / `npm run dev` / `npx spectra` fails with syntax or engine errors | Your Node is older than 22.12. Switch this terminal to Node 22.12 or newer (`nvm use 22`). |
| **“Chrome was not found”** | Set `CHROME_PATH` to the executable, e.g. `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run dev`. |
| Chrome opens on an error at the app's login route | The login route may need a different URL or a special query parameter. Give the right **Login page** (or `--login-url`), close Chrome and launch again (see [Signing in](#signing-in)). |
| Red banner “The page answered HTTP 4xx/5xx” | The page failed to load — usually not signed in, or the backend/dev server is down. Check <http://localhost:3000> in a normal browser. |
| Pill “No component framework seen” on a React, Vue or Angular app | Press **Reload** (or use **Record page load**). The probe must load before the framework. On any other app it is expected. |
| “production build: no timings” | The framework is a production build. Profile the dev server, not a built bundle. |
| Report says “Almost nothing ran…” | You recorded an idle page. Interact while recording, or use **Record page load**. |
| Everything is attributed to `bundle:main.js` and notes say “no source maps and no webpack module markers” | You are profiling a production/minified bundle. Use the dev server. |
| Lines show `≈` | Expected for webpack dev bundles (no source maps): the line is located by function name. |
| “Analysing…” takes very long or fails on a huge trace | Record for less time; close other heavy tabs; avoid CPU 6× on very long sessions. |
| **Attach** can't connect | Start Chrome yourself with `--remote-debugging-port=9222 --user-data-dir=/tmp/perf-chrome` (recent Chrome refuses the debugging port on your *default* profile) and use `http://127.0.0.1:9222`. |
| The dashboard's port is in use | `npx spectra dashboard --port 5000` (installed) or `PORT=5190 npm run dev` (checkout). |
| “Chrome could not start because another Chrome is already using the profile…” | The dashboard's Chrome window (or another CLI run) holds Spectra's private profile. Click **Close Chrome** in the dashboard first, or give the second run its own profile: `PERF_CHROME_PROFILE_DIR=/tmp/spectra-2 npx spectra performance …`. |
| `spectra compare`: “… is a golden-path evaluation” | Compare single-page profiles: `spectra performance --quick --runs 5 --out before.json` (and again for `after.json`), or two journey reports by id. |
| A command exits with code `2` | It ran, but a budget in `spectra.config.json` was exceeded, or `compare --fail-on-regression` found a regression. The tables printed above the exit say which. |
| Compare: “This is a raw Chrome trace” | You uploaded a `.trace.json`. Comparison needs the profiler **report**: open it and use **Snapshot for comparison** (the trace has no component or source-file data). |
| Compare: “No commit … in this repository” | The hash is not in your local clone. `git fetch` the PR branch first, then press **Look up** again. |
| Compare: “Chrome was not found” when saving a PDF | PDFs are printed by headless Chrome. Set `CHROME_PATH` (see Configuration). |
| “The raw trace of this recording was not kept” | Only the newest recording's trace is held in memory. Tick **save raw trace** before recording if you want to keep it, or re-record. |
| The launched Chrome has none of your extensions, bookmarks or logins | Expected: it is a separate, clean profile so extensions don't distort measurements. |
| Signed out again after closing Chrome | Expected (session cookies). Turn on **My app needs a sign-in** and Spectra signs in each time. |

If something else is wrong, the profiler's terminal prints server-side errors, and the red bar on the page shows the
message returned to the UI.

## Command line (CI and scripted scenarios)

Everything runs headless, prints the culprits (with their exact functions) and saves the same reports the dashboard
shows. Installed in a project:

```bash
# golden-path suite: self-boots your dev server, discovers journeys and runs them safely
npx spectra performance

# single-page profiles: the fast loop
npx spectra performance --quick                              # one page-load profile
npx spectra performance --quick --runs 5 --out before.json   # median of 5 runs, saved as a result file
npx spectra performance --url http://localhost:3000/ --mode live --duration 15 --throttle 4
npx spectra performance --url http://localhost:3000/ --scenario ./my-scenario.mjs --runs 3

# did a change help?
npx spectra compare before.json after.json --fail-on-regression

# saved reports, newest first
npx spectra reports
```

A scenario module default-exports `async page => { … }` (a Puppeteer `Page`). The recording lasts as long as the
scenario runs, and with `--runs` the page is reloaded before every run. Other flags: `--headed` (watch it run),
`--save-trace` (keep the raw trace) and the `--login…` options (the headless browser starts signed out too; see
[Signing in](#signing-in)). In a
checkout of this repository, `npm run profile -- --url … [options]` runs the same single-page profiler.
`npx spectra --help` lists every option.

### Several runs, medians and compare

`--runs N` records N times in one browser and reports the median of each headline number, its spread, and how many
runs saw each finding; the findings come from the run closest to the medians. `spectra compare` takes, on each side, a
`--out` result file, a report id, a report file or comma-joined ids, and uses the same engine as the dashboard's
Compare commits tab (see [How a change is decided](#how-a-change-is-decided)).

### Budgets and exit codes

`spectra.config.json` in the project root (or the file given with `--config`) sets upper limits:

```json
{ "budgets": { "tbtMs": 200, "lcpMs": 2500, "cls": 0.1, "criticalFindings": 0 } }
```

They are checked against the median of a single-page profile, or against every journey of the golden-path suite;
metrics a recording did not measure are skipped, never failed. Available budgets: `tbtMs`, `lcpMs`, `fcpMs`, `cls`,
`inpMs`, `ttfbMs`, `longTaskCount`, `maxLongTaskMs`, `scriptingMs`, `forcedLayoutCount`, `domNodes`, `heapUsedMb`,
`transferKb`, `criticalFindings`, `findingCount`. An unknown name is an error, so a typo can't pass silently.

Exit codes: `0` done (and within budget), `1` could not run, `2` over budget or, with `--fail-on-regression`, a
regression.

### JSON output

`--json` prints a versioned result on stdout (`schemaVersion`, and a `kind` of `profile`, `evaluation`, `compare` or
`reports`) and moves every human-readable line to stderr; `--out <file>` writes the same result to a file. Results
point at the reports on disk instead of embedding them. The JSON Schemas ship in `schema/` (`result.schema.json`,
`config.schema.json`), and the builders are exported as `@progen-labs/spectra/result` (`shared/result.js`). Saved
reports carry their own `schemaVersion`; additive changes keep it, breaking changes bump it.

## AI assistants (MCP)

`spectra mcp` runs Spectra as a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio, so an AI
coding assistant can profile a page, change the code and prove the change helped. Every profiling tool runs the
regular CLI with `--json` in the project, so its numbers are identical to a run by hand.

| Tool | What it does |
| --- | --- |
| `profile_page` | `url?`, `runs` (default 3), `mode` load/live, `scenario?`, `duration?`, `throttle?` → medians, spread, ranked findings with file, line and fix, and a result file saved in `.spectra/results/` |
| `verify_change` | `baseline` (a `profile_page` result file) → re-profiles the same page the same way and compares: verdict, confidence, metrics beyond the noise, findings resolved and new |
| `compare_profiles` | `before`, `after`: result files, report ids or comma-joined ids → the same comparison, without recording |
| `run_golden_paths` | `url?`, `paths` (default 6) → the journey matrix (safe mode, as in the CLI) |
| `list_reports` | the project's saved reports, newest first |
| `get_report` | `id`, `section`: overview, findings, components, functions, files, long_tasks or network |

- **Project folder**, first match wins: `--project <dir>`, then the client's first MCP root (`roots/list`), then the
  working directory. An unexpanded `${VAR}` passed as `--project` counts as unset.
- **Local pages only.** URLs must be on this machine (`localhost`, `127.x.x.x`, `::1`, `*.localhost`) unless the
  server was started with `--allow-remote` (or `SPECTRA_MCP_ALLOW_REMOTE=1`). Scenario files must be inside the
  project. Results remind the model that text from the page is data, not instructions.
- **One browser at a time**: profiling calls queue, because runs share the project's Chrome profile.
- **Progress and cancellation**: the CLI's status lines become `notifications/progress` (with a `progressToken`);
  `notifications/cancelled` terminates the run, and the CLI's signal handling closes Chrome and stops any dev
  server it started. A cancelled call gets no response, as the protocol requires.
- **No SDK at runtime.** The server implements the stdio transport directly (newline-delimited JSON-RPC 2.0;
  protocol versions 2024-11-05 to 2025-11-25) to keep installs small. `server/test-mcp.js` checks it against the
  official SDK client, which is a dev dependency.

### The Claude Code plugin

`plugins/spectra/` is a Claude Code plugin, listed by the marketplace in `.claude-plugin/marketplace.json` at the
repository root (`/plugin marketplace add progen-labs/spectra`, then `/plugin install spectra@progen-labs`). It
holds `.claude-plugin/plugin.json`, a `.mcp.json` that starts `npx -y @progen-labs/spectra@>=0.3.0 mcp --project
${CLAUDE_PROJECT_DIR}`, and two skills: `improve-performance` (the measure → change → `verify_change` loop, which
Claude uses on its own when asked to make something faster) and `audit` (`/spectra:audit`, a report without code
changes). Keep `plugin.json`'s `version` equal to the package version, and check changes with
`claude plugin validate --strict ./plugins/spectra` and `claude plugin validate --strict .`.

## GitHub Action

`action.yml` (repository root) makes this repository a composite GitHub Action: `uses: progen-labs/spectra@v1`. Its
engine is `action/run.mjs`, with the Markdown in `action/summary.mjs`.

1. **Profile this commit**: `spectra performance --json --out` in `working-directory`, in `quick` mode (`--mode load
   --runs N`) or `golden-paths` mode (`--paths N`), self-booting the dev server unless `url` is given. The Spectra it
   runs is `cli`, else the project's own install, else `npx @progen-labs/spectra@<spectra-version|latest>`; the same
   one is used for both sides of a comparison.
2. **Compare to the base** (`compare-to-base: true`, quick mode, pull requests): fetch the base commit
   (`base-sha` or the event's `pull_request.base.sha`), check it out in a git worktree under `RUNNER_TEMP`, install
   its dependencies (`install-command`, else `npm ci` / `yarn` / `pnpm` from its lockfile, else `npm install`),
   profile it the same way on the same runner, and run `spectra compare base head --json`.
3. **Report**: the Markdown goes to `GITHUB_STEP_SUMMARY` and, with `comment: true`, to one pull request comment that
   is updated on later runs (found by an HTML marker; needs `pull-requests: write`). Outputs: `result-file`,
   `summary-file`, `verdict`, `over-budget`. The next step uploads `.spectra/reports` and the result files as the
   `artifact-name` artifact, even when the check fails.
4. **Decide**: fail when Spectra couldn't run, when a budget is over (`fail-on-budget`, default on) or when the
   verdict is regressed or mixed (`fail-on-regression`, default off).

On Linux runners Chrome runs with `--no-sandbox` (usual for headless Chrome in ephemeral CI) unless
`chrome-sandbox: true`. `.github/workflows/checks.yml` runs this action on the demo app (`uses: ./`) on every change.
`action/test-summary.js` covers the summary and the pass/fail decision. Release by moving the `v1` tag to the new
commit.

## VS Code extension

`vscode/` is a VS Code extension (`progen-labs.spectra-performance`, plain CommonJS, no build step, no runtime dependencies). It is
a thin client: every number comes from the Spectra CLI with `--json`, run in the workspace folder.

- **Which CLI**: the `spectra.cliPath` setting, else the project's `node_modules/@progen-labs/spectra` (it refuses a
  version older than 0.2.0 and offers to update it), else `npx -y @progen-labs/spectra@latest`.
- **Commands**: Profile page load (`performance --mode load --runs N --json --out`), Verify against baseline
  (re-profile the baseline's URL, mode, runs and throttling, then `compare --json`), Choose baseline, Run golden
  paths, Open dashboard (`spectra dashboard` on a free port, shown in the Simple Browser), Clear results, Show output.
  Runs are cancellable from the progress notification; only one runs at a time.
- **What it shows**: `lib/model.js` turns a result file into problems (one per finding and culprit location inside
  the workspace; critical → Warning, warning → Information, info → Hint), CodeLens (components by render time,
  then the project's own hot functions) and the status-bar text. It reads the result's most typical run for the
  CodeLens, and every journey's report for golden-path results.
- **Shared results**: it writes to `.spectra/results/vscode-*.json` and watches `**/.spectra/results/*.json`, so
  results from the CLI (`--out`) or an AI assistant (the MCP server) appear in the editor too. The first profile in
  a workspace becomes the baseline.
- **Agent mode**: on VS Code 1.101+ it registers an MCP server definition provider (`spectra`) that starts
  `spectra mcp --project <workspace>` (via `npx` when the project's Spectra is older than 0.3.0).
- **Tests**: `npm test` in `vscode/` runs the unit tests of `lib/` (no VS Code needed). `npm run test:e2e` runs the
  extension inside an isolated VS Code (downloaded by `@vscode/test-electron`) against the demo app: start it first
  with `npm run demo`. The suite profiles the page, checks the problems at `src/Row.jsx:3` and the `Row` CodeLens, and
  verifies against the baseline.
- **Packaging**: `npx @vscode/vsce package --no-dependencies` produces `spectra-performance-<version>.vsix`.
- **Publishing**: the extension is `progen-labs.spectra-performance` on the VS Code Marketplace (the name `spectra`
  belongs to another publisher there). Upload the `.vsix` on the publisher's manage page, or run `vsce publish`;
  for Open VSX, `npx ovsx publish <vsix>`.

## Configuration

Budgets live in `spectra.config.json` (see [Budgets and exit codes](#budgets-and-exit-codes)). Environment variables,
all optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHROME_PATH` | auto-detected | Chrome/Chromium/Edge executable. |
| `PERF_CHROME_ARGS` | *(none)* | Extra Chrome flags, space separated. |
| `PERF_CHROME_PROFILE_DIR` | `<temp dir>/spectra-chrome/<project>-<hash>` | The tool's private Chrome profile, one per profiled project. Use a different one to run the CLI while the dashboard's Chrome is open. |
| `PERF_FRONTEND_DIR` | the current directory (installed), `../..` (checkout) | Root used to map files, show source and find `spectra.config.json`. |
| `PERF_REPORTS_DIR` | `.spectra/reports` (installed), `reports/` (checkout) | Where reports are saved and read. |
| `PERF_TARGET_URL` | `http://localhost:3000/` | Pre-filled “Page to profile”. |
| `PERF_TARGET_NAME` | the frontend's `package.json` name | Human-friendly name shown in the UI and PDFs. |
| `PORT` | `4321` (`spectra dashboard`), `5178` (`npm run dev`) | Port of the dashboard. |

Data on disk, all git-ignored: the reports folder (reports, page screenshots, optional `.trace.json` files and
golden-path summaries) and Spectra's private Chrome profile in your temp directory.

## How it works and how accurate it is

```
Chrome ──CDP──▶ Tracing      main-thread tasks, layout, style, paint, GC, V8 CPU samples (one clock)
               Debugger      script ids, source-map URLs, script sources
               Runtime       in-page probe: React, Vue and Angular hooks + PerformanceObserver vitals
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
- **Vue and Angular**: the probe also listens on Vue's DevTools hook (component mounts, updates and render time) and
  registers with Angular's development-mode profiler (per-component change detection, nested into self time). All three
  are installed on every page and each wakes up only when its framework appears, so the framework is the one the page
  really runs, wherever Spectra was started from.
- **Builtins** (`Array.sort`, `performance.now`…) are billed to the JavaScript function that called them, and anonymous
  callbacks are named after their enclosing function.
- **Noise control**: the CPU-profiler start-up stall is discarded; LCP/FCP are only reported for page-load recordings;
  ratio-based rules need real activity before they fire.
- Rule thresholds live at the top of each rule in `server/analysis/findings.js`.

**Limits.** The probe and profiler add overhead (the report shows the probe's own cost) — compare recordings taken the
same way. Webpack-concatenated modules are attributed to the first module of the group. Line numbers are best-effort
without source maps. Component data needs a development (or profiling) build of the framework. It measures *your machine*, not production.

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
| **In-page probe** | `Page.addScriptToEvaluateOnNewDocument` + `Runtime.evaluate` | What Chrome's trace *cannot* see from outside the page: which component (React, Vue or Angular) rendered, why, whether it was wasted, plus Web Vitals (long tasks as the browser defines them, layout shifts, LCP/FCP, slow interactions). | `server/probe.browser.js` |

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

**Where each component is on screen (the Page map).** For Vue and Angular, `probe.layout()` asks each element which
component rendered it (`__vueParentComponent`, `ng.getComponent`) and unions those boxes the same way. For React,
the probe remembers every React root it has seen.
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
navigate()        load the target page, signing in first when it asks for a login (signin.js)
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

## spectra improve

`spectra improve` is the main command: measure, have the problems in the project's own code fixed one at a time,
measure each change, keep only what helped. Two modes share the rules in `server/fix/policy.js`:

- **Guided** (`server/improve/`): `spectra improve next | check | report | stop`. `session.js` is the state machine
  (start a session from a baseline, hand out the next problem, judge a change, the report), with every measurement,
  comparison and check passed in, so `test-improve.js` runs it without a browser. `cli.js` keeps the session in
  `.spectra/improve/current.json`, boots the dev server for the commands that measure (unless `--url`), runs the
  profiles through `bin/spectra.js performance --quick --json`, the checks through `fix/checks.js`, and prints the
  text an agent (or a person) acts on; with `--json` the same text is `message` in a `kind: 'improve'` result. The
  caller edits the working tree; Spectra says keep or undo. `spectra improve` with no step and no agent on the
  machine starts a guided session.
- **Unattended** (`server/fix/`, the harness, also `spectra fix`, its old name): a coding agent makes the changes in
  a copy of the last commit. `agent.js` knows the agent CLIs by name (`AGENTS`: Claude Code, Codex, Gemini, Copilot,
  Cursor, OpenCode, Amp: how each takes one prompt in print mode), finds one on the machine (`detectAgent`: the one
  the project or home folder shows signs of, then any installed; `SPECTRA_CLAUDE` names Claude Code's executable) and
  runs it (`namedAgent`), or runs any `--agent "<command>"`. The agent edits; everything else is the harness's code:

- `cli.js` (`runFixCli`): options, the session directory (`.spectra/improve/<time>/`), the dev server, cleanup on
  exit or a signal, the report and the history. Profiles and comparisons run the regular CLI with `--json`, in the copy, with
  `PERF_FRONTEND_DIR` and `PERF_REPORTS_DIR` pointing at the copy and the session.
- `harness.js`: the loop, with every dependency passed in (profile, compare, agent, workspace, checks), so it is tested
  without a browser or a model. Checks must pass before any change; then for each finding: agent → scope rules →
  checks → profile → compare → keep (commit) or undo; low confidence measures again once. Each fix is measured against
  the previous kept state, and the session ends with baseline → final. After a kept fix, a queued finding whose key
  (`findingKey`) the new measurement no longer shows is skipped as already resolved, not handed to the agent.
- `policy.js`: which findings to attempt (critical/warning, in the project's own files, one per file and line, minus
  earlier failures unless `--retry`), the scope rules (no `package.json`, lockfiles, configuration, tests, CI or
  deletions; at most 150 lines), the keep rule (improved, confidence medium or high, no new critical finding in the
  project's own code: a vendor chunk renamed between measurements does not count) and the agent's instructions.
  `shared/compare.js` gives a chunk the same key across content hashes and query strings (`resourceName`), so a
  rebuilt dependency is not "resolved" and "added" at once.
- `workspace.js`: the git worktree of `HEAD` on `spectra/improve-<time>`, `node_modules` linked in (or `--install`),
  `.spectra/` added to `.git/info/exclude`, diffs, commits of exactly the changed files, `reset --hard` + `clean` to
  undo, removal (the branch stays only if it has commits).
- `agent.js`: Claude Code headless (`-p`, `acceptEdits`, tools Read/Edit/Write/Glob/Grep, Bash/WebFetch/WebSearch
  disallowed, `--strict-mcp-config`, `--no-session-persistence`, `--max-budget-usd`), or any `--agent` command (the
  instructions on stdin and in `$SPECTRA_FIX_PROMPT_FILE`, the finding in `$SPECTRA_FIX_FINDING`). Errors such as
  "not logged in" stop the session at once.
- `checks.js`: detected checks (`test` unless npm's placeholder, a type-check script, `build`) or `--check`, run with
  `CI=1` and `$SPECTRA_FIX_URL`.
- `report.js`: the Markdown report.

`server/fix/test-fix.js` covers the rules, the loop with fakes and the git copy in a throwaway repository. The test
bench (`bench/`, `npm run bench`) runs the real thing against a copy of the React demo app with a behaviour check, and
a scripted agent applies known changes: `memoize` must be kept, `breaks-page` must fail the checks, `no-gain` must not
count, `touches-config` must be refused. `--agent claude` (or any command) scores a real agent instead. CI runs the
scripted bench on every push. The first real-agent run (Claude Code, 17 October 2026) kept two of three fixes and cut
JavaScript CPU time from 1.51 s to 82.5 ms for $0.44; its one wasted attempt, on a finding the first fix had already
cleared, is why the loop now skips resolved findings.

## Privacy and safety

- Everything runs locally. The UI server binds to `localhost`; **don't pass `--host`** unless you accept exposing your
  source tree and browser session to your network.
-- The API only reads files inside the configured frontend root (and the demo app) and refuses path traversal.
- No credential is ever entered into, stored by or written to a report by this tool. Reports contain performance data,
  file paths, function names and URLs (including query strings, which may contain IDs) — review a report before sharing it.
- The **Page map screenshot** (`<id>.page.jpg` in the reports folder) is a picture of the profiled page and can show whatever data
  was on screen (names, numbers, customer data). Reports are git-ignored, but treat the image like the report: review it
  before sharing, and **Delete** removes it together with the report.
- The tool's private Chrome profile (in your temp directory, under `spectra-chrome/`) can contain cookies for the app
  after you sign in. It is separate from your own Chrome profile and never inside your repository.
- `spectra dashboard` listens on `127.0.0.1` only.
- `spectra improve` sends nothing itself, but the coding agent it runs unattended (or the one you talk to in the
  guided loop) reads the files it works on and sends them to its provider. Unattended changes stay on a local branch
  until you merge them.

## Project layout and contributing

```
bin/spectra.js             the CLI: improve, performance, compare, reports, dashboard, mcp, agents
server/probe.browser.js    in-page probe (React / Vue / Angular hooks + vitals + component screen positions), injected before the app loads
server/chrome.js           find / launch / attach Chrome
server/recorder.js         CDP orchestration: start/stop, trace stream, metrics, sign-in, component locations
server/agents.js           the knowledge doc for AI agents: where each agent reads it, install and remove
server/signin.js           signing in: login forms (frames, shadow DOM, two steps, TOTP codes), prompts, tokens, links
server/git.js              commit / author lookup (name only, never the email)
server/pdf/                comparison PDF: print-ready HTML (template.js) + headless-Chrome printing (render.js)
server/analysis/           trace.js · cpu.js · sources.js · locate.js · report.js · findings.js
server/explore/            dev-server boot, actionable-element discovery, golden-path synthesis and runner
server/cli.js              single-page profiles (--quick, --mode, --runs, --scenario)
server/compare-cli.js      spectra compare
server/reports-cli.js      spectra reports
server/mcp.js              spectra mcp: the MCP server (stdio)
server/improve/            spectra improve: the command, and the guided session (next, check, report, stop)
server/fix/                spectra improve, unattended: the harness (cli, loop, policy, workspace, agents, checks, report)
server/args.js, output.js, project-config.js   argv parsing; --json/--out and exit codes; spectra.config.json
server/api.js              the dashboard's /api/* endpoints + Server-Sent Events
server/plugin.js           mounts that API in the Vite dev server (npm run dev)
server/dashboard.js        standalone dashboard: serves dist/ + the same API (spectra dashboard)
shared/compare.js          the diff engine; used by the Compare tab, the PDF and spectra compare, so they always agree
shared/result.js           summaries, budgets and the versioned --json results
shared/snapshot.js         snapshot file naming, validation, commit-from-filename
schema/                    JSON Schemas for the results and spectra.config.json
src/                       React + d3 dashboard (App, components/, hooks/, heat.js, layout.js)
src/theme.js, themes.css   theme + light/dark mode (CSS variables per theme; see Appearance and themes)
src/culprits.js            merges findings into the top culprits and groups findings by root cause
src/components/            CulpritsHero + CulpritSphere (top culprits), FindingsList, Vitals, PageMap, AppearanceMenu, Popover, …
fixtures/                  demo apps with deliberate performance bugs: demo-app (React; npm run demo, ?fixed=1 is the
                           "optimised" variant), vue-demo, angular-demo
scripts/docs-screenshots.mjs   captures the annotated screenshots for the website docs (not published to npm)
plugins/spectra/           the Claude Code plugin (skills + MCP server config)
vscode/                    the VS Code extension (extension.js, lib/, tests)
action.yml, action/        the GitHub Action (run.mjs, summary.mjs, test-summary.js)
bench/                     the AI fix harness's test bench (npm run bench; not published to npm)
video/                     the docs' demo videos, made with Remotion from a real VS Code recording and real MCP
                           output (own package.json; not published to npm; see video/README.md)
.github/workflows/         checks.yml (every check; spectra-bot's report), pr-comment.yml, release.yml,
                           release-vscode.yml, codeql.yml, scorecard.yml
.claude-plugin/            the plugin marketplace (marketplace.json)
server/testing/            fixtures shared by the tests (synthetic reports, throwaway projects)
docs/                      images used by the README
reports/  .spectra/        generated data (git-ignored)
```

- `npm test` runs the analysis, comparison, result, CLI, MCP and Action tests (`node --test`, test files named `test-*.js`).
  The CLI and MCP tests drive `bin/spectra.js` against synthetic reports, so they need no Chrome; the MCP tests
  include a conformance check with the official MCP SDK client.
- The tool is plain JS/JSX with its own dependencies (`npm install` in this folder only). `npm run build` produces the
  prebuilt dashboard in `dist/` (it also runs before every publish), and `spectra dashboard` serves it together with
  the same API the dev server mounts. Use `npm run dev` while working on the dashboard itself.
- Only `puppeteer-core` and `@jridgewell/trace-mapping` are runtime dependencies. The dashboard's libraries (React,
  d3, highlight.js) are dev dependencies because they are bundled into `dist/`; keep it that way, so installs stay small.
- Command-line output: in `--json` mode stdout carries only the JSON, so human-readable lines go to stderr (see
  `server/output.js`). Exit codes are `0`, `1` (could not run) and `2` (budget or regression).
- Styling is plain CSS. **Colours come only from the variables in `src/themes.css`** (one block per theme × mode); do
  not hard-code colours in `styles.css` or components, or they will look wrong in one of the four palettes.
- To add a culprit rule, add it to `buildFindings` in `server/analysis/findings.js` (return evidence, `culprits` and a
  `fix`) and cover it in `server/test-analysis.js`.
- **Docs.** The user guide lives in the [Progen Labs website](https://github.com/progen-labs/website) repository
  (`src/spectra-docs/pages/*.md`); update it along with any user-facing change. Its annotated screenshots come from
  `scripts/docs-screenshots.mjs`, which drives a running dashboard, saves one `.webp` per screen and measures where each
  numbered region is (`manifest.json`), so the call-outs stay aligned. The recording steps are on the guide's
  [Contributing page](https://progen-labs.github.io/website/#spectra/docs/contributing). `docs/dashboard.webp` in this
  repository is a copy of its `dashboard-overview` screenshot.

## Project health checks (for maintainers)

**`checks.yml`** runs every check on each pull request, on every push to `main` (the README's badges show `main`) and
every Monday (for new security advisories):

| Job | What it checks |
| --- | --- |
| **Lint** | `npm run lint` (ESLint, `eslint.config.js`): undefined names, unused code, React hooks; no warnings allowed |
| **Tests** | `npm test` on Node 22 and 26 (Linux: the oldest and newest supported) and Node 24 (macOS); on Node 26, `npm run test:coverage` instead, which fails below 70% of lines, 70% of branches or 72% of functions in `server/`, `shared/` and `bin/`; the VS Code extension's tests on Linux |
| **Package** | `publint --strict`, then the packed package installed in a new project and run (`--version`, `--help`, `agents --print`, `reports`) on Linux with Node 22 and on Windows. It also builds the dashboard, as does Size budget, so there is no separate build job |
| **Links** | lychee (`lychee.toml`): every link in the README, DOCS.md, CONTRIBUTING.md, CHANGELOG.md and the other docs; on a pull request only when Markdown changed |
| **Size budget** | `scripts/size-report.mjs`: the npm package, the install with its dependencies, the number of packages and the dashboard bundle (`size-limit` in `package.json`), against budgets; on a pull request, compared with its base |
| **npm audit** | `main` and weekly: the runtime dependencies; high or critical fail it. Not on pull requests, where Dependency review checks what the change adds (npm audit would fail them for older problems) |
| **Dependency review** | pull requests only: new dependencies with known vulnerabilities (high or critical fail it) or a license outside the permissive list in `checks.yml` (MIT, ISC, Apache-2.0, BSD, MPL-2.0 and similar) |
| **Snyk** | `main` when a `package.json` changes, weekly and on demand (the free plan has a monthly budget): `snyk test`, every severity to the Security tab, high or critical fail it (`scripts/snyk-summary.mjs`). Snyk's GitHub integration checks pull requests |
| **Fix harness bench** | `bench/run.mjs`: `spectra improve` decides each scripted case correctly; a wrong decision is an annotation on the run |
| **GitHub Action** | this repository's action on the demo app finds the planted slow component |
| **PR report** | pull requests only: every job's result, linked to its job, and for each failure the failing step (linked to that line of the log), the files and lines it points at (lint problems, failing tests and where they were thrown, the bench) and the end of the log (`scripts/ci/pr-report.mjs`) |

Every action is pinned to a commit (with its version in a comment, which Dependabot keeps current), and CI installs
from the committed `package-lock.json` with `npm ci`.

**`release.yml`** publishes a release when a `v<version>` tag is pushed (`npm version …` then `git push --follow-tags`). A version that is already on npm (published by hand with `npm publish`, with 2FA) is not published again: the workflow still creates the GitHub Release and moves `v1`:
it runs `checks.yml`, waits for approval in the `release` environment, publishes to npm with provenance (npm Trusted
Publishing), creates the GitHub Release with the version's section of CHANGELOG.md (`scripts/release-notes.mjs`), the
package and a CycloneDX SBOM, each with a build attestation, and moves the GitHub Action's `v1` tag.
**`release-vscode.yml`** does the same for the VS Code extension on `vscode-v<version>` tags: its tests, the `.vsix`,
the Marketplace and Open VSX. Both run only in `progen-labs/spectra`, never in the mirror.

**`pr-comment.yml`** posts that report on the pull request as **spectra-bot**, as one comment updated on every push,
with the checks other apps ran on the commit (CodeQL, Socket, Snyk's app). It runs as a `workflow_run`, from the
default branch's code, so it also works for pull requests from forks. **`codeql.yml`** is GitHub's code scanning,
**`scorecard.yml`** the OpenSSF Scorecard, and **`.github/dependabot.yml`** opens weekly, grouped updates for npm and
the workflows' actions. Socket's GitHub app follows `socket.yml`.

`npm run lint` and `npm run size` run the same checks locally. To change a size budget, edit `BUDGET` in
`scripts/size-report.mjs` or `size-limit` in `package.json`, and say why in the commit.

**One-time setup** (each needs the repository owner's account):

1. **spectra-bot**: create a GitHub App named **spectra-bot** (*progen-labs → Settings → Developer settings → GitHub
   Apps → New GitHub App*): any homepage URL (the repository's), webhook off, repository permissions *Pull requests:
   Read and write*, *Issues: Read and write*, *Checks: Read-only*, installable *Only on this account*. Generate a
   private key, install the app on `progen-labs/spectra`, then add the app's ID as the repository **variable**
   `SPECTRA_BOT_APP_ID` and the private key (the whole `.pem` file) as the **secret** `SPECTRA_BOT_PRIVATE_KEY`.
   Until then the comment comes from github-actions[bot].
2. **Snyk**: sign in at [snyk.io](https://snyk.io) with GitHub (free for open source).
   - Create a token (*Account settings → Personal Access Tokens*, with an expiry) and add it as the repository secret
     `SNYK_TOKEN` (*Settings → Secrets and variables → Actions*). Without it the Snyk job notes that it skipped.
   - *Import GitHub Projects* → `progen-labs/spectra` (not the `debnathSD` mirror), with `fixtures, video` under
     *Exclude folders*. If `progen-labs` repositories don't appear, grant Snyk access to the organization in GitHub
     (*Settings → Applications → Authorized OAuth Apps → Snyk*).
   - In Snyk's GitHub integration settings: tick *Only fail for high or critical severity issues*, untick *Create
     comments for success cases* (spectra-bot reports already), and leave *Automatic dependency upgrade PRs* off
     (Dependabot does that).
3. **Socket**: install the [Socket GitHub app](https://github.com/apps/socket-security) on `progen-labs` and give it
   this repository.
4. **Branch protection** for `main` (*Settings → Rules → Rulesets*): require pull requests, and require the checks
   *Lint*, *Tests (Node 22, ubuntu-latest)*, *Tests (Node 26, ubuntu-latest)*, *Tests (Node 24, macos-latest)*,
   *Package (Node 22, ubuntu-latest)*, *Package (Node 24, windows-latest)*, *Links*, *Size budget*, *Dependency review*,
   *Fix harness bench*, *GitHub Action* and *Analyze (javascript-typescript)* to pass. Scorecard
   rewards it too.
5. **Private vulnerability reporting**, **secret scanning with push protection**, the **Dependency graph** (Dependency
   review needs it) and **Dependabot alerts and security updates**: turn them on under *Settings → Code security*.
6. **The `release` environment** (*Settings → Environments → New environment* `release`): add yourself under
   *Required reviewers*, and under *Deployment branches and tags* allow only tags matching `v*` and `vscode-v*`. Every
   release then waits for your approval.
7. **npm Trusted Publishing** (*npmjs.com → @progen-labs/spectra → Settings → Trusted Publisher → GitHub Actions*):
   organization `progen-labs`, repository `spectra`, workflow `release.yml`, environment `release`. Then, under
   *Publishing access*, require two-factor authentication and disallow tokens. Until it is set up, a granular npm
   token in the secret `NPM_TOKEN` works instead (delete it afterwards).
8. **The VS Code extension**: a Marketplace token in the secret `VSCE_PAT`, and an Open VSX token (namespace
   `progen-labs`) in `OVSX_PAT`. Without them those steps note that they skipped.
9. **Actions settings** (*Settings → Actions → General*): workflow permissions *Read repository contents*, *Allow
   GitHub Actions to create and approve pull requests* off, and allow only GitHub's actions, verified creators and
   `lycheeverse/lychee-action`, `ossf/scorecard-action`.
10. **A tag ruleset** for `v*.*.*` and `vscode-v*` (restrict updates and deletions, with the admin bypass). Leave `v1`
    out of it: the release workflow moves it.
11. **The OpenSSF Best Practices badge**: register the project at [bestpractices.dev](https://www.bestpractices.dev).

## Appearance and themes

Open **Appearance** in the top bar and choose:

- **Theme** — **Liquid Glass** (frosted, translucent panels, capsule buttons, soft gradient backdrop) or **Space**
  (deep-space mission-control look: starfield, indigo/cyan glow, tighter corners).
- **Mode** — **Light**, **Dark** or **Auto** (follows your operating system and changes live when it does).

Both themes have a full light and dark palette, so there are four looks. The choice is remembered in this browser
(`localStorage`) and applied before the first paint, so there is no flash of the wrong theme. To add a theme, add a
`:root[data-theme='…'][data-mode='…']` block to `src/themes.css` with the same variables and list it in `src/theme.js`.
