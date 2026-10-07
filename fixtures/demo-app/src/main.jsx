import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Chart } from './Chart.jsx';
import { batchedLayout, burn, thrashLayout } from './heavy.js';
import { Panel } from './Panel.jsx';
import { Row } from './Row.jsx';
import { Wasted } from './Wasted.jsx';

// `?fixed=1` simulates a commit that optimises the page (and adds one slow component),
// so the profiler's Compare tab has something to compare against the default page.
const fixed = new URLSearchParams(window.location.search).has('fixed');
const MemoRow = memo(Row);
const MemoWasted = memo(Wasted);

function App() {
  const [tick, setTick] = useState(0);
  const [banner, setBanner] = useState(false);
  const list = useRef(null);
  const onPick = useCallback(() => {}, []);
  const onSelect = useCallback(() => {}, []);
  const config = useMemo(() => ({ label: 'settings' }), []);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 50);
    return () => clearInterval(id);
  }, []);

  const RowComponent = fixed ? MemoRow : Row;
  const WastedComponent = fixed ? MemoWasted : Wasted;
  return (
    <div>
      <h1>Perf demo (tick {tick})</h1>
      <button id="burn" onClick={() => burn(fixed ? 80 : 260)}>
        Long task
      </button>
      <button
        id="thrash"
        onClick={() => (fixed ? batchedLayout : thrashLayout)(list.current)}
      >
        Layout thrash
      </button>
      <button id="shift" onClick={() => setTimeout(() => setBanner(true), 100)}>
        Layout shift
      </button>
      {banner && <div className="banner">Late banner pushes content down</div>}
      {fixed ? (
        <Panel onSelect={onSelect} config={config} />
      ) : (
        <Panel onSelect={() => {}} config={{ label: 'settings' }} />
      )}
      <WastedComponent />
      {fixed && <Chart tick={tick} />}
      <div ref={list}>
        {Array.from({ length: 120 }, (_, i) => (
          <RowComponent key={i} index={i} onPick={fixed ? onPick : () => {}} />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
