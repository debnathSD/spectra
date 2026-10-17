import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

// Snappy by default: quick to land, with a hint of overshoot.
export const SNAP = { damping: 18, stiffness: 220, mass: 0.55 };
export const FIRM = { damping: 30, stiffness: 200, mass: 0.7 }; // quick, no overshoot

export const useSpring = (at = 0, config = SNAP) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config });
};

const entrances = {
  up: (a, d) => `translateY(${(1 - a) * d}px)`,
  down: (a, d) => `translateY(${(a - 1) * d}px)`,
  left: (a, d) => `translateX(${(a - 1) * d}px)`,
  right: (a, d) => `translateX(${(1 - a) * d}px)`,
  scale: a => `scale(${0.86 + 0.14 * a})`,
  pop: a => `scale(${a})`,
  // 3D: flip up from below, swing in from the side, rise out of the depth, slam down from the camera
  flip: a => `perspective(1100px) translateY(${(1 - a) * 30}px) rotateX(${(1 - a) * 82}deg)`,
  swing: a => `perspective(1400px) rotateY(${(1 - a) * -64}deg) translateX(${(1 - a) * -60}px)`,
  depth: a => `perspective(1400px) translateZ(${(1 - a) * -700}px) rotateX(${(1 - a) * 18}deg)`,
  slam: a => `scale(${1 + (1 - a) * 0.5})`,
  none: () => '',
};
const exits = {
  fade: b => `translateY(${-b * 14}px)`,
  through: b => `scale(${1 + b * 0.35})`, // flies past the camera
  back: b => `perspective(1400px) translateZ(${-b * 500}px)`,
  flip: b => `perspective(1100px) rotateX(${-b * 80}deg)`,
};

/**
 * Shows its children from frame `at` until frame `until`: a quick 3D or 2D
 * entrance with a short blur that resolves as it lands, and a quick exit.
 */
export const Reveal = ({ at = 0, until, kind = 'up', exit = 'fade', dist = 40, blur = 8, origin, style, children, config }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - at, fps, config: config || (kind === 'pop' || kind === 'slam' ? { damping: 13, stiffness: 230, mass: 0.6 } : SNAP) });
  const b = until == null ? 0 : spring({ frame: frame - until, fps, config: FIRM, durationInFrames: 12 });
  const opacity = Math.max(0, Math.min(1, a * 1.25) - b);
  if (opacity <= 0.001 && frame > at) return null;
  return (
    <div
      style={{
        opacity,
        transform: `${entrances[kind](Math.min(a, 1.2), dist)} ${b ? exits[exit](b) : ''}`,
        transformOrigin: origin || (kind === 'flip' ? '50% 100%' : '50% 50%'),
        filter: blur ? `blur(${Math.max(0, 1 - a) * blur + b * blur}px)` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
