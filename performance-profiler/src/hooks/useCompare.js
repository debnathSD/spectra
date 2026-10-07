import { useCallback, useMemo, useState } from 'react';
import { compareSides } from '../../shared/compare.js';
import { hashFromFileName, validateReport } from '../../shared/snapshot.js';
import { api } from '../api.js';

const MAX_FILE_BYTES = 60 * 1024 * 1024;

const emptySide = () => ({
  runs: [],
  git: null,
  hashInput: '',
  label: '',
  lookup: { status: 'idle', message: '' },
  problems: [],
});
const initial = () => ({ before: emptySide(), after: emptySide() });

async function readSnapshot(file) {
  if (/\.trace\.json$/i.test(file.name) || file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      fileName: file.name,
      reason:
        'This looks like a raw Chrome trace (or is too large). Comparison needs the profiler report: use “Snapshot for comparison”.',
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, fileName: file.name, reason: 'Not valid JSON.' };
  }
  const check = validateReport(parsed);
  return check.ok
    ? { ok: true, fileName: file.name, report: parsed }
    : { ok: false, fileName: file.name, reason: check.reason };
}

/**
 * Which two groups of snapshots are being compared ("before" = base commit,
 * "after" = the commit under review), plus the derived comparison.
 */
export function useCompare() {
  const [sides, setSides] = useState(initial);

  const patch = useCallback(
    (name, change) =>
      setSides(prev => ({
        ...prev,
        [name]: {
          ...prev[name],
          ...(typeof change === 'function' ? change(prev[name]) : change),
        },
      })),
    [],
  );

  const lookupCommit = useCallback(
    async (name, hash) => {
      const rev = hash.trim();
      if (!rev)
        return patch(name, {
          git: null,
          lookup: { status: 'idle', message: '' },
        });
      patch(name, {
        hashInput: rev,
        lookup: { status: 'working', message: '' },
      });
      try {
        const git = await api.gitCommit(rev);
        patch(name, {
          git,
          hashInput: git.shortHash,
          lookup: { status: 'ok', message: '' },
        });
      } catch (err) {
        // Keep the typed hash so the PDF still shows it, with the author unknown.
        patch(name, {
          git: {
            hash: rev,
            shortHash: rev.slice(0, 10),
            author: '',
            subject: '',
            date: '',
          },
          lookup: { status: 'error', message: err.message },
        });
      }
    },
    [patch],
  );

  const addFiles = useCallback(
    async (name, files) => {
      const results = await Promise.all([...files].map(readSnapshot));
      const good = results.filter(r => r.ok);
      patch(name, side => {
        const known = new Set(side.runs.map(r => r.report.id));
        const fresh = good
          .filter(r => !known.has(r.report.id))
          .map(r => ({ fileName: r.fileName, report: r.report }));
        return {
          runs: [...side.runs, ...fresh],
          problems: results
            .filter(r => !r.ok)
            .map(r => `${r.fileName}: ${r.reason}`),
        };
      });
      // The file name carries the commit when the report itself does not.
      const first = good[0];
      if (first && !first.report.meta.git) {
        const hash = hashFromFileName(first.fileName);
        if (hash) await lookupCommit(name, hash);
      }
    },
    [patch, lookupCommit],
  );

  const addSaved = useCallback(
    async (name, id) => {
      try {
        const report = await api.report(id);
        patch(name, side =>
          side.runs.some(r => r.report.id === report.id)
            ? {}
            : {
                runs: [
                  ...side.runs,
                  { fileName: `reports/${id}.json`, report },
                ],
                problems: [],
              },
        );
      } catch (err) {
        patch(name, { problems: [err.message] });
      }
    },
    [patch],
  );

  const removeRun = useCallback(
    (name, id) =>
      patch(name, side => ({
        runs: side.runs.filter(r => r.report.id !== id),
      })),
    [patch],
  );
  const setLabel = useCallback(
    (name, label) => patch(name, { label }),
    [patch],
  );
  const swap = useCallback(
    () => setSides(prev => ({ before: prev.after, after: prev.before })),
    [],
  );
  const reset = useCallback(() => setSides(initial()), []);

  const comparison = useMemo(
    () =>
      compareSides(
        {
          runs: sides.before.runs.map(r => r.report),
          git: sides.before.git,
          label: sides.before.label,
        },
        {
          runs: sides.after.runs.map(r => r.report),
          git: sides.after.git,
          label: sides.after.label,
        },
      ),
    [sides],
  );

  return {
    sides,
    comparison,
    addFiles,
    addSaved,
    removeRun,
    setLabel,
    lookupCommit,
    swap,
    reset,
  };
}
