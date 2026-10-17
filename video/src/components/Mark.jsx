import { evolvePath } from '@remotion/paths';
import React from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { BRAND } from '../theme.js';

const PULSE = 'M 14 52 L 33 52 L 44 26 L 58 76 L 68 52 L 86 52';
const LAYERS = 18;

// The Spectra mark as a glossy 3D tile: it spins in from the side, settles at
// a slight angle and keeps floating; the pulse line draws itself and a light
// sheen sweeps across the face.
export const Mark = ({ size = 128, at = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - at;
  const spin = spring({ frame: f, fps, config: { damping: 14, stiffness: 120, mass: 0.8 } });
  const t = frame / 60;
  const ry = (1 - spin) * -150 - 26 + Math.sin(t * 1.3) * 10;
  const rx = 14 + Math.cos(t * 1.1) * 4;
  const draw = interpolate(f - 14, [0, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const { strokeDasharray, strokeDashoffset } = evolvePath(draw, PULSE);
  const sheen = interpolate((f - 30) % 180, [0, 40], [-120, 220], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const depth = size * 0.26;
  const radius = size * 0.26;
  return (
    <div style={{ width: size, height: size, position: 'relative', opacity: Math.min(1, spin * 2) }}>
      {/* soft shadow on the floor */}
      <div style={{ position: 'absolute', left: '10%', right: '10%', bottom: -size * 0.32, height: size * 0.16, borderRadius: '50%', background: 'rgba(40,120,255,0.45)', filter: `blur(${size * 0.12}px)` }} />
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `perspective(${size * 7}px) rotateY(${ry}deg) rotateX(${rx}deg) scale(${0.4 + 0.6 * spin})` }}>
        {Array.from({ length: LAYERS }, (_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: radius,
              background: `linear-gradient(135deg, hsl(${212 - i * 1.2}, 85%, ${34 - i * 0.8}%), hsl(${268 - i}, 70%, ${30 - i * 0.7}%))`,
              transform: `translateZ(${-depth + (i / LAYERS) * depth}px)`,
            }}
          />
        ))}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: radius,
            background: BRAND,
            boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -3px 8px rgba(0,0,0,0.25)',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            transform: 'translateZ(0.5px)',
          }}
        >
          <svg viewBox="0 0 100 100" width={size * 0.7} height={size * 0.7} style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.25))' }}>
            <path d={PULSE} fill="none" stroke="#fff" strokeWidth={8.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} />
          </svg>
          <div style={{ position: 'absolute', top: '-30%', bottom: '-30%', width: '34%', left: `${sheen}%`, transform: 'rotate(20deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.42), transparent)' }} />
        </div>
      </div>
    </div>
  );
};
