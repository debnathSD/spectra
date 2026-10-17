import React from 'react';
import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Background, Grain } from '../components/Background.jsx';
import { Caption, Code, Keys } from '../components/Caption.jsx';
import { EndCard, Panel, StatRows, TitleCard, Verdict } from '../components/Cards.jsx';
import { Reveal } from '../components/motion.jsx';
import { Music, Sfx } from '../components/Sound.jsx';
import { C, fonts } from '../theme.js';
import { DURATION, FADE, FOOTAGE_END, INTRO, KEYS, RESULT, SHOTS, STATS, footage, frameOf, mouseAt, timeAt } from './edit.js';

const W = 1520; // the window on stage at zoom 1
const H = Math.round((W * footage.viewport.height) / footage.viewport.width);
const BASE = { x: 960 - W / 2, y: 596 - H / 2 };
const K = W / footage.viewport.width; // footage px → window px
const FOCUS = { x: 960, y: 566 }; // where the camera puts what it looks at
const VIDEO = staticFile('footage/vscode.mp4');
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

const CAM = SHOTS.flatMap(shot => shot.cam.map(([f, z, p]) => ({ frame: shot.start + f, z, x: p.x, y: p.y })));
const camera = (frame, fps) => {
  let cur = { z: 1, x: footage.viewport.width / 2, y: footage.viewport.height / 2 };
  for (const key of CAM) {
    if (frame < key.frame) break;
    const p = spring({ frame: frame - key.frame, fps, config: { damping: 26, stiffness: 150, mass: 0.8 } });
    cur = { z: Math.exp(Math.log(cur.z) + (Math.log(key.z) - Math.log(cur.z)) * p), x: cur.x + (key.x - cur.x) * p, y: cur.y + (key.y - cur.y) * p };
  }
  return cur;
};
// keep a zoomed-in window covering the frame, Screen Studio style
const clamp = (t, size, stage, base, z) => (z * size < stage ? t : Math.min(-base, Math.max(stage - base - z * size, t)));

const Shot = ({ shot, first }) => {
  const frame = useCurrentFrame();
  const opacity = first ? 1 : interpolate(frame, [0, FADE], [0, 1], CLAMP);
  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo src={VIDEO} trimBefore={Math.round(shot.from * 60)} playbackRate={shot.rate} muted style={{ width: '100%', height: '100%' }} />
    </AbsoluteFill>
  );
};

// the cursor shows up around each real mouse move, and fades when idle
const Cursor = ({ frame }) => {
  const t = timeAt(frame);
  const p = mouseAt(t);
  const opacity = Math.max(
    0,
    ...footage.markers.filter(m => m.name === 'mouse').map(m => interpolate(t, [m.t - 0.5, m.t - 0.1, m.t + m.ms / 1000 + 2.6, m.t + m.ms / 1000 + 3.1], [0, 1, 1, 0], CLAMP)),
  );
  if (!opacity) return null;
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" style={{ position: 'absolute', opacity, left: p.x * K - 4, top: p.y * K - 2, filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.55))' }}>
      <path d="M4 2 L4 19.5 L8.6 15.4 L11.6 22 L14.6 20.6 L11.7 14.2 L18 14.2 Z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
};

