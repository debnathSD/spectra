import { splitPath } from '../format.js';

/** `file:line` as a link that opens the file in the tool, plus an “open in editor” link. */
export default function CodeRef({ file, line, lineKind, abs, onOpenFile }) {
  if (!file) return <span className="muted">unknown file</span>;
  const { dir, name } = splitPath(file);
  const label = `${line ? `${lineKind === 'located' ? '≈' : ''}${line}` : ''}`;
  return (
    <span className="code-ref">
      {onOpenFile ? (
        <button
          type="button"
          className="link mono"
          onClick={() => onOpenFile(file)}
          title={file}
        >
          <span className="muted">{dir}</span>
          <b>{name}</b>
          {label && <span>:{label}</span>}
        </button>
      ) : (
        <span className="mono" title={file}>
          <span className="muted">{dir}</span>
          <b>{name}</b>
          {label && <span>:{label}</span>}
        </span>
      )}
      {abs && (
        <a
          className="editor-link"
          href={`vscode://file/${abs}${line ? `:${line}` : ''}`}
          title="Open in VS Code"
        >
          ↗ editor
        </a>
      )}
      {lineKind === 'located' && (
        <span
          className="muted"
          title="Webpack dev bundles have no source map, so the line was found by searching the file for this function's definition."
        >
          {' '}
          (line found by name)
        </span>
      )}
    </span>
  );
}
