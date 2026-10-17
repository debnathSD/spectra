// On-screen type for the launch film: chapter titles, the text column beside
// the 3D, the "for you / for your users" lines, and kinetic words.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Sheen } from '../components/Cards.jsx';
import { Reveal } from '../components/motion.jsx';
import { C, GRAD_TEXT, fonts } from '../theme.js';

/** A chapter number and title, top left; it stays for the chapter. */
export const ChapterTag = ({ n, title, until }) => (
  <AbsoluteFill style={{ padding: '52px 0 0 92px', pointerEvents: 'none' }}>
    <Reveal at={0} until={until} kind="left" dist={40} blur={6}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ font: `700 22px ${fonts.mono}`, color: C.cyan, letterSpacing: '0.2em' }}>{n}</span>
        <span style={{ width: 40, height: 2, background: 'linear-gradient(90deg, #36d6ff, transparent)' }} />
        <span style={{ font: `600 22px ${fonts.mono}`, color: C.dim, letterSpacing: '0.24em', textTransform: 'uppercase' }}>{title}</span>
      </div>
    </Reveal>
  </AbsoluteFill>
);

/** A big chapter title card in the middle of the frame. */
export const ChapterCard = ({ n, title, line, until }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>
    <Reveal at={0} until={until} kind="none" exit="through" blur={12}>
      <Reveal at={2} kind="flip">
        <div style={{ font: `700 26px ${fonts.mono}`, color: C.cyan, letterSpacing: '0.3em', textShadow: '0 0 24px rgba(54,214,255,0.5)' }}>{n}</div>
      </Reveal>
      <Reveal at={6} kind="flip" style={{ marginTop: 14 }}>
        <Sheen at={20}>
          <div style={{ font: `700 120px ${fonts.display}`, letterSpacing: '-0.045em', color: '#fff', padding: '0 12px' }}>{title}</div>
        </Sheen>
      </Reveal>
      {line && (
        <Reveal at={14} style={{ marginTop: 18 }}>
          <div style={{ font: `500 38px ${fonts.ui}`, color: C.dim, letterSpacing: '-0.01em' }}>{line}</div>
        </Reveal>
      )}
    </Reveal>
  </AbsoluteFill>
);

/**
 * The text column beside a 3D scene: a title, a sentence, and why it matters
 * for you (developer experience) and for your users (performance).
 */
export const SideText = ({ title, body, you, users, until, at = 0, top = 300 }) => (
  <AbsoluteFill style={{ padding: `${top}px 0 0 92px`, pointerEvents: 'none' }}>
    <div style={{ width: 640 }}>
      <Reveal at={at} until={until} kind="flip" blur={8}>
        <div style={{ font: `700 74px ${fonts.display}`, letterSpacing: '-0.04em', lineHeight: 1.02, color: '#fff' }}>{title}</div>
      </Reveal>
      {body && (
        <Reveal at={at + 5} until={until} kind="up" dist={20}>
          <div style={{ marginTop: 22, font: `500 30px ${fonts.ui}`, lineHeight: 1.38, color: C.dim }}>{body}</div>
        </Reveal>
      )}
      {(you || users) && (
        <div style={{ marginTop: 34, display: 'grid', gap: 14 }}>
          {[
            ['For you', you, '#36d6ff'],
            ['For your users', users, '#46e2a0'],
          ]
            .filter(([, text]) => text)
            .map(([who, text, color], i) => (
              <Reveal key={who} at={at + 12 + i * 5} until={until} kind="left" dist={30} blur={4}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, padding: '16px 22px', borderRadius: 16, background: 'linear-gradient(90deg, rgba(20,28,56,0.85), rgba(12,16,32,0.4))', border: `1px solid ${color}44`, boxShadow: `inset 3px 0 0 ${color}` }}>
                  <span style={{ font: `700 18px ${fonts.mono}`, color, letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: 172 }}>{who}</span>
                  <span style={{ font: `600 27px ${fonts.ui}`, color: '#fff', lineHeight: 1.3 }}>{text}</span>
                </div>
              </Reveal>
            ))}
        </div>
      )}
    </div>
  </AbsoluteFill>
);

/** A word or phrase that slams in on a beat and stays. */
export const Slam = ({ at, until, children, size = 112, style }) => (
  <Reveal at={at} until={until} kind="slam" blur={14} style={style}>
    <div style={{ font: `700 ${size}px ${fonts.display}`, letterSpacing: '-0.045em', lineHeight: 1.04, color: '#fff', textShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>{children}</div>
  </Reveal>
);

export const Grad = ({ children }) => <span style={GRAD_TEXT}>{children}</span>;

/** A soft white flash on a hit. */
export const Flash = ({ at, strength = 0.5 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f - at, [0, 2, 20], [0, strength, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (o <= 0) return null;
  return <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 45%, rgba(170,220,255,1), rgba(80,140,255,0.4) 40%, transparent 70%)', opacity: o, pointerEvents: 'none' }} />;
};
