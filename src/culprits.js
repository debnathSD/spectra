export const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };

export const SEVERITY = {
  critical: { label: 'Critical', icon: '✕' },
  warning: { label: 'Warning', icon: '!' },
  info: { label: 'Note', icon: 'i' },
};

const isVendorFile = file => file.includes('node_modules/');
const higher = (a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a);

export const culpritKey = c => `${c.fn || c.name}|${c.file}`;

/** The finding to quote a fix from: most severe, then biggest impact. */
function leadFinding(findings) {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.impactMs - a.impactMs,
  )[0];
}

/**
 * The functions behind the report, merged across findings: one entry per
 * function with its worst severity, the time it cost and the findings it
 * appears in. Time is the largest figure seen (not a sum) because the same
 * work is counted again by the total-blocking-time finding.
 */
export function topCulprits(report, hideVendor, limit = 12) {
  const map = new Map();
  const entryFor = (key, base) => {
    let e = map.get(key);
    if (!e) {
      e = {
        ...base,
        key,
        ms: 0,
        severity: 'info',
        findings: [],
        categories: new Set(),
      };
      map.set(key, e);
    }
    return e;
  };
  for (const f of report.findings) {
    for (const c of f.culprits || []) {
      if (!c.file || (hideVendor && isVendorFile(c.file))) continue;
      const e = entryFor(culpritKey(c), {
        name: c.fn || '(unknown)',
        file: c.file,
        line: c.line,
        lineKind: c.lineKind,
        abs: c.abs,
      });
      e.ms = Math.max(e.ms, c.ms || 0);
      e.severity = higher(e.severity, f.severity);
      e.findings.push(f);
      e.categories.add(f.category);
    }
  }
  for (const h of report.hotFunctions || []) {
    if (!h.file || (hideVendor && h.vendor)) continue;
    const e = entryFor(culpritKey({ fn: h.name, file: h.file }), {
      name: h.name,
      file: h.file,
      line: h.line,
      lineKind: h.lineKind,
      abs: h.abs,
    });
    e.ms = Math.max(e.ms, h.selfMs || 0);
    if (!e.findings.length && h.share >= 10) e.severity = 'warning';
  }
  return [...map.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit)
    .map(e => ({
      ...e,
      categories: [...e.categories],
      lead: e.findings.length ? leadFinding(e.findings) : null,
    }));
}

/**
 * Collapses findings that blame the same function (typically a dozen long
 * tasks all caused by one library call) into one group, so the list shows
 * root causes instead of repeating them.
 */
export function groupFindings(findings) {
  const buckets = new Map();
  const order = [];
  for (const f of findings) {
    const first = f.culprits?.[0];
    const key = first?.file ? culpritKey(first) : `solo:${f.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key).push(f);
  }
  const items = order.map(key => {
    const members = buckets.get(key);
    if (members.length === 1)
      return {
        kind: 'single',
        id: members[0].id,
        severity: members[0].severity,
        impactMs: members[0].impactMs,
        finding: members[0],
      };
    const lead = leadFinding(members);
    return {
      kind: 'group',
      id: `group:${key}`,
      severity: members.reduce((s, m) => higher(s, m.severity), 'info'),
      impactMs: Math.max(...members.map(m => m.impactMs)),
      culprit: lead.culprits[0],
      lead,
      members: [...members].sort((a, b) => b.impactMs - a.impactMs),
    };
  });
  return items.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.impactMs - a.impactMs,
  );
}
