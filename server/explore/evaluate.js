/**
 * Evaluation orchestrator: the engine behind `spectra performance`.
 *
 * Connects once, records a baseline page-load, discovers the actionable
 * surface, synthesizes golden paths, and runs each path as its own live
 * recording. Every path therefore produces a standard report (persisted by the
 * recorder to REPORTS_DIR) that the dashboard renders with all existing
 * features — culprits, PDF export, commit compare. The aggregate returned here
 * is the performance matrix across those reports.
 */
import { PerfSession, readReport } from '../recorder.js';
import { TARGET_NAME } from '../config.js';
import { discoverActionables } from './discover.js';
import { synthesizePaths } from './paths.js';
import { runPath } from './runner.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function summarizeReport(report) {
  const v = report.vitals || {};
  const top = (report.findings || [])[0];
  return {
    tbtMs: v.tbtMs ?? null,
    longTaskCount: v.longTaskCount ?? null,
    lcpMs: v.lcpMs ?? null,
    fcpMs: v.fcpMs ?? null,
    cls: v.cls ?? null,
    forcedLayoutCount: report.totals?.forcedLayoutCount ?? null,
    findingCount: (report.findings || []).length,
    topFinding: top
      ? { severity: top.severity, category: top.category, title: top.title }
      : null,
  };
}

/** Record the baseline page load (load mode self-stops after settle). */
function recordBaseline(session) {
  return new Promise((resolve, reject) => {
    const onReport = r => {
      cleanup();
      resolve(r.id);
    };
    const onState = s => {
      if (s.error) {
        cleanup();
        reject(new Error(s.error));
      }
    };
    const cleanup = () => {
      session.off('report', onReport);
      session.off('state', onState);
    };
    session.on('report', onReport);
    session.on('state', onState);
    session.start({ mode: 'load' }).catch(err => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * @param {object} opts
 * @param {string} opts.url            start URL (already reachable)
 * @param {boolean} [opts.headless]    default true
 * @param {number} [opts.limit]        max golden paths (default 12)
 * @param {string[]} [opts.allow]      selectors of destructive actions to permit
 * @param {string} [opts.signIn]       sign-in URL template
 * @param {(ev:object)=>void} [opts.onProgress]
 */
export async function runEvaluation({
  url,
  headless = true,
  limit = 12,
  allow = [],
  signIn,
  onProgress,
} = {}) {
  const log = onProgress || (() => {});
  const session = new PerfSession();
  const results = [];
  try {
    await session.connect({ mode: 'launch', url, headless, signIn });
    // Auto-dismiss alert/confirm/beforeunload dialogs so a journey can't hang.
    if (session.page) {
      session.page.on('dialog', d => d.dismiss().catch(() => {}));
    }
    await sleep(1200);
    await session.reload(); // make sure the probe is installed before load
    await sleep(800);

    // 1) Baseline page-load profile.
    log({ phase: 'baseline' });
    const loadId = await recordBaseline(session);
    const baseline = {
      id: loadId,
      title: 'Initial page load',
      kind: 'load',
      ok: true,
      steps: [],
      summary: summarizeReport(readReport(loadId)),
    };

    // 2) Discover the actionable surface on the loaded page.
    log({ phase: 'discover' });
    const inventory = await discoverActionables(session.page, { allow });

    // 3) Synthesize golden paths.
    const paths = synthesizePaths(inventory, { limit });
    log({
      phase: 'synthesized',
      discovered: inventory.ranked.length,
      skipped: inventory.skipped.length,
      paths: paths.length,
    });

    // 4) Run each golden path as its own live recording.
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      log({ phase: 'path', index: i + 1, total: paths.length, title: p.title });
      let runRes = null;
      let report = null;
      let error = null;
      try {
        await session.navigate(url, signIn);
        await sleep(500);
        await session.start({ mode: 'live' });
        runRes = await runPath(session.page, p);
        report = await session.stop();
      } catch (err) {
        error = err.message;
        if (session.state === 'recording') {
          try {
            report = await session.stop();
          } catch {
            /* ignore */
          }
        }
      }
      results.push({
        id: report ? report.id : null,
        title: p.title,
        kind: p.kind,
        ok: !!(runRes && runRes.ok) && !error,
        steps: runRes ? runRes.steps : [],
        error,
        summary: report ? summarizeReport(report) : null,
      });
    }

    return {
      url,
      target: TARGET_NAME,
      baseline,
      discovered: inventory.ranked.length,
      skippedDestructive: inventory.skipped.map(s => ({
        name: s.name,
        selector: s.selector,
      })),
      paths: results,
    };
  } finally {
    await session.disconnect();
  }
}
