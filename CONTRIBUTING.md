# Contributing to Spectra

Thanks for helping. Bug reports, ideas, docs fixes and code are all welcome. Spectra is maintained by one person in
their own time, so a small, focused pull request with a clear description gets merged fastest.

## Ways to help

- **Report a bug** or **suggest a feature** with the [issue forms](https://github.com/progen-labs/spectra/issues/new/choose).
  For a bug, the Spectra version (`npx spectra --version`), your framework, Node.js and OS, and the command you ran
  make it much easier to reproduce.
- **Report a security problem** privately, never in an issue: see [SECURITY.md](SECURITY.md).
- **Improve the docs**: the README, [DOCS.md](DOCS.md), and the [website's docs](https://github.com/progen-labs/website/tree/main/src/spectra-docs/pages).
- **Send a pull request** for an open issue. For anything big, open an issue first, so we can agree on the approach.

## Setting up

You need Node.js 22.12 or newer, git, and Chrome, Chromium or Edge.

```bash
git clone https://github.com/progen-labs/spectra.git
cd spectra
npm ci
npm test            # every test (Chrome-based ones are skipped without Chrome)
npm run lint        # ESLint
npm run dev         # the dashboard in development, on http://localhost:5178
npm run demo        # a React app with planted performance bugs, on http://localhost:5188
```

`node bin/spectra.js …` runs your working copy of the CLI. [DOCS.md](DOCS.md#project-layout-and-contributing)
describes the project layout and how each part works.

## Making a change

1. Branch from `main`, and keep the change to one subject.
2. Add or update tests next to the code (`server/**/test-*.js`, run with Node's test runner). For a pure function
   with a rule that must always hold, add a property to `server/test-properties.js` (fast-check).
3. Run `npm test` and `npm run lint`.
4. When behaviour changes, update the README, DOCS.md and the website's docs pages, and add a line to the top
   section of [CHANGELOG.md](CHANGELOG.md).
5. Open a pull request and fill in the template.

**spectra-bot** then comments on the pull request with the result of every check: lint, the tests on Linux and macOS
(with coverage), the packed package on Linux and Windows, links, size budgets, dependency review, the fix harness's
bench and the GitHub Action. For anything that fails it links the failing step, file and line. CodeQL and Socket check
every pull request too.

## Style

- Plain JavaScript (ES modules), no build step for the CLI. Match the surrounding code; ESLint catches the rest.
- Comments say *why*, not *what*.
- User-facing text is plain and specific: say what happened and what to do next.
- Never write a secret (a password, a token) to disk, a report, a log or an error message.

## Releasing (maintainers)

1. Add a `## <version> (<date>)` section to CHANGELOG.md.
2. `npm version <patch|minor|major>` and `git push --follow-tags`.
3. The [Release workflow](.github/workflows/release.yml) runs every check, waits for approval in the `release`
   environment, publishes to npm with provenance, creates the GitHub Release (notes, package, SBOM, attestations) and
   moves the GitHub Action's `v1` tag.

The VS Code extension has its own tags (`vscode-v<version>`) and [workflow](.github/workflows/release-vscode.yml).

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE), and to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
