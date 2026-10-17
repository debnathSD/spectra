import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { BEAT, C, PICKUP } from '../theme.js';

// light particles at different depths: the far ones small, dim and soft
const PARTICLES = Array.from({ length: 46 }, (_, i) => ({
  x: random(`x${i}`) * 1920,
  y: random(`y${i}`) * 1080,
  z: 0.25 + random(`z${i}`) * 0.75,
  hue: random(`h${i}`) > 0.7 ? '191,140,255' : '90,200,255',
  speed: 0.25 + random(`s${i}`) * 0.6,
}));
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/** How hard the kick just hit: 1 on the beat, decaying before the next. */
export const usePulse = () => {
  const f = useCurrentFrame();
  if (f < PICKUP * BEAT) return 0;
  return Math.exp(-((f % BEAT) / BEAT) * 5);
};

// Deep navy, colour glows that breathe with the kick, a perspective grid floor
// rolling towards the viewer, drifting particles, a vignette and fine grain.
export const Background = ({ floor = true }) => {
  const f = useCurrentFrame();
  const t = f / 60;
  const pulse = usePulse();
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(1500px 950px at 8% -14%, #182657 0%, transparent 60%), radial-gradient(1200px 850px at 112% 118%, #34175e 0%, transparent 62%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 1300,
          height: 1300,
          left: 310 + Math.sin(t / 3.2) * 130,
          top: -260 + Math.cos(t / 4) * 80,
          borderRadius: '50%',
          opacity: 0.85 + pulse * 0.25,
          background: 'radial-gradient(circle, rgba(54,170,255,0.2), rgba(124,124,255,0.08) 45%, transparent 70%)',
        }}
      />
      {floor && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 236, perspective: 380, perspectiveOrigin: '50% 0%', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              left: -1400,
              right: -1400,
              top: 0,
              height: 1500,
              transformOrigin: '50% 0%',
              transform: 'rotateX(74deg)',
              backgroundImage:
                'linear-gradient(rgba(70,190,255,0.22) 2px, transparent 2px), linear-gradient(90deg, rgba(70,190,255,0.22) 2px, transparent 2px)',
              backgroundSize: '110px 110px',
              backgroundPosition: `0 ${(t * 120) % 110}px`,
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 70%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 70%, transparent 100%)',
              opacity: 0.55 + pulse * 0.2,
            }}
          />
          {/* the horizon */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, background: 'linear-gradient(90deg, transparent, rgba(90,200,255,0.55), rgba(190,140,255,0.55), transparent)', boxShadow: '0 0 40px 6px rgba(80,170,255,0.25)' }} />
        </div>
      )}
      {PARTICLES.map((p, i) => {
        const y = (((p.y - t * 40 * p.speed * p.z) % 1180) + 1180) % 1180 - 50;
        const size = 2 + p.z * 5;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: p.x + Math.sin(t * 0.6 + i) * 18 * p.z,
              top: y,
              width: size,
              height: size,
              borderRadius: '50%',
              background: `rgba(${p.hue},${0.25 + p.z * 0.45})`,
              boxShadow: `0 0 ${8 + p.z * 14}px rgba(${p.hue},0.6)`,
              filter: p.z < 0.45 ? 'blur(1.5px)' : undefined,
            }}
          />
        );
      })}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 75% 70% at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)' }} />
    </AbsoluteFill>
  );
};

/** Fine film grain over everything, for a less digital finish. */
export const Grain = () => <AbsoluteFill style={{ backgroundImage: GRAIN, opacity: 0.045, mixBlendMode: 'overlay', pointerEvents: 'none' }} />;
