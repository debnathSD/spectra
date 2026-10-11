/**
 * Journey runner: drive one synthesized golden path against a live puppeteer
 * Page. Each step is attempted in order; the first failure stops the journey
 * (you cannot meaningfully continue a flow past a broken step) and the rest are
 * marked skipped. Returns a per-step result and an overall pass/fail.
 */

const STEP_TIMEOUT = 8000;
const SETTLE_MS = 600;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(page, selector) {
  return page.waitForSelector(selector, { timeout: STEP_TIMEOUT, visible: true });
}

async function runStep(page, step) {
  const el = await waitFor(page, step.selector);
  switch (step.action) {
    case 'navigate': {
      // A link click that may trigger a navigation; tolerate SPA (no nav).
      await Promise.race([
        page.waitForNavigation({ timeout: STEP_TIMEOUT, waitUntil: 'domcontentloaded' }).catch(() => {}),
        el.click(),
      ]);
      await sleep(SETTLE_MS);
      break;
    }
    case 'click': {
      await el.click();
      await sleep(SETTLE_MS);
      break;
    }
    case 'fill': {
      await el.click({ clickCount: 3 }).catch(() => {}); // select existing text
      await el.type(String(step.value ?? ''), { delay: 10 });
      break;
    }
    case 'choose': {
      const tag = await page.evaluate(e => e.tagName.toLowerCase(), el);
      if (tag === 'select') {
        // Pick the first non-empty option.
        const value = await page.evaluate(e => {
          const opt = Array.from(e.options).find(o => o.value) || e.options[0];
          return opt ? opt.value : '';
        }, el);
        if (value) await page.select(step.selector, value);
      } else {
        await el.click(); // checkbox / radio / switch
      }
      await sleep(SETTLE_MS);
      break;
    }
    case 'submit': {
      await Promise.race([
        page.waitForNavigation({ timeout: STEP_TIMEOUT, waitUntil: 'domcontentloaded' }).catch(() => {}),
        el.click(),
      ]);
      await sleep(SETTLE_MS);
      break;
    }
    default:
      throw new Error(`unknown step action "${step.action}"`);
  }
}

/**
 * Run a path's steps on `page`. Does not start/stop recording — the caller
 * wraps this in a PerfSession window.
 *
 * @returns {Promise<{ ok: boolean, steps: Array<{ action, label, selector, ok, error?, skipped? }> }>}
 */
export async function runPath(page, path) {
  const results = [];
  let failed = false;
  for (const step of path.steps) {
    if (failed) {
      results.push({ ...stepMeta(step), ok: false, skipped: true });
      continue;
    }
    try {
      await runStep(page, step);
      results.push({ ...stepMeta(step), ok: true });
    } catch (err) {
      failed = true;
      results.push({ ...stepMeta(step), ok: false, error: err.message });
    }
  }
  return { ok: !failed, steps: results };
}

function stepMeta(step) {
  return { action: step.action, label: step.label || '', selector: step.selector };
}
