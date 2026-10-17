import { evolvePath, getLength, getPointAtLength } from '@remotion/paths';
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Background, Grain } from '../components/Background.jsx';
import { Caption } from '../components/Caption.jsx';
import { EndCard, Panel, StatRows, TitleCard, Verdict } from '../components/Cards.jsx';
import { Reveal } from '../components/motion.jsx';
import { Music, Sfx } from '../components/Sound.jsx';
import { Highlight, LINE, Lines, Terminal, ToolCall, Typed } from '../components/Terminal.jsx';
import { CHANGE, PROFILE, VERIFY } from '../data/session.js';
import { C, beats, fonts } from '../theme.js';

// the timeline, in beats of the music
const F = Object.fromEntries(
  Object.entries({ add: 6.5, install: 9, chips: 10.6, ask: 13.4, profile: 15.4, profiled: 19.3, findings: 19.7, edit: 28, verify: 32, verified: 35.8, result: 36.1, stats: 40, loop: 48, end: 56 }).map(([k, v]) => [
    k,
    beats(v),
  ]),
);
F.terminal = beats(6) - 18;
export const DURATION = beats(66);
export const CLAUDE_PROPS = { musicEnd: F.end, poster: 132 };

const dim = t => <span style={{ color: C.faint }}>{t}</span>;
const prompt = (text, at, cps) => (
  <div style={{ height: LINE }}>
    <span style={{ color: C.cyan }}>&gt; </span>
    <Typed text={text} at={at} cps={cps} />
  </div>
);

const blocks = [
  { at: F.add - 14, lines: 1, el: prompt('/plugin marketplace add progen-labs/spectra', F.add, 40) },
  { at: F.install - 10, lines: 1, el: prompt('/plugin install spectra@progen-labs', F.install, 40) },
  { at: F.ask - 12, lines: 1, el: prompt('Make the home page faster.', F.ask, 30) },
  { at: F.profile, lines: 2, el: <ToolCall name="profile_page" args={`url: "${PROFILE.url}"`} at={F.profile} doneAt={F.profiled} seconds={PROFILE.seconds} /> },
  {
    at: F.findings,
    lines: 8,
    el: (
      <div style={{ paddingLeft: 30 }}>
        <Lines at={F.findings}>
          {[
            <>
              {PROFILE.metrics.map(([k, v], i) => (
                <span key={k}>
                  {i ? dim(' · ') : ''}
                  {k} <span style={{ color: k === 'Scripting' ? C.amber : C.ink }}>{v}</span>
                </span>
              ))}
            </>,
            dim(`${PROFILE.findingCount} findings, most costly first:`),
          ]}
        </Lines>
        <Highlight at={F.findings + 40} until={F.edit}>
          <Lines at={F.findings + 6}>
            {[
              <><span style={{ color: C.red }}>1. [critical]</span> {PROFILE.findings[0].title}</>,
              <>   <span style={{ color: C.cyan }}>{PROFILE.findings[0].where}</span>{dim(` · ${PROFILE.findings[0].cost} · seen in 3/3 runs`)}</>,
              dim('   Fix: Move expensive calculations into useMemo, virtualise long lists,'),
              dim('   and avoid deriving large data structures inside render.'),
            ]}
          </Lines>
        </Highlight>
        <Lines at={F.findings + 18}>
          {[
            <><span style={{ color: C.red }}>2. [critical]</span> {PROFILE.findings[1].title}</>,
            <>   <span style={{ color: C.cyan }}>{PROFILE.findings[1].where}</span>{dim(` · ${PROFILE.findings[1].cost} · seen in 3/3 runs`)}</>,
          ]}
        </Lines>
      </div>
    ),
  },
  {
    at: F.edit,
    lines: 5,
    el: (
      <div>
        <div style={{ height: LINE }}>
          <span style={{ color: C.green }}>● </span>
          <span style={{ fontWeight: 600 }}>Update</span> {dim(`(${CHANGE.file})`)}
        </div>
        <div style={{ marginLeft: 30, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
          <Lines at={F.edit + 6} step={6}>
            {[
              dim('   export function Row({ index, onPick }) {'),
              <span style={{ display: 'block', background: 'rgba(255,95,120,0.16)', color: '#ffa3b5' }}>{`-${CHANGE.before}`}</span>,
              <span style={{ display: 'block', background: 'rgba(70,226,160,0.16)', color: '#9df3cb' }}>{`+${CHANGE.after}`}</span>,
              dim('     return ('),
            ]}
          </Lines>
        </div>
      </div>
    ),
  },
  { at: F.verify, lines: 2, el: <ToolCall name="verify_change" args='baseline: "…/profile-20261017T045006.json"' at={F.verify} doneAt={F.verified} seconds={VERIFY.seconds} /> },
  {
    at: F.result,
    lines: 4,
    el: (
      <div style={{ paddingLeft: 30 }}>
        <Lines at={F.result}>
          {[
            <>Verdict: <span style={{ color: C.green, fontWeight: 600 }}>{VERIFY.verdict}</span>{dim(` (confidence: ${VERIFY.confidence}; 3 run(s) before, 3 after).`)}</>,
            ...VERIFY.headlines.map(h => (
              <>
                <span style={{ color: C.green }}>✓</span> {h.label}: {h.before} → <span style={{ color: C.green }}>{h.after}</span> ({h.delta})
              </>
            )),
            dim(`Findings: ${VERIFY.findings}.`),
          ]}
        </Lines>
      </div>
    ),
  },
];

// the terminal flies in from the depth at an angle, floats while it works,
// sits back behind the results, then flies past the camera
const TerminalShot = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f - F.terminal, fps, config: { damping: 17, stiffness: 120, mass: 0.85 } });
  const back = spring({ frame: f - F.stats, fps, config: { damping: 26, stiffness: 160 } });
  const exit = spring({ frame: f - (F.loop - 8), fps, config: { damping: 30, stiffness: 190 }, durationInFrames: 16 });
  if (f < F.terminal - 2 || exit > 0.995) return null;
  const t = f / 60;
  const push = interpolate(f, [F.terminal, F.stats], [1, 1.06], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 76 }}>
      <div
        style={{
          opacity: Math.min(1, enter * 1.6) * (1 - exit) * (1 - back * 0.35),
          transform: `perspective(2400px) translateZ(${-(1 - enter) * 1400 - back * 420 + exit * 800}px) rotateY(${-(1 - enter) * 40 - 6 + Math.sin(t * 0.8) * 2}deg) rotateX(${(1 - enter) * 24 + 4 + Math.cos(t * 0.6)}deg) scale(${push})`,
          filter: back || exit ? `blur(${back * 6 + exit * 14}px)` : undefined,
        }}
      >
        <div style={{ boxShadow: '0 0 160px rgba(54,150,255,0.2)', borderRadius: 18 }}>
          <Terminal title="claude — demo-app" blocks={blocks} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CHIPS = [
  ['MCP server', '6 tools'],
  ['improve-performance', 'skill'],
  ['audit', 'skill'],
];

