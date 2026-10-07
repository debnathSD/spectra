import { memo } from 'react';

// Memoised, but its parent passes a fresh function and object every render.
export const Panel = memo(function Panel({ onSelect, config }) {
  return <div>Panel ({config.label})</div>;
});
