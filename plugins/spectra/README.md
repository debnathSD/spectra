# Spectra for Claude Code

Find the file, function and component that make your frontend slow, fix them, and prove each fix with
before/after measurements, from inside Claude Code. Free and open source, by [Progen Labs](https://github.com/progen-labs).

## Install

```
/plugin marketplace add progen-labs/spectra
/plugin install spectra@progen-labs
```

Spectra needs Node.js 22.12 or newer and a local Chrome, Chromium or Edge. For the fastest start, also add it to
your project: `npm install --save-dev @progen-labs/spectra`.

## Use

- Ask in plain words: *"improve the performance"*, *"make the dashboard page faster"*, *"why does clicking Save
  feel slow?"*. The **improve-performance** skill runs Spectra's loop: Spectra measures and names the problem,
  Claude makes one change, Spectra measures it and says keep or undo, and so on, then reports the before → after.
- `/spectra:audit [url]` measures the page and its user journeys and reports the problems, without editing code.

The plugin runs Spectra's MCP server (`npx @progen-labs/spectra mcp`) with these tools: `improve_next`,
`improve_check`, `improve_report`, `profile_page`, `verify_change`, `compare_profiles`, `run_golden_paths`,
`list_reports` and `get_report`.

Full guide: <https://progen-labs.github.io/website/#spectra/docs/claude-code>

<p align="center">
  <a href="https://progen-labs.github.io/website/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://progen-labs.github.io/website/brand/progen-seed-mark.svg">
      <img alt="Progen Labs" src="https://progen-labs.github.io/website/brand/progen-seed-mark-light.svg" height="72">
    </picture>
  </a>
  <br>
  <sub>Spectra is a <a href="https://progen-labs.github.io/website/">Progen Labs</a> project: independent, open source, always free.</sub>
</p>
