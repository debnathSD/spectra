import { burn } from './heavy.js';

// Only rendered in the "fixed" variant: an optimisation PR that also adds a slow new component.
export function Chart({ tick }) {
  burn(3);
  return <div>Chart (tick {tick})</div>;
}
