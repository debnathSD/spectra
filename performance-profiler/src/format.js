export function fmtMs(ms) {
  if (ms == null) return '–';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 1) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}

export function fmtBytes(n) {
  if (n == null) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtNumber(n) {
  return n == null ? '–' : Number(n).toLocaleString();
}

export function splitPath(path) {
  const slash = path.lastIndexOf('/');
  return {
    dir: slash < 0 ? '' : path.slice(0, slash + 1),
    name: path.slice(slash + 1),
  };
}
