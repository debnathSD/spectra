import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticValue, synthesizePaths } from './paths.js';

test('syntheticValue derives plausible values from type and name hints', () => {
  assert.equal(syntheticValue({ type: 'email' }), 'test@example.com');
  assert.equal(syntheticValue({ type: 'text', name: 'userEmail' }), 'test@example.com');
  assert.equal(syntheticValue({ type: 'password' }), 'Password123!');
  assert.equal(syntheticValue({ type: 'search' }), 'test');
  assert.equal(syntheticValue({ type: 'date' }), '2024-01-01');
  assert.equal(syntheticValue({ type: 'tel' }), '5551234567');
  assert.equal(syntheticValue({ type: 'text', name: 'fullName' }), 'Test User');
  assert.equal(syntheticValue({ type: 'text' }), 'test');
});

const el = (over) => ({
  kind: 'button',
  selector: 'button',
  name: 'x',
  formIndex: -1,
  type: '',
  ...over,
});

test('synthesizePaths builds a fill+submit journey for a form', () => {
  const safe = [
    el({ kind: 'text-input', type: 'email', selector: '#email', name: 'email', formIndex: 0 }),
    el({ kind: 'text-input', type: 'password', selector: '#pw', name: 'password', formIndex: 0 }),
    el({ kind: 'toggle', selector: '#remember', name: 'remember', formIndex: 0 }),
    el({ kind: 'submit', selector: '#login', name: 'Log in', formIndex: 0 }),
  ];
  const [form] = synthesizePaths({ safe });
  assert.equal(form.kind, 'form');
  const actions = form.steps.map(s => s.action);
  assert.deepEqual(actions, ['fill', 'fill', 'choose', 'submit']);
  assert.equal(form.steps[0].value, 'test@example.com');
  assert.equal(form.steps[1].value, 'Password123!');
  assert.match(form.title, /submit/i);
});

test('a form with no safe submit is filled but not submitted', () => {
  const safe = [
    el({ kind: 'text-input', type: 'search', selector: '#q', name: 'q', formIndex: 0 }),
  ];
  const [form] = synthesizePaths({ safe });
  assert.deepEqual(form.steps.map(s => s.action), ['fill']);
  assert.match(form.title, /^Fill the/);
});

test('synthesizePaths makes navigation and click journeys and honors the limit', () => {
  const safe = [
    el({ kind: 'nav-link', selector: 'a#a', name: 'Home' }),
    el({ kind: 'nav-link', selector: 'a#b', name: 'Pricing' }),
    el({ kind: 'button', selector: 'button#c', name: 'Open menu' }),
  ];
  const paths = synthesizePaths({ safe }, { limit: 2 });
  assert.equal(paths.length, 2);
  const all = synthesizePaths({ safe });
  assert.deepEqual(
    all.map(p => p.kind),
    ['navigation', 'navigation', 'interaction'],
  );
  assert.equal(all[0].steps[0].action, 'navigate');
  assert.equal(all[2].steps[0].action, 'click');
});

test('forms are prioritized over navigation and lone buttons', () => {
  const safe = [
    el({ kind: 'nav-link', selector: 'a#a', name: 'Home' }),
    el({ kind: 'text-input', type: 'email', selector: '#e', name: 'email', formIndex: 0 }),
    el({ kind: 'submit', selector: '#s', name: 'Subscribe-less', formIndex: 0 }),
  ];
  const paths = synthesizePaths({ safe });
  assert.equal(paths[0].kind, 'form');
});
