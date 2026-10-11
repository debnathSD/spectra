/**
 * Pure classification, destructive-action detection and ranking for the
 * actionable elements discovered on a page. Kept free of any browser/puppeteer
 * dependency so it can be unit-tested over plain descriptor objects.
 *
 * A "descriptor" is the raw shape produced by the in-page extractor in
 * discover.js:
 *   {
 *     tag, type, role, label, href, name, id, selector,
 *     inForm, formMethod, formAction, disabled, visible, rect: [x,y,w,h]
 *   }
 */

/** Words that mark an action as state-changing / risky to trigger blindly. */
const DESTRUCTIVE_LABEL =
  /\b(delete|remove|destroy|drop|erase|clear|reset|wipe|pay|buy|purchase|checkout|order|subscribe|donate|confirm|submit order|place order|deactivate|disable|archive|unsubscribe|sign\s?out|log\s?out|close account|cancel (?:account|subscription|plan))\b/i;

const DESTRUCTIVE_HREF = /(logout|signout|sign-out|log-out|\/delete|\/remove)/i;

/** Labels that usually denote primary navigation / high-value entry points. */
const PRIMARY_LABEL =
  /\b(home|dashboard|login|log\s?in|sign\s?in|sign\s?up|register|get started|start|search|products?|pricing|settings|profile|account|cart|checkout|menu|explore|browse)\b/i;

/**
 * Map a raw descriptor to a stable `kind` and the `actionType` the runner would
 * use to drive it.
 */
export function classifyElement(d) {
  const tag = (d.tag || '').toLowerCase();
  const type = (d.type || '').toLowerCase();
  const role = (d.role || '').toLowerCase();

  if (tag === 'a' && d.href) {
    const internalNav = isInternalHref(d.href);
    return {
      kind: internalNav ? 'nav-link' : 'link',
      actionType: 'navigate',
    };
  }
  if (tag === 'select') return { kind: 'select', actionType: 'choose' };
  if (tag === 'textarea') return { kind: 'text-input', actionType: 'fill' };

  if (tag === 'input') {
    if (type === 'submit' || type === 'image')
      return { kind: 'submit', actionType: 'submit' };
    if (type === 'button' || type === 'reset')
      return { kind: 'button', actionType: 'click' };
    if (type === 'checkbox' || type === 'radio')
      return { kind: 'toggle', actionType: 'choose' };
    if (['hidden'].includes(type)) return { kind: 'unknown', actionType: null };
    // text, email, password, search, tel, url, number, date, ...
    return { kind: 'text-input', actionType: 'fill' };
  }

  if (tag === 'button' || role === 'button') {
    if (type === 'submit') return { kind: 'submit', actionType: 'submit' };
    return { kind: 'button', actionType: 'click' };
  }

  if (role === 'link') return { kind: 'link', actionType: 'navigate' };
  if (role === 'tab' || role === 'menuitem')
    return { kind: 'button', actionType: 'click' };
  if (['checkbox', 'switch', 'radio'].includes(role))
    return { kind: 'toggle', actionType: 'choose' };

  return { kind: 'unknown', actionType: null };
}

/** True when an href points inside the same app rather than off to the web. */
export function isInternalHref(href) {
  if (!href) return false;
  const h = String(href).trim();
  if (h.startsWith('#')) return false; // in-page anchor, not a navigation
  if (/^(mailto:|tel:|sms:|javascript:|data:)/i.test(h)) return false;
  if (/^https?:\/\//i.test(h)) return false; // absolute external (best-effort)
  return true; // relative path, "/foo", "./foo", "foo"
}

/**
 * Decide whether triggering this element could change server/app state. Used by
 * the safe-by-default runner to skip anything not explicitly allowlisted.
 */
export function isDestructive(d) {
  const label = d.label || '';
  if (DESTRUCTIVE_LABEL.test(label)) return true;
  if (DESTRUCTIVE_HREF.test(d.href || '')) return true;
  // A real form submit via POST/PUT/DELETE mutates by definition.
  const { kind } = classifyElement(d);
  if (kind === 'submit') {
    const method = (d.formMethod || 'get').toLowerCase();
    if (method && method !== 'get') return true;
  }
  return false;
}

/** A short, human-friendly name for a descriptor, for reports and path names. */
export function labelOf(d) {
  const raw = (d.label || '').replace(/\s+/g, ' ').trim();
  if (raw) return raw.length > 60 ? raw.slice(0, 57) + '…' : raw;
  if (d.name) return d.name;
  if (d.href) return d.href;
  const { kind } = classifyElement(d);
  return kind === 'unknown' ? d.tag || 'element' : kind;
}

/**
 * Score an element for how worthwhile it is to include in a golden path.
 * Higher is better. Invisible, disabled, unlabeled and unknown elements sink.
 */
export function scoreElement(d) {
  const { kind, actionType } = classifyElement(d);
  if (actionType === null) return -Infinity;
  let score = 0;
  if (d.visible) score += 10;
  else score -= 20;
  if (d.disabled) score -= 15;
  if ((d.label || '').trim()) score += 4;
  if (PRIMARY_LABEL.test(d.label || '')) score += 6;

  // Prefer entry points and clicks over raw text fields in isolation.
  score += { 'nav-link': 5, button: 4, submit: 3, select: 2, 'text-input': 1, toggle: 1, link: 1, unknown: -10 }[kind] ?? 0;

  // A stable id/data-test selector is more reliable to drive.
  if (/#|\[data-test/.test(d.selector || '')) score += 3;

  // Larger, on-screen targets are usually more meaningful than tiny icons.
  const area = d.rect ? d.rect[2] * d.rect[3] : 0;
  if (area > 0 && area < 8) score -= 4;

  return score;
}

/**
 * Turn a raw descriptor list into ranked, classified, de-duplicated candidates.
 * Returns objects enriched with { kind, actionType, destructive, score, name }.
 */
export function rankElements(descriptors, { limit = 50 } = {}) {
  const seen = new Set();
  const out = [];
  for (const d of descriptors || []) {
    const cls = classifyElement(d);
    if (cls.actionType === null) continue;
    const key = d.selector || `${d.tag}:${d.label}:${d.href || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...d,
      kind: cls.kind,
      actionType: cls.actionType,
      destructive: isDestructive(d),
      name: labelOf(d),
      score: scoreElement(d),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Split ranked candidates into the ones a safe run may drive, and the rest. */
export function partitionSafe(ranked, { allow = [] } = {}) {
  const allowSet = new Set(allow);
  const safe = [];
  const skipped = [];
  for (const el of ranked) {
    if (el.destructive && !allowSet.has(el.selector)) skipped.push(el);
    else safe.push(el);
  }
  return { safe, skipped };
}
