import React from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, fonts } from '../theme.js';
import { Reveal } from './motion.jsx';

export const LINE = 43; // px per transcript line
const GAP = 18;

/** Text typed at `cps` characters per second from frame `at`, with a caret. */
export const Typed = ({ text, at, cps = 28 }) => {
  const f = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor(((f - at) * cps) / 60)));
  const end = at + (text.length * 60) / cps;
  const caret = f >= at - 24 && f < end + 36 && (f < end || Math.floor(f / 18) % 2 === 0);
  return (
    <>
      {text.slice(0, n)}
      {caret && <span style={{ display: 'inline-block', width: '0.6em', height: '1.1em', marginBottom: '-0.18em', background: C.cyan }} />}
    </>
  );
};

/** Lines that land one after another, three frames apart. */
export const Lines = ({ at, children, step = 3 }) =>
  [children].flat().map((line, i) => (
    <Reveal key={i} at={at + i * step} kind="left" dist={18} blur={2}>
      <div style={{ whiteSpace: 'pre', height: LINE }}>{line}</div>
    </Reveal>
  ));

/** A tool call: its name, its arguments, and live progress until it's done. */
export const ToolCall = ({ name, args, at, doneAt, seconds }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at + 10, doneAt], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) });
  const run = Math.min(3, 1 + Math.floor(p * 3));
  const done = f >= doneAt;
  return (
    <div>
      <div style={{ height: LINE, whiteSpace: 'pre' }}>
        <span style={{ color: done ? C.green : C.amber }}>● </span>
        <span style={{ color: C.violet, fontWeight: 600 }}>spectra · {name}</span>
        <span style={{ color: C.faint }}> ({args})</span>
      </div>
      <div style={{ height: LINE, display: 'flex', alignItems: 'center', gap: 20, color: C.faint, paddingLeft: 30 }}>
        <span>└</span>
        <div style={{ width: 380, height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div style={{ width: `${p * 100}%`, height: '100%', background: done ? C.green : 'linear-gradient(90deg, #0a84ff, #36d6ff)' }} />
        </div>
        <span style={{ color: done ? C.green : C.faint }}>{done ? `done in ${seconds}` : `run ${run}/3 …`}</span>
      </div>
    </div>
  );
};

/** Marks a part of the transcript with a soft cyan bar from frame `at`. */
export const Highlight = ({ at, until, children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f - at, fps, config: { damping: 200 } }) - (until ? spring({ frame: f - until, fps, config: { damping: 200 } }) : 0);
  return (
    <div style={{ margin: '0 -16px', padding: '0 16px', borderRadius: 10, background: `rgba(54,214,255,${0.1 * a})`, boxShadow: `inset 4px 0 0 rgba(54,214,255,${a})` }}>
      {children}
    </div>
  );
};

/**
 * A terminal window whose transcript grows block by block and scrolls to keep
 * the newest block in view. blocks: [{ at, lines, el }].
 */
export const Terminal = ({ title, blocks, width = 1600, height = 900, fontSize = 27 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const viewport = height - 52 - 60;
  let h = 0;
  for (const b of blocks) h += (b.lines * LINE + GAP) * spring({ frame: f - b.at, fps, config: { damping: 200 }, durationInFrames: 24 });
  const offset = Math.max(0, h - viewport);
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 18,
        overflow: 'hidden',
        background: 'rgba(11, 14, 27, 0.97)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 50px 140px rgba(0,0,0,0.7)',
      }}
    >
      <div style={{ height: 52, display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map(c => (
          <span key={c} style={{ width: 14, height: 14, borderRadius: '50%', background: c }} />
        ))}
        <span style={{ flex: 1, textAlign: 'center', marginRight: 70, font: `500 19px ${fonts.ui}`, color: C.faint }}>{title}</span>
      </div>
      <div style={{ height: viewport, margin: '30px 48px', overflow: 'hidden', font: `400 ${fontSize}px ${fonts.mono}`, color: C.ink }}>
        <div style={{ transform: `translateY(${-offset}px)` }}>
          {blocks.map((b, i) =>
            f >= b.at ? (
              <div key={i} style={{ height: b.lines * LINE, marginBottom: GAP }}>
                {b.el}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
};
