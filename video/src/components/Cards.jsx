import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, GRAD_TEXT, fonts } from '../theme.js';
import { Mark } from './Mark.jsx';
import { Reveal } from './motion.jsx';

/** A light sweep across its children from frame `at`, then every `every` frames. */
export const Sheen = ({ at = 0, every = 0, children, radius = 0 }) => {
  const f = useCurrentFrame();
  const local = every ? (((f - at) % every) + every) % every : f - at;
  const x = interpolate(local, [0, 26], [-40, 140], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'relative', display: 'inline-block', borderRadius: radius, overflow: 'hidden' }}>
      {children}
      {f >= at && <div style={{ position: 'absolute', top: '-40%', bottom: '-40%', left: `${x}%`, width: '22%', transform: 'skewX(-20deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)', mixBlendMode: 'overlay', pointerEvents: 'none' }} />}
    </div>
  );
};

/**
 * Opening title: the 3D mark, a kicker, a headline whose words flip up one by
 * one ('|' breaks the line; accent: indexes in the gradient), and a subline.
 * It flies past the camera at `until`.
 */
export const TitleCard = ({ kicker, words, accent = [], sub, at = 0, until }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', paddingBottom: 40 }}>
    <Reveal at={-60} until={until} kind="none" exit="through" blur={14}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Mark size={150} at={at} />
        <Reveal at={at + 12} kind="up" dist={20} style={{ marginTop: 58 }}>
          <div style={{ font: `600 22px ${fonts.mono}`, letterSpacing: '0.34em', textTransform: 'uppercase', color: C.cyan, textShadow: '0 0 24px rgba(54,214,255,0.5)' }}>{kicker}</div>
        </Reveal>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.24em', maxWidth: 1780, marginTop: 22, font: `700 124px ${fonts.display}`, letterSpacing: '-0.045em', lineHeight: 1.04, color: '#fff' }}>
          {words.map((w, i) =>
            w === '|' ? (
              <div key={i} style={{ flexBasis: '100%', height: 0 }} />
            ) : (
              <Reveal key={i} at={at + 18 + i * 3} kind="flip" blur={10}>
                <span style={{ ...(accent.includes(i) ? GRAD_TEXT : {}), textShadow: accent.includes(i) ? undefined : '0 10px 40px rgba(0,0,0,0.5)', display: 'inline-block', paddingBottom: '0.08em' }}>{w}</span>
              </Reveal>
            ),
          )}
        </div>
        <Reveal at={at + 22 + words.length * 3} kind="up" dist={24} style={{ marginTop: 22 }}>
          <div style={{ font: `400 34px ${fonts.ui}`, color: C.dim, letterSpacing: '-0.01em' }}>{sub}</div>
        </Reveal>
      </div>
    </Reveal>
  </AbsoluteFill>
);

