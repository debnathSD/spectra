import { burn } from './heavy.js';

export function Row({ index, onPick }) {
  burn(0.15);
  return (
    <div className="row" onClick={() => onPick(index)}>
      Row {index}
    </div>
  );
}
