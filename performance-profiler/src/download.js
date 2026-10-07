/** Saves a Blob through the browser's download mechanism. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download starts asynchronously; releasing the URL immediately can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const downloadJson = (value, filename) =>
  downloadBlob(
    new Blob([JSON.stringify(value)], { type: 'application/json' }),
    filename,
  );
