# Security

## Reporting a vulnerability

Please report security issues privately, through GitHub:
[report a vulnerability](https://github.com/progen-labs/spectra/security/advisories/new). Don't open a public issue
for them. You'll get a reply within a few days, and a fix as soon as it is ready, with credit if you'd like it.

Spectra is maintained by one person, in their own time, so there's no bounty.

## Supported versions

The latest release on npm gets security fixes.

## What Spectra does on your machine

- It drives a local Chrome to profile your app and keeps everything on your machine: no account, no telemetry,
  nothing uploaded. The dashboard listens on `127.0.0.1` only.
- Spectra has no install script. The first time it runs in your project, it writes its knowledge doc for AI agents
  into your project's agent instruction files (`AGENTS.md` and the like). It never does in CI, and sends nothing. Turn it off with
  `SPECTRA_AGENT_DOCS=0` or `"agentDocs": false` in `spectra.config.json`, and remove it with
  `npx spectra agents --remove`.
- Passwords, tokens and cookies for signing in come from the dashboard or environment variables and stay in memory.

## How dependencies are checked

Every push and pull request runs `npm audit`, Snyk (results in the repository's Security tab) and, on pull requests,
GitHub's dependency review. Socket reviews each pull request that changes dependencies. See the badges in the
[README](README.md).
