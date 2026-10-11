/**
 * Golden-path synthesis: turn a ranked, classified element inventory (from
 * discover.js) into a small set of automation journeys the runner can drive.
 *
 * Heuristic and deterministic — no AI, no network. Safe by default: a journey
 * only submits a form when that form's submit is non-destructive, and
 * destructive controls are never clicked unless the caller allowlisted them
 * (partitionSafe has already filtered those into `skipped`).
 *
 * A path:
 *   { id, title, kind, steps: [ { action, selector, value?, label } ] }
 * Step actions: 'navigate' (click a link), 'click', 'fill', 'choose', 'submit'.
 */

/** A plausible synthetic value for a text-like input, from its type/name. */
export function syntheticValue(d) {
  const type = (d.type || '').toLowerCase();
  const hint = `${d.name || ''} ${d.label || ''} ${d.id || ''}`.toLowerCase();
  if (type === 'email' || /e-?mail/.test(hint)) return 'test@example.com';
  if (type === 'password' || /pass/.test(hint)) return 'Password123!';
  if (type === 'number' || /\b(age|qty|quantity|count|amount)\b/.test(hint)) return '1';
  if (type === 'tel' || /phone|mobile|tel/.test(hint)) return '5551234567';
  if (type === 'url' || /url|website|link/.test(hint)) return 'https://example.com';
  if (type === 'date') return '2024-01-01';
  if (type === 'search' || /search|query/.test(hint)) return 'test';
  if (/name/.test(hint)) return 'Test User';
  return 'test';
}

function navPaths(safe, limit) {
  return safe
    .filter(e => e.kind === 'nav-link')
    .slice(0, limit)
    .map((e, i) => ({
      id: `nav-${i + 1}`,
      title: `Navigate to "${e.name}"`,
      kind: 'navigation',
      steps: [{ action: 'navigate', selector: e.selector, label: e.name }],
    }));
}

function clickPaths(safe, limit) {
  return safe
    .filter(e => e.kind === 'button' && e.formIndex === -1)
    .slice(0, limit)
    .map((e, i) => ({
      id: `click-${i + 1}`,
      title: `Click "${e.name}"`,
      kind: 'interaction',
      steps: [{ action: 'click', selector: e.selector, label: e.name }],
    }));
}

function formPaths(safe, limit) {
  // Group safe, fillable controls by the form they belong to.
  const byForm = new Map();
  for (const e of safe) {
    if (e.formIndex === -1) continue;
    if (!byForm.has(e.formIndex)) byForm.set(e.formIndex, []);
    byForm.get(e.formIndex).push(e);
  }
  const paths = [];
  let i = 0;
  for (const [, members] of byForm) {
    if (paths.length >= limit) break;
    const steps = [];
    for (const e of members) {
      if (e.kind === 'text-input') {
        steps.push({ action: 'fill', selector: e.selector, value: syntheticValue(e), label: e.name });
      } else if (e.kind === 'toggle') {
        steps.push({ action: 'choose', selector: e.selector, label: e.name });
      } else if (e.kind === 'select') {
        steps.push({ action: 'choose', selector: e.selector, value: '', label: e.name });
      }
    }
    if (!steps.length) continue;
    // Submit only if this form's submit survived the safe filter.
    const submit = members.find(e => e.kind === 'submit');
    if (submit) {
      steps.push({ action: 'submit', selector: submit.selector, label: submit.name });
    }
    const title = submit
      ? `Fill & submit the "${steps[0].label || 'form'}" form`
      : `Fill the "${steps[0].label || 'form'}" form`;
    paths.push({ id: `form-${++i}`, title, kind: 'form', steps });
  }
  return paths;
}

/**
 * Synthesize golden paths from a discovery result (`{ safe, ... }`).
 *
 * @param {{ safe: object[] }} discovery
 * @param {{ limit?: number }} [opts]  max total paths (default 12)
 */
export function synthesizePaths(discovery, { limit = 12 } = {}) {
  const safe = discovery.safe || [];
  // Forms are the highest-value journeys, then navigation, then lone buttons.
  const forms = formPaths(safe, Math.min(limit, 5));
  const remaining1 = limit - forms.length;
  const navs = navPaths(safe, Math.min(remaining1, 6));
  const remaining2 = remaining1 - navs.length;
  const clicks = clickPaths(safe, Math.max(0, remaining2));
  return [...forms, ...navs, ...clicks].slice(0, limit);
}
