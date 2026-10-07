import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * Connection / recording state of the Chrome session, kept fresh by
 * Server-Sent Events plus a slow poll (for the tab list and probe status).
 */
export function useSession({ onReport }) {
  const [status, setStatus] = useState(null);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState('');
  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch (err) {
      setError(err.message);
    }
  }, []);
  const refreshReports = useCallback(
    async () => setReports(await api.reports().catch(() => [])),
    [],
  );

  useEffect(() => {
    refresh();
    refreshReports();
    const source = new EventSource('/api/events');
    source.addEventListener('state', e => {
      const data = JSON.parse(e.data);
      if (data.error) setError(data.error);
      refresh();
    });
    source.addEventListener('report', e => {
      refreshReports();
      onReportRef.current(JSON.parse(e.data).id);
    });
    // Tabs and probe status change without any server event.
    const poll = setInterval(refresh, 4000);
    return () => {
      source.close();
      clearInterval(poll);
    };
  }, [refresh, refreshReports]);

  const run = useCallback(
    async action => {
      setError('');
      try {
        const result = await action();
        await refresh();
        return result;
      } catch (err) {
        setError(err.message);
        await refresh();
        return null;
      }
    },
    [refresh],
  );

  return {
    status,
    reports,
    error,
    clearError: () => setError(''),
    run,
    refresh,
    refreshReports,
  };
}