const Window = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - (INTRO - 18), fps, config: { damping: 17, stiffness: 120, mass: 0.85 } });
  const exit = spring({ frame: frame - (FOOTAGE_END - 6), fps, config: { damping: 30, stiffness: 190, mass: 0.6 }, durationInFrames: 16 });
  if (frame < INTRO - 20 || exit >= 0.995) return null;
  const cam = camera(frame, fps);
  const prev = camera(frame - 1, fps);
  // a touch of motion blur while the camera moves
  const speed = Math.hypot((cam.x - prev.x) * K * cam.z, (cam.y - prev.y) * K * cam.z) + Math.abs(Math.log(cam.z / prev.z)) * 1400;
  const blur = Math.min(2.6, speed / 18) + exit * 14 + (1 - Math.min(1, enter)) * 8;
  // tilted in 3D when we see the whole window, flat once we zoom in to read
  const tilt = interpolate(cam.z, [1, 1.35], [1, 0], CLAMP);
  const t = frame / 60;
  const ry = (-8 + Math.sin(t * 0.9) * 1.6) * tilt - (1 - enter) * 40;
  const rx = (5 + Math.cos(t * 0.7) * 1) * tilt + (1 - enter) * 26;
  const tz = -(1 - enter) * 1400 + exit * 900;
  const tx = clamp(FOCUS.x - BASE.x - cam.z * cam.x * K, W, 1920, BASE.x, cam.z);
  const ty = clamp(FOCUS.y - BASE.y - cam.z * cam.y * K, H, 1080, BASE.y, cam.z);
  const last = SHOTS.at(-1);
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, enter * 1.6) * (1 - exit), filter: blur > 0.05 ? `blur(${blur}px)` : undefined }}>
      <div style={{ position: 'absolute', left: BASE.x, top: BASE.y, width: W, height: H, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${cam.z})` }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            transform: `perspective(${2600 / cam.z}px) translateZ(${tz / cam.z}px) rotateY(${ry}deg) rotateX(${rx}deg)`,
            borderRadius: 16,
            overflow: 'hidden',
            position: 'relative',
            background: '#1e1e1e',
            boxShadow: '0 60px 160px rgba(0,0,0,0.75), 0 0 140px rgba(54,150,255,0.22), 0 0 0 1px rgba(255,255,255,0.14)',
          }}
        >
          {frame < SHOTS[0].start && (
            <Freeze frame={Math.round(SHOTS[0].from * 60)}>
              <OffthreadVideo src={VIDEO} muted style={{ width: '100%', height: '100%' }} />
            </Freeze>
          )}
          {SHOTS.map((shot, i) => (
            <Sequence key={shot.id} from={shot.start} durationInFrames={shot.frames + (i < SHOTS.length - 1 ? FADE : 0)} layout="none">
              <AbsoluteFill>
                <Shot shot={shot} first={i === 0} />
              </AbsoluteFill>
            </Sequence>
          ))}
          {frame >= FOOTAGE_END && (
            <Freeze frame={Math.round(last.from * 60 + (last.frames - 1) * last.rate)}>
              <OffthreadVideo src={VIDEO} muted style={{ width: '100%', height: '100%' }} />
            </Freeze>
          )}
          {/* the macOS window buttons, which the screencast doesn't include */}
          {[0, 1, 2].map(i => (
            <span key={i} style={{ position: 'absolute', top: 11 * K, left: (14 + i * 20) * K, width: 12 * K, height: 12 * K, borderRadius: '50%', background: ['#ff5f57', '#febc2e', '#28c840'][i] }} />
          ))}
          {/* a soft reflection on the glass */}
          <AbsoluteFill style={{ background: `linear-gradient(${115 + Math.sin(t * 0.5) * 6}deg, rgba(255,255,255,${0.07 * tilt}) 0%, transparent 38%)`, pointerEvents: 'none' }} />
          {frame < FOOTAGE_END && <Cursor frame={frame} />}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SpeedBadge = ({ at, until, rate }) => (
  <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: '0 0 46px 56px' }}>
    <Reveal at={at} until={until} kind="pop" blur={0}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 26px', borderRadius: 999, background: 'rgba(9,12,26,0.88)', border: '1px solid rgba(255,199,100,0.5)', boxShadow: '0 0 30px rgba(255,199,100,0.2)', font: `700 27px ${fonts.ui}`, color: C.amber }}>
        <svg width="30" height="20" viewBox="0 0 30 20">
          <path d="M2 2 L14 10 L2 18 Z M15 2 L27 10 L15 18 Z" fill={C.amber} />
        </svg>
        {Math.round(rate)}× speed
      </div>
    </Reveal>
  </AbsoluteFill>
);

const shot = id => SHOTS.find(x => x.id === id);
const startOf = id => shot(id).start;
const endOf = id => shot(id).start + shot(id).frames;

export const VSCode = () => {
  const captions = [
    { at: startOf('palette') + 18, until: endOf('palette'), step: 1, bottom: true, body: <>Run <Code>Spectra: Profile page load</Code></> },
    { at: startOf('running') + 4, until: endOf('running'), body: <>Three real page loads in Chrome</> },
    { at: startOf('results') + 18, until: startOf('results') + 110, step: 2, body: <>{RESULT.findings} findings, ranked by cost</> },
    { at: startOf('results') + 116, until: endOf('results'), body: <>Flagged at the exact line, with render counts</> },
    { at: startOf('hover') + 12, until: endOf('hover'), body: <>Hover for the cost and the fix</> },
    { at: startOf('problems') + 12, until: endOf('problems'), body: <>Every finding in the Problems panel</> },
    { at: startOf('edit') + 8, until: endOf('edit'), step: 3, body: <>Make one change</> },
    { at: startOf('verifyPalette') + 8, until: endOf('verifyPalette'), step: 4, bottom: true, body: <>Run <Code>Spectra: Verify against baseline</Code></> },
    { at: startOf('verifying') + 4, until: endOf('verifying'), body: <>Re-measured the same way</> },
    { at: startOf('verified') + 16, until: endOf('verified') - 6, body: <>Before and after: <span style={{ color: C.green }}>{RESULT.verdict}</span></> },
  ];
  const verdictAt = frameOf(footage.markers.find(m => m.name === 'verify:shown').t);
  return (
    <AbsoluteFill>
      <Background />
      <Sequence durationInFrames={INTRO + 10}>
        <TitleCard kicker="Spectra for VS Code" words={['Find', 'it.', 'Fix', 'it.', 'Prove', 'it.']} accent={[4, 5]} sub="Frontend performance findings, right where you write code." until={INTRO - 16} />
      </Sequence>
      <Window />
      {captions.map((c, i) => (
        <Caption key={i} at={c.at} until={c.until} step={c.step} bottom={c.bottom}>
          {c.body}
        </Caption>
      ))}
      <SpeedBadge at={startOf('running')} until={endOf('running')} rate={shot('running').rate} />
      <SpeedBadge at={startOf('verifying')} until={endOf('verifying')} rate={shot('verifying').rate} />
      {KEYS.map((k, i) => (
        <Keys key={i} at={frameOf(k.t)} until={frameOf(k.t) + 56} keys={k.keys} />
      ))}
      <Sequence from={FOOTAGE_END} durationInFrames={STATS + 12}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Reveal at={0} until={STATS - 10} kind="none" exit="through" blur={12}>
            <Panel at={4} style={{ width: 1400 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 12 }}>
                <Reveal at={10} kind="pop" blur={0}>
                  <Verdict at={10}>{RESULT.verdict.toUpperCase()}</Verdict>
                </Reveal>
                <Reveal at={16} kind="left" dist={30}>
                  <span style={{ font: `500 28px ${fonts.ui}`, color: C.dim }}>confidence: {RESULT.confidence} · beyond run-to-run noise</span>
                </Reveal>
              </div>
              <StatRows
                at={16}
                width={1292}
                rows={[
                  { label: 'JavaScript CPU time', ...RESULT.cpu },
                  { label: 'Row rendering (CodeLens)', ...RESULT.render },
                ]}
              />
            </Panel>
          </Reveal>
        </AbsoluteFill>
      </Sequence>
      <Sequence from={FOOTAGE_END + STATS}>
        <EndCard
          name="for VS Code"
          badges={['Problems & CodeLens', 'Verify every change', 'Agent mode via MCP']}
          install={['code --install-extension progen-labs.spectra-performance']}
          footer="Free on the VS Code Marketplace · github.com/progen-labs/spectra"
        />
      </Sequence>
      <Grain />

      <Music name="vscode" duration={DURATION} />
      <Sfx name="whoosh" at={INTRO - 22} volume={0.55} />
      {SHOTS.slice(1).map(x => (
        <Sfx key={x.id} name="whoosh" at={x.start - 4} volume={0.16} />
      ))}
      <Sfx name="chime" at={verdictAt} volume={0.5} />
      <Sfx name="whoosh" at={FOOTAGE_END - 8} volume={0.5} />
      <Sfx name="impact" at={FOOTAGE_END + 4} volume={0.55} />
      <Sfx name="pop" at={FOOTAGE_END + 10} volume={0.35} />
      {captions.map((c, i) => (
        <Sfx key={i} name="tick" at={c.at} volume={0.2} />
      ))}
      {KEYS.map((k, i) => (
        <Sfx key={`k${i}`} name="pop" at={frameOf(k.t)} volume={0.12} />
      ))}
    </AbsoluteFill>
  );
};
export { DURATION };
export const VSCODE_PROPS = { musicEnd: FOOTAGE_END + STATS, poster: 132 };
