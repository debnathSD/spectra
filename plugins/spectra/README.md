# Spectra for Claude Code

Find the file, function and component that make your frontend slow, fix them, and prove each fix with
before/after measurements, from inside Claude Code. Free and open source, by [Progen Labs](https://github.com/progen-labs).

## Install

```
/plugin marketplace add progen-labs/spectra
/plugin install spectra@progen-labs
```

Spectra needs Node.js 18+ and a local Chrome, Chromium or Edge. For the fastest start, also add it to your
project: `npm install --save-dev @progen-labs/spectra`.

## Use

- Ask in plain words: *"make the dashboard page faster"*, *"why does clicking Save feel slow?"*. The
  **improve-performance** skill profiles the page, fixes one finding at a time, and keeps a change only when
  Spectra measures an improvement.
- `/spectra:audit [url]` profiles the page and its user journeys and reports the problems, without editing code.

The plugin runs Spectra's MCP server (`npx @progen-labs/spectra mcp`) with these tools: `profile_page`,
`verify_change`, `compare_profiles`, `run_golden_paths`, `list_reports` and `get_report`.

Full guide: <https://progen-labs.github.io/website/#spectra/docs/claude-code>

<p align="center">
  <a href="https://progen-labs.github.io/website/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://progen-labs.github.io/website/brand/progen-seed-mark.svg">
      <img alt="Progen Labs" src="https://progen-labs.github.io/website/brand/progen-seed-mark-light.svg" height="72">
    </picture>
  </a>
  <br>
  <sub>Spectra is a <a href="https://progen-labs.github.io/website/">Progen Labs</a> project: open source, nonprofit, always free.</sub>
</p>
