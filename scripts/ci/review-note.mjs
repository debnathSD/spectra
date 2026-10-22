#!/usr/bin/env node
// The PR report's note for GitHub's dependency review: each new or changed
// dependency with a known vulnerability (and its advisory) or a license problem.
// Reads the action's outputs from the environment: RESULT, VULNERABLE, LICENSES, DENIED.
const parse = (s, fallback) => {
  try {
    return JSON.parse(s || '') ?? fallback;
  } catch {
    return fallback;
  }
};
const vulnerable = parse(process.env.VULNERABLE, []);
const licenses = parse(process.env.LICENSES, {});
const denied = parse(process.env.DENIED, []);
const pkg = c => `\`${c.name}@${c.version}\`${c.manifest ? ` (${c.manifest})` : ''}`;
const lines = [];
for (const c of vulnerable)
  for (const v of c.vulnerabilities || [])
    lines.push(`- ${pkg(c)}: **${v.severity}** [${v.advisory_ghsa_id}](${v.advisory_url}) ${String(v.advisory_summary || '').replace(/\|/g, '\\|')}`);
for (const [kind, list] of Object.entries(licenses || {}))
  for (const c of list || []) lines.push(`- ${pkg(c)}: license ${kind} (${c.license || 'none found'})`);
for (const c of denied) lines.push(`- ${pkg(c)}: denied by the repository's dependency policy`);

if (lines.length) console.log([`${lines.length} problem${lines.length === 1 ? '' : 's'} in new or changed dependencies:`, '', ...lines].join('\n'));
else if (process.env.RESULT === 'success') console.log('No new dependencies with known vulnerabilities or license problems.');
else console.log('Dependency review could not check this change (see its log below).');
