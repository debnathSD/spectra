const Svg = ({ children, size = 14 }) => (
  <svg
    className="icon"
    viewBox="0 0 16 16"
    width={size}
    height={size}
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export const ChevronIcon = ({ isUp = false }) => (
  <Svg size={12}>
    <path d={isUp ? 'M3.5 10 8 5.5l4.5 4.5' : 'M3.5 6 8 10.5 12.5 6'} />
  </Svg>
);

export const RecordIcon = () => (
  <svg
    className="icon"
    viewBox="0 0 16 16"
    width="12"
    height="12"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="5.5" fill="currentColor" />
  </svg>
);

export const StopIcon = () => (
  <svg
    className="icon"
    viewBox="0 0 16 16"
    width="12"
    height="12"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
  </svg>
);

export const PageLoadIcon = () => (
  <Svg>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
  </Svg>
);

export const DownloadIcon = () => (
  <Svg>
    <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" />
  </Svg>
);
