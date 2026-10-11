/**
 * Discovery: given a live puppeteer Page, enumerate the actionable elements on
 * the current view and return a ranked, classified inventory.
 *
 * The live-DOM extraction (browser-side) is deliberately separated from the
 * classification/ranking (pure Node, see classify.js) so the latter can be
 * unit-tested without a browser.
 */
import { rankElements, partitionSafe } from './classify.js';

/**
 * Runs in the page context. Returns an array of raw element descriptors. Must
 * be self-contained — it is serialized and evaluated inside Chrome.
 */
function extractActionables() {
  const SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="radio"]',
    '[onclick]',
  ].join(',');

  function nthOfType(n) {
    // 1-based index among same-tag element siblings, for :nth-of-type().
    let i = 1;
    for (let p = n.previousElementSibling; p; p = p.previousElementSibling) {
      if (p.tagName === n.tagName) i++;
    }
    return i;
  }

  function selectorOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 5; n = n.parentElement, i++) {
      let s = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(s + '#' + CSS.escape(n.id));
        break; // an id is unique on its own — stop climbing
      }
      const testId =
        n.getAttribute && (n.getAttribute('data-test') || n.getAttribute('data-testid'));
      if (testId) {
        s += '[data-test' + (n.getAttribute('data-testid') ? 'id' : '') + '="' + testId + '"]';
      } else {
        if (n.classList && n.classList.length) {
          s += '.' + Array.prototype.slice.call(n.classList, 0, 2).map(c => CSS.escape(c)).join('.');
        }
        // Disambiguate from same-tag siblings so sibling links/buttons don't
        // collapse to one selector (and so the selector actually resolves to a
        // single element for the runner).
        if (n.parentElement) s += ':nth-of-type(' + nthOfType(n) + ')';
      }
      parts.unshift(s);
    }
    return parts.join(' > ');
  }

  function accessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby
        .split(/\s+/)
        .map(id => {
          const n = document.getElementById(id);
          return n ? n.textContent : '';
        })
        .join(' ')
        .trim();
      if (text) return text;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (el.id) {
        const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lab && lab.textContent.trim()) return lab.textContent.trim();
      }
      const wrap = el.closest('label');
      if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
      if (el.placeholder) return el.placeholder;
      if (el.getAttribute('name')) return el.getAttribute('name');
      if (el.value && el.type === 'submit') return el.value;
    }
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    return el.getAttribute('title') || el.getAttribute('alt') || '';
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const nodes = Array.from(document.querySelectorAll(SELECTOR));
  const out = [];
  for (const el of nodes) {
    const tag = el.tagName.toLowerCase();
    const form = el.closest ? el.closest('form') : null;
    const r = el.getBoundingClientRect();
    out.push({
      tag,
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      label: accessibleName(el),
      href: tag === 'a' ? el.getAttribute('href') || '' : '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      selector: selectorOf(el),
      inForm: !!form,
      formMethod: form ? (form.getAttribute('method') || 'get') : '',
      formAction: form ? form.getAttribute('action') || '' : '',
      disabled: !!el.disabled,
      visible: isVisible(el),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    });
  }
  return out;
}

/**
 * Discover actionable elements on the page's current view.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {{ limit?: number, allow?: string[] }} [opts]
 *   limit — max ranked elements to keep; allow — selectors of destructive
 *   actions the caller has explicitly permitted the runner to trigger.
 */
export async function discoverActionables(page, opts = {}) {
  const raw = await page.evaluate(extractActionables);
  const ranked = rankElements(raw, { limit: opts.limit ?? 50 });
  const { safe, skipped } = partitionSafe(ranked, { allow: opts.allow ?? [] });
  const meta = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
  }));
  return {
    url: meta.url,
    title: meta.title,
    total: raw.length,
    ranked,
    safe,
    skipped,
  };
}

export { extractActionables };
