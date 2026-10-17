# Spectra's demo videos

Made with [Remotion](https://www.remotion.dev); this folder is not part of the
npm package.

- `launch`: the launch film (1920 × 1080, 60 fps, about 2½ minutes), from the
  MCP server and Claude Code to VS Code, the npm package, its CLI, comparing
  two commits with the PDF reports, the AI fix harness, frameworks and open
  source. It is cut to the music, 80 bars at 128 BPM (`src/launch/timeline.js`).
- `vscode`, `claude-code`, `mcp-server`, `fix-harness`: the short videos on the
  docs pages. `fix-harness` shows a real test-bench session of `spectra fix`.
- `feature-*`: fourteen silent loops (960 × 540, 30 fps) for the feature cards
  on the Spectra page, six seconds each except `feature-compare` (21 seconds:
  it takes both PDF reports apart). They loop seamlessly.

The 3D is real WebGL ([three.js](https://threejs.org) through
`@remotion/three`): lit, clear-coated materials with soft shadows
(`src/three/`). Falling, stacking and bouncing objects use rigid-body physics
([cannon-es](https://github.com/pmndrs/cannon-es)), simulated once and
replayed, so every frame renders the same on any machine. The feature scenes
(`src/scenes3d/features.jsx`) are timed in seconds and play both as the loops
and inside the film.

Nothing in them is mocked up:

- **VS Code** is a screen recording of a real, isolated VS Code with the
  packaged extension, driven through the whole workflow on the demo app.
  `scripts/record-vscode.mjs` saves the recording and a marker for every step
  (`public/footage/vscode.json`, kept in git), with the texts VS Code showed. The edit in
  `src/vscode/edit.js` cuts, speeds up and frames the footage from those
  markers, and every number on screen comes from them.
- **Claude Code** and **MCP server** are motion graphics around the real output
  of Spectra's MCP server on the demo app, kept in `src/data/session.js`.
- **Compare two commits** is the real dashboard. `scripts/record-compare.mjs`
  builds a git copy of the demo app with two commits, the app as it is and
  the fixes Claude Code made in the fix-harness bench (`scripts/compare/*.patch`),
  profiles each three times, fills the Compare tab, screenshots it and
  downloads both PDF reports, rendering their pages with
  `scripts/compare/pdf2png.swift` (macOS). The results are in `public/compare/`.
- Everything else in the film and the loops is real output too, in
  `src/data/launch.js`: a one-command run on the demo app, its components, and
  the docs' real compare, budget and pull request examples.
- The music and sound effects are original, synthesised in code
  (`scripts/synth.js`), so there is nothing to license: an uplifting 128 BPM
  track in a clean corporate-tech style (piano, warm pads, a steady bass, soft
  drums). Every cut lands on a beat, the final chord hits as the end card
  lands, and the sound is normalised to -16 LUFS.

## Make them

```bash
npm install
```

The VS Code footage itself (`public/footage/vscode.mp4`) is not in git. To
record it (macOS), start the demo app with `npm run demo` in the
repository root, package the extension (`npx @vscode/vsce package
--no-dependencies` in `vscode/`), run its end-to-end test once
(`npm --prefix ../vscode run test:e2e`, which downloads the VS Code build),
then:

```bash
npm run record:vscode
```

The Compare two commits footage and PDF pages (needs macOS for the PDF pages):

```bash
node scripts/record-compare.mjs
```

Render into `out/` (a master, a web copy in `out/web/` and a poster each):

```bash
npm run render              # the three docs videos
npm run render -- launch    # the launch film
npm run render -- features  # the fourteen feature loops
```

After a change to the music or sound effects only, `npm run render:audio`
renders just the sound again and swaps it into the existing videos.

`npm run studio` opens Remotion Studio for live editing, and
`npm run stills -- <id> <second> …` saves single frames to `out/stills/`.
Copy the docs videos to the website's `src/spectra-docs/videos/`, the film to
`src/assets/spectra/launch.mp4` and the loops to `src/assets/spectra/features/`.

Remotion is free for individuals and non-profit organisations; see its
[license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
