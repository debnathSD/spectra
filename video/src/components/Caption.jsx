import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, fonts } from '../theme.js';
import { Reveal } from './motion.jsx';

const glass = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 16,
  padding: '16px 32px 16px 18px',
  borderRadius: 999,
  background: 'linear-gradient(180deg, rgba(22,28,52,0.9), rgba(9,12,26,0.9))',
  border: '1px solid rgba(140,180,255,0.35)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12), 0 0 40px rgba(54,170,255,0.12)',
  backdropFilter: 'blur(18px)',
  font: `600 31px ${fonts.ui}`,
  letterSpacing: '-0.01em',
  color: C.ink,
  whiteSpace: 'nowrap',
};

/** A caption pill at the top (or bottom) that flips in, optionally numbered. */
export const Caption = ({ at, until, step, bottom, children }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: bottom ? 'flex-end' : 'flex-start', padding: bottom ? '0 0 46px' : '34px 0 0', pointerEvents: 'none' }}>
    <Reveal at={at} until={until} kind="flip" exit="flip" origin={bottom ? '50% 100%' : '50% 0%'} blur={4}>
      <div style={{ ...glass, paddingLeft: step ? 18 : 32 }}>
        {step && (
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(135deg, #36d6ff, #0a84ff 50%, #bf5af2)',
              boxShadow: '0 0 20px rgba(54,170,255,0.6)',
              font: `700 22px ${fonts.ui}`,
            }}
          >
            {step}
          </span>
        )}
        {children}
      </div>
    </Reveal>
  </AbsoluteFill>
);

/** Inline code in a caption. */
export const Code = ({ children, color = C.cyan }) => <span style={{ font: `500 28px ${fonts.mono}`, color }}>{children}</span>;

/** Key caps that pop in one by one and press down, bottom right. */
export const Keys = ({ at, until, keys }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ alignItems: 'flex-end', justifyContent: 'flex-end', padding: '0 56px 46px 0', pointerEvents: 'none' }}>
      <Reveal at={at} until={until} kind="pop" blur={0}>
        <div style={{ display: 'flex', gap: 12, padding: 14, borderRadius: 22, background: 'rgba(9,12,26,0.85)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 24px 60px rgba(0,0,0,0.55)', backdropFilter: 'blur(14px)' }}>
          {keys.map((k, i) => {
            const press = interpolate(f - at - 8 - i * 2, [0, 3, 9], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <Reveal key={k} at={at + i * 3} kind="pop" blur={0}>
                <span
                  style={{
                    minWidth: 62,
                    height: 62,
                    padding: '0 16px',
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 13,
                    background: 'linear-gradient(180deg, #3a4360, #232a40)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    boxShadow: `0 ${5 - press * 4}px 0 #10141f, 0 ${8 - press * 5}px 16px rgba(0,0,0,0.5)`,
                    transform: `translateY(${press * 4}px)`,
                    font: `600 29px ${fonts.ui}`,
                    color: '#fff',
                  }}
                >
                  {k}
                </span>
              </Reveal>
            );
          })}
        </div>
      </Reveal>
    </AbsoluteFill>
  );
};
