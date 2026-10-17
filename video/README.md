# Spectra's demo videos

The short videos on the Spectra docs pages (VS Code extension, Claude Code
plugin, MCP server), made with [Remotion](https://www.remotion.dev) at
1920 × 1080 and 60 fps. This folder is not part of the npm package.

Nothing in them is mocked up:

- **VS Code** is a screen recording of a real, isolated VS Code with the
  packaged extension, driven through the whole workflow on the demo app.
  `scripts/record-vscode.mjs` saves the recording and a marker for every step
  (`public/footage/vscode.json`, kept in git), with the texts VS Code showed. The edit in
  `src/vscode/edit.js` cuts, speeds up and frames the footage from those
  markers, and every number on screen comes from them.
- **Claude Code** and **MCP server** are motion graphics around the real output
  of Spectra's MCP server on the demo app, kept in `src/data/session.js`.
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

Render all three, or some, into `out/` (a master, a web copy in `out/web/`
and a poster each):

```bash
npm run render
npm run render -- vscode
```

After a change to the music or sound effects only, `npm run render:audio`
renders just the sound again and swaps it into the existing videos.

`npm run studio` opens Remotion Studio for live editing, and
`npm run stills -- <id> <second> …` saves single frames to `out/stills/`.
Copy the results to the website's `src/spectra-docs/videos/`.

Remotion is free for individuals and non-profit organisations; see its
[license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
