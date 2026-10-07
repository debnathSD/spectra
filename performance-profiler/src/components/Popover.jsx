import { useEffect, useId, useRef, useState } from 'react';
import { ChevronIcon } from './Icons.jsx';

/** A button that opens a small floating panel; closes on outside click or Escape. */
export default function Popover({ label, icon, align = 'right', children }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = e => {
      if (!rootRef.current?.contains(e.target)) setIsOpen(false);
    };
    const onKeyDown = e => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <span className="popover" ref={rootRef}>
      <button
        type="button"
        className="ghost"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => setIsOpen(open => !open)}
      >
        {icon}
        <span>{label}</span>
        <ChevronIcon />
      </button>
      {isOpen && (
        <div
          id={panelId}
          className={`popover-panel align-${align}`}
          role="dialog"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </span>
  );
}
