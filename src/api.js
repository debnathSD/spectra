async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${url}: ${res.status}`);
  return data;
}

export const api = {
  status: () => request('GET', '/api/status'),
  connect: options => request('POST', '/api/connect', options),
  disconnect: () => request('POST', '/api/disconnect', {}),
  selectPage: id => request('POST', '/api/select-page', { id }),
  navigate: (url, signIn) => request('POST', '/api/navigate', { url, signIn }),
  reload: () => request('POST', '/api/reload', {}),
  start: options => request('POST', '/api/record/start', options),
  stop: () => request('POST', '/api/record/stop', {}),
  reports: () => request('GET', '/api/reports'),
  report: id => request('GET', `/api/reports/${encodeURIComponent(id)}`),
  saveTrace: id =>
    request('POST', `/api/reports/${encodeURIComponent(id)}/trace`, {}),
  gitCommit: rev =>
    request('GET', `/api/git/commit?rev=${encodeURIComponent(rev)}`),
  /** @returns {Promise<{blob: Blob, name: string}>} */
  comparePdf: async (comparison, kind) => {
    const res = await fetch('/api/compare/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comparison, kind }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `PDF export failed (${res.status})`);
    }
    const disposition = res.headers.get('content-disposition') || '';
    return {
      blob: await res.blob(),
      name: /filename="([^"]+)"/.exec(disposition)?.[1] || 'comparison.pdf',
    };
  },
  deleteReport: id =>
    request('DELETE', `/api/reports/${encodeURIComponent(id)}`),
  source: path =>
    request('GET', `/api/source?path=${encodeURIComponent(path)}`),
};