const fmtMs = v => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`);
/** Parses "1.55 s" / "109 ms" / "7.0 ms" into milliseconds. */
export const toMs = text => {
  const [, n, unit] = /([\d.]+)\s*(ms|s)/.exec(text);
  return unit === 's' ? Number(n) * 1000 : Number(n);
};

/** A duration that counts down to `to` on a log scale and lands exactly on it. */
export const Counter = ({ from, to, at, dur = 44 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - at, [0, dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.exp) });
  const v = p >= 1 ? to : Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * p);
  return <span>{fmtMs(v)}</span>;
};

/** Before → after rows: the old value, a counter that drops to the new one, the change. */
export const StatRows = ({ rows, at, width = 1180 }) => (
  <div style={{ width }}>
    {rows.map((r, i) => (
      <Reveal key={r.label} at={at + i * 7} kind="flip" blur={6}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 30, padding: '24px 0', borderTop: i ? `1px solid ${C.line}` : 'none' }}>
          <span style={{ font: `500 33px ${fonts.ui}`, color: C.dim }}>{r.label}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 20, fontFamily: fonts.ui }}>
            <span style={{ fontSize: 38, fontWeight: 500, color: C.faint }}>{r.before}</span>
            <span style={{ fontSize: 34, color: C.faint }}>→</span>
            <span style={{ font: `700 70px ${fonts.display}`, letterSpacing: '-0.03em', color: '#fff', minWidth: 250, textAlign: 'right', textShadow: '0 0 30px rgba(70,226,160,0.35)' }}>
              <Counter from={toMs(r.before)} to={toMs(r.after)} at={at + i * 7 + 8} />
            </span>
            {r.delta && (
              <Reveal at={at + i * 7 + 40} kind="pop" blur={0}>
                <span style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 12, font: `700 30px ${fonts.display}`, color: '#05140c', background: C.green, boxShadow: '0 0 30px rgba(70,226,160,0.55)' }}>{r.delta}</span>
              </Reveal>
            )}
          </span>
        </div>
      </Reveal>
    ))}
  </div>
);

export const Verdict = ({ children = 'IMPROVED', at = 0 }) => (
  <Sheen at={at + 10} every={150} radius={999}>
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 28px',
        borderRadius: 999,
        font: `700 34px ${fonts.display}`,
        letterSpacing: '0.04em',
        color: '#04140c',
        background: 'linear-gradient(90deg, #46e2a0, #36d6ff)',
        boxShadow: '0 0 60px rgba(70,226,160,0.45)',
      }}
    >
      ✓ {children}
    </span>
  </Sheen>
);

/** A glass panel that slams in from the depth and floats at a slight angle. */
export const Panel = ({ style, children, at = 0, tilt = true }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f - at, fps, config: { damping: 16, stiffness: 160, mass: 0.7 } });
  const t = f / 60;
  return (
    <div style={{ perspective: 1800 }}>
      <div
        style={{
          borderRadius: 30,
          padding: '42px 54px',
          background: 'linear-gradient(160deg, rgba(26,32,60,0.94), rgba(10,13,28,0.96))',
          border: '1px solid rgba(140,180,255,0.28)',
          boxShadow: '0 60px 160px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1), 0 0 80px rgba(54,170,255,0.12)',
          transform: `translateZ(${(1 - a) * -600}px) rotateX(${(1 - a) * 28 + (tilt ? Math.sin(t * 0.9) * 2 : 0)}deg) rotateY(${tilt ? -5 + Math.sin(t * 0.7) * 3 : 0}deg)`,
          opacity: Math.min(1, a * 1.5),
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const Badge = ({ children }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      padding: '18px 28px',
      borderRadius: 16,
      font: `600 28px ${fonts.ui}`,
      color: C.ink,
      background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
      border: '1px solid rgba(255,255,255,0.14)',
      boxShadow: '0 16px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
    }}
  >
    <span style={{ color: C.green, textShadow: '0 0 14px rgba(70,226,160,0.7)' }}>✓</span>
    {children}
  </span>
);

/** Closing card: the 3D mark, the name, what you get, how to get it. */
export const EndCard = ({ at = 0, name, badges, install, footer = 'Free and open source · github.com/progen-labs/spectra' }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', paddingBottom: 60 }}>
    <Mark size={130} at={at} />
    <Reveal at={at + 8} kind="flip" style={{ marginTop: 56 }}>
      <Sheen at={at + 24}>
        <div style={{ font: `700 92px ${fonts.display}`, letterSpacing: '-0.04em', color: '#fff', padding: '0 10px' }}>
          Spectra <span style={GRAD_TEXT}>{name}</span>
        </div>
      </Sheen>
    </Reveal>
    {badges && (
      <div style={{ display: 'flex', gap: 18, marginTop: 38 }}>
        {badges.map((b, i) => (
          <Reveal key={b} at={at + 16 + i * 3} kind="flip" blur={0}>
            <Badge>{b}</Badge>
          </Reveal>
        ))}
      </div>
    )}
    {install && (
      <Reveal at={at + 26} kind="depth" style={{ marginTop: 38 }}>
        <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 8, padding: '24px 36px', borderRadius: 20, background: 'linear-gradient(180deg, rgba(20,26,48,0.95), rgba(8,11,22,0.95))', border: '1px solid rgba(54,214,255,0.35)', boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 50px rgba(54,214,255,0.15)', textAlign: 'left' }}>
          {install.map(line => (
            <div key={line} style={{ font: `500 31px ${fonts.mono}`, color: '#fff' }}>
              <span style={{ color: C.cyan }}>{line.startsWith('/') ? '> ' : '$ '}</span>
              {line}
            </div>
          ))}
        </div>
      </Reveal>
    )}
    <Reveal at={at + 34} style={{ marginTop: 34 }}>
      <div style={{ font: `500 25px ${fonts.mono}`, color: C.faint, letterSpacing: '0.02em' }}>{footer}</div>
    </Reveal>
  </AbsoluteFill>
);
