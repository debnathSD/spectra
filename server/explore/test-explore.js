import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyElement,
  isInternalHref,
  isDestructive,
  labelOf,
  scoreElement,
  rankElements,
  partitionSafe,
} from './classify.js';

const desc = (over = {}) => ({
  tag: 'button',
  type: '',
  role: '',
  label: 'Click me',
  href: '',
  name: '',
  id: '',
  selector: 'button.cta',
  inForm: false,
  formMethod: '',
  formAction: '',
  disabled: false,
  visible: true,
  rect: [0, 0, 100, 40],
  ...over,
});

test('classifyElement maps tags, input types and ARIA roles to a kind/action', () => {
  assert.deepEqual(classifyElement(desc({ tag: 'a', href: '/pricing' })), {
    kind: 'nav-link',
    actionType: 'navigate',
  });
  assert.deepEqual(classifyElement(desc({ tag: 'a', href: 'https://x.com' })), {
    kind: 'link',
    actionType: 'navigate',
  });
  assert.deepEqual(classifyElement(desc({ tag: 'input', type: 'email' })), {
    kind: 'text-input',
    actionType: 'fill',
  });
  assert.deepEqual(classifyElement(desc({ tag: 'input', type: 'submit' })), {
    kind: 'submit',
    actionType: 'submit',
  });
  assert.deepEqual(classifyElement(desc({ tag: 'input', type: 'checkbox' })), {
    kind: 'toggle',
    actionType: 'choose',
  });
  assert.deepEqual(classifyElement(desc({ tag: 'div', role: 'button' })), {
    kind: 'button',
    actionType: 'click',
  });
  assert.deepEqual(classifyElement(desc({ tag: 'select' })), {
    kind: 'select',
    actionType: 'choose',
  });
  // hidden inputs and unknown elements carry no action
  assert.equal(classifyElement(desc({ tag: 'input', type: 'hidden' })).actionType, null);
  assert.equal(classifyElement(desc({ tag: 'span', role: '' })).actionType, null);
});

test('isInternalHref distinguishes in-app navigation from external/non-nav', () => {
  assert.equal(isInternalHref('/dashboard'), true);
  assert.equal(isInternalHref('./settings'), true);
  assert.equal(isInternalHref('products'), true);
  assert.equal(isInternalHref('#section'), false);
  assert.equal(isInternalHref('https://example.com'), false);
  assert.equal(isInternalHref('mailto:a@b.com'), false);
  assert.equal(isInternalHref('javascript:void(0)'), false);
});

test('isDestructive flags mutating labels, logout hrefs and POST submits', () => {
  assert.equal(isDestructive(desc({ label: 'Delete account' })), true);
  assert.equal(isDestructive(desc({ label: 'Pay now' })), true);
  assert.equal(isDestructive(desc({ label: 'Log out' })), true);
  assert.equal(isDestructive(desc({ tag: 'a', href: '/logout' })), true);
  assert.equal(
    isDestructive(desc({ tag: 'input', type: 'submit', inForm: true, formMethod: 'post' })),
    true,
  );
  // a GET form submit (e.g. a search) is not destructive
  assert.equal(
    isDestructive(desc({ tag: 'input', type: 'submit', inForm: true, formMethod: 'get', label: 'Search' })),
    false,
  );
  // an ordinary navigation / click is safe
  assert.equal(isDestructive(desc({ tag: 'a', href: '/pricing', label: 'Pricing' })), false);
});

test('labelOf prefers accessible text, then name/href, then kind, and truncates', () => {
  assert.equal(labelOf(desc({ label: '  Buy   now ' })), 'Buy now');
  assert.equal(labelOf(desc({ label: '', name: 'email', tag: 'input', type: 'email' })), 'email');
  assert.equal(labelOf(desc({ label: '', name: '', tag: 'a', href: '/x' })), '/x');
  const long = 'x'.repeat(80);
  const truncated = labelOf(desc({ label: long }));
  assert.ok(truncated.length <= 60);
  assert.ok(truncated.endsWith('…'));
});

test('scoreElement rewards visible, labelled, primary entry points over noise', () => {
  const primaryNav = desc({ tag: 'a', href: '/dashboard', label: 'Dashboard', selector: 'a#nav-dash' });
  const hiddenThing = desc({ visible: false, label: '' });
  const tinyIcon = desc({ rect: [0, 0, 2, 2], label: '' });
  assert.ok(scoreElement(primaryNav) > scoreElement(hiddenThing));
  assert.ok(scoreElement(primaryNav) > scoreElement(tinyIcon));
  // unknown / non-actionable sinks to -Infinity
  assert.equal(scoreElement(desc({ tag: 'span', role: '' })), -Infinity);
});

test('rankElements classifies, de-dupes by selector and sorts by score', () => {
  const input = [
    desc({ tag: 'a', href: '/dashboard', label: 'Dashboard', selector: 'a#nav-dash' }),
    desc({ tag: 'a', href: '/dashboard', label: 'Dashboard', selector: 'a#nav-dash' }), // dup
    desc({ tag: 'span', role: '', selector: 'span.x' }), // non-actionable, dropped
    desc({ tag: 'button', label: 'OK', selector: 'button.ok' }),
  ];
  const ranked = rankElements(input, { limit: 10 });
  assert.equal(ranked.length, 2); // dup collapsed, non-actionable removed
  assert.ok(ranked.every(r => 'kind' in r && 'actionType' in r && 'destructive' in r));
  // sorted descending by score
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score);
});

test('partitionSafe holds back destructive actions unless allowlisted', () => {
  const ranked = rankElements([
    desc({ label: 'Pricing', tag: 'a', href: '/pricing', selector: 'a#price' }),
    desc({ label: 'Delete', selector: 'button#del' }),
  ]);
  const { safe, skipped } = partitionSafe(ranked);
  assert.deepEqual(safe.map(s => s.selector), ['a#price']);
  assert.deepEqual(skipped.map(s => s.selector), ['button#del']);

  const allowed = partitionSafe(ranked, { allow: ['button#del'] });
  assert.equal(allowed.skipped.length, 0);
  assert.equal(allowed.safe.length, 2);
});