// Measure → Change → Verify → Keep or revert, drawn as a loop on a 3D floor
const LOOP = 'M 960 200 C 1420 200 1660 360 1660 560 C 1660 760 1420 920 960 920 C 500 920 260 760 260 560 C 260 360 500 200 960 200';
const NODES = [
  ['Measure', 0],
  ['Change', 0.25],
  ['Verify', 0.5],
  ['Keep or revert', 0.75],
];
const Loop = () => {
  const f = useCurrentFrame();
  const draw = interpolate(f, [6, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const len = getLength(LOOP);
  const { strokeDasharray, strokeDashoffset } = evolvePath(draw, LOOP);
  const head = getPointAtLength(LOOP, Math.min(len - 0.01, draw * len));
  const t = f / 60;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 150, textAlign: 'center' }}>
        <Reveal at={4} kind="flip">
          <div style={{ font: `700 66px ${fonts.display}`, letterSpacing: '-0.035em', color: '#fff' }}>Keeps a change only if it measurably helped</div>
        </Reveal>
        <Reveal at={14} style={{ marginTop: 16 }}>
          <div style={{ font: `400 30px ${fonts.ui}`, color: C.dim }}>Up to three changes per request, unless you ask for more.</div>
        </Reveal>
      </AbsoluteFill>
      <AbsoluteFill style={{ perspective: 1500, perspectiveOrigin: '50% 20%' }}>
        <AbsoluteFill style={{ transformStyle: 'preserve-3d', transform: `translateY(150px) rotateX(${58 + Math.sin(t) * 1.5}deg) rotateZ(${Math.sin(t * 0.5) * 3}deg) scale(0.8)` }}>
          <svg width={1920} height={1080} style={{ position: 'absolute' }}>
            <defs>
              <linearGradient id="loop" x1="0" x2="1">
                <stop offset="0" stopColor="#0a84ff" />
                <stop offset="0.5" stopColor="#36d6ff" />
                <stop offset="1" stopColor="#bf5af2" />
              </linearGradient>
            </defs>
            <path d={LOOP} fill="none" stroke="rgba(54,214,255,0.12)" strokeWidth={36} />
            <path d={LOOP} fill="none" stroke="url(#loop)" strokeWidth={9} strokeLinecap="round" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} style={{ filter: 'drop-shadow(0 0 14px rgba(54,214,255,0.8))' }} />
            {draw > 0 && draw < 1 && <circle cx={head.x} cy={head.y} r={16} fill="#fff" style={{ filter: 'drop-shadow(0 0 18px #36d6ff)' }} />}
          </svg>
          {NODES.map(([label, at]) => {
            const p = getPointAtLength(LOOP, at * len);
            return (
              <div key={label} style={{ position: 'absolute', left: p.x, top: p.y, transformStyle: 'preserve-3d', transform: 'translate(-50%, -100%) rotateX(-58deg)', transformOrigin: '50% 100%' }}>
                <Reveal at={6 + at * 64} kind="pop" blur={0} origin="50% 100%">
                  <div
                    style={{
                      padding: '22px 36px',
                      borderRadius: 20,
                      font: `700 40px ${fonts.ui}`,
                      color: '#fff',
                      background: 'linear-gradient(180deg, rgba(30,38,72,0.98), rgba(12,16,32,0.98))',
                      border: `1px solid ${label === 'Keep or revert' ? 'rgba(70,226,160,0.7)' : 'rgba(140,180,255,0.45)'}`,
                      boxShadow: `0 30px 60px rgba(0,0,0,0.6), 0 0 40px ${label === 'Keep or revert' ? 'rgba(70,226,160,0.3)' : 'rgba(54,170,255,0.25)'}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label === 'Keep or revert' && <span style={{ color: C.green }}>✓ </span>}
                    {label}
                  </div>
                </Reveal>
              </div>
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ClaudeCode = () => {
  const captions = [
    [F.add - 8, F.ask - 12, 1, <>Install the plugin</>],
    [F.ask - 8, F.findings - 4, 2, <>Ask in plain words</>],
    [F.findings + 2, F.edit - 4, 3, <>Spectra names the component, file and line</>],
    [F.edit, F.verify - 4, 4, <>Claude makes one focused change</>],
    [F.verify, F.stats - 2, 5, <>Then proves it, beyond run-to-run noise</>],
  ];
  return (
    <AbsoluteFill>
      <Background />
      <Sequence durationInFrames={beats(6) + 10}>
        <TitleCard kicker="Spectra for Claude Code" words={['Faster', 'pages,', 'proven.']} accent={[2]} sub="Claude profiles your app, makes a fix, and keeps it only if it measurably helped." until={beats(6) - 16} />
      </Sequence>
      <TerminalShot />
      {captions.map(([at, until, step, body]) => (
        <Caption key={at} at={at} until={until} step={step}>
          {body}
        </Caption>
      ))}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 440, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', gap: 24 }}>
          {CHIPS.map(([name, kind], i) => (
            <Reveal key={name} at={F.chips + i * 4} until={F.ask - 14} kind="flip" exit="flip" blur={4}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '22px 32px', borderRadius: 20, background: 'linear-gradient(180deg, rgba(48,40,110,0.97), rgba(24,20,60,0.97))', border: '1px solid rgba(170,160,255,0.55)', boxShadow: '0 30px 70px rgba(0,0,0,0.6), 0 0 40px rgba(140,120,255,0.3)', font: `600 32px ${fonts.mono}`, color: '#fff' }}>
                {name} <span style={{ font: `500 24px ${fonts.ui}`, color: C.dim }}>{kind}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </AbsoluteFill>
      <Sequence from={F.stats} durationInFrames={F.loop - F.stats + 12}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Reveal at={0} until={F.loop - F.stats - 10} kind="none" exit="through" blur={12}>
            <Panel at={2} style={{ width: 1440 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 12 }}>
                <Reveal at={8} kind="pop" blur={0}>
                  <Verdict at={8}>{VERIFY.verdict}</Verdict>
                </Reveal>
                <Reveal at={14} kind="left" dist={30}>
                  <span style={{ font: `500 28px ${fonts.ui}`, color: C.dim }}>confidence: {VERIFY.confidence} · {VERIFY.runs}</span>
                </Reveal>
              </div>
              <StatRows at={14} width={1332} rows={VERIFY.headlines} />
            </Panel>
          </Reveal>
        </AbsoluteFill>
      </Sequence>
      <Sequence from={F.loop} durationInFrames={F.end - F.loop + 12}>
        <Reveal at={0} until={F.end - F.loop - 10} kind="none" exit="through" blur={10} style={{ position: 'absolute', inset: 0 }}>
          <Loop />
        </Reveal>
      </Sequence>
      <Sequence from={F.end}>
        <EndCard name="for Claude Code" install={['/plugin marketplace add progen-labs/spectra', '/plugin install spectra@progen-labs']} />
      </Sequence>
      <Grain />

      <Music name="claude-code" duration={DURATION} />
      <Sfx name="whoosh" at={F.terminal - 6} volume={0.55} />
      {CHIPS.map((_, i) => (
        <Sfx key={i} name="pop" at={F.chips + i * 4} volume={0.25} />
      ))}
      <Sfx name="pop" at={F.profiled} volume={0.3} />
      <Sfx name="chime" at={F.verified} volume={0.5} />
      <Sfx name="impact" at={F.stats} volume={0.55} />
      <Sfx name="whoosh" at={F.loop - 10} volume={0.45} />
      {NODES.map(([label, at]) => (
        <Sfx key={label} name="pop" at={F.loop + 6 + Math.round(at * 64)} volume={0.22} />
      ))}
      <Sfx name="whoosh" at={F.end - 10} volume={0.45} />
      {captions.map(([at]) => (
        <Sfx key={at} name="tick" at={at} volume={0.2} />
      ))}
    </AbsoluteFill>
  );
};
