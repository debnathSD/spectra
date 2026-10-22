/**
 * After `npm install @progen-labs/spectra`: teaches the AI agents this project
 * or machine uses about Spectra (server/agents.js), so they can run its
 * commands when asked in plain words. It never fails an install, never runs in
 * CI, for global installs or for `npx`, and is off with SPECTRA_AGENT_DOCS=0
 * or `"agentDocs": false` in spectra.config.json. `npx spectra agents` does the
 * same by hand (for package managers that skip install scripts), and
 * `npx spectra agents --remove` takes it all back out.
 */
try {
  const { installAgentDocs, postinstallPlan } = await import('./agents.js');
  const plan = postinstallPlan();
  if (!plan.skip) {
    const changed = installAgentDocs({ root: plan.root, targets: plan.targets }).filter(r => r.result === 'created' || r.result === 'updated');
    if (changed.length)
      console.error(`spectra: taught your AI agents about Spectra (${changed.map(r => r.file).join(', ')}). Undo: npx spectra agents --remove`);
  }
} catch {
  // an install must never fail because of this
}
