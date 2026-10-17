import React from 'react';
import { evolvePath } from '@remotion/paths';
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Background, Grain } from '../components/Background.jsx';
import { Caption } from '../components/Caption.jsx';
import { Badge, EndCard, Panel, StatRows, TitleCard, Verdict } from '../components/Cards.jsx';
import { Reveal } from '../components/motion.jsx';
import { Music, Sfx } from '../components/Sound.jsx';
import { PROFILE, VERIFY } from '../data/session.js';
import { C, beats, fonts } from '../theme.js';

// the timeline, in beats of the music
const F = Object.fromEntries(Object.entries({ clients: 6, tools: 18, flow: 28, verify: 44, safety: 54, end: 62 }).map(([k, v]) => [k, beats(v)]));
export const DURATION = beats(72);
export const MCP_PROPS = { musicEnd: F.end, poster: 132 };

const mono = (size, color = C.ink, weight = 400) => ({ font: `${weight} ${size}px ${fonts.mono}`, color });

// the real snippets from the MCP server guide
const CLIENTS = [
  { name: 'Claude Code', code: ['$ claude mcp add spectra -- \\', '    npx -y @progen-labs/spectra mcp'], note: 'or install the Spectra plugin' },
  { name: 'Claude Desktop · Cursor', code: ['"mcpServers": {', '  "spectra": {', '    "command": "npx",', '    "args": ["-y",', '      "@progen-labs/spectra",', '      "mcp"]', '  }', '}'] },
  { name: 'VS Code', tag: 'agent mode', code: ['"servers": {', '  "spectra": {', '    "type": "stdio",', '    "command": "npx",', '    "args": ["-y",', '      "@progen-labs/spectra",', '      "mcp"]', '  }', '}'] },
];
const TOOLS = [
  ['profile_page', 'Medians, ranked findings, file and line'],
  ['verify_change', 'Re-profile and compare with a baseline'],
  ['compare_profiles', 'Before vs after, without recording'],
  ['run_golden_paths', 'Real user journeys, in safe mode'],
  ['list_reports', 'Saved reports, newest first'],
  ['get_report', 'Components, functions, long tasks'],
];
const SAFETY = [
  ['Local pages only', 'unless you start it with --allow-remote'],
  ['One browser run at a time', 'calls queue instead of colliding'],
  ['Cancel means stop', 'Chrome and any dev server it started close'],
  ['Page text is data', 'results remind the model not to follow it'],
];


// a slow 3D drift for a whole scene
const useDrift = (rx0, ry0) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f, fps, config: { damping: 26, stiffness: 90 } });
  const t = f / 60;
  return `perspective(2000px) rotateX(${rx0 * (1.6 - 0.6 * a) + Math.sin(t * 0.8) * 1.2}deg) rotateY(${ry0 * (1.6 - 0.6 * a) + Math.sin(t * 0.6) * 2}deg)`;
};

const Clients = () => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 50 }}>
    <div style={{ display: 'flex', gap: 34, alignItems: 'stretch', perspective: 1800, transformStyle: 'preserve-3d' }}>
      {CLIENTS.map((c, i) => {
        const side = i - 1;
        return (
          <div key={c.name} style={{ transform: `rotateY(${-side * 20}deg) translateZ(${Math.abs(side) * -90}px)`, transformStyle: 'preserve-3d' }}>
            <Reveal at={4 + i * 4} kind="depth" blur={10}>
              <div style={{ width: 540, height: 480, borderRadius: 26, padding: '32px 34px', background: 'linear-gradient(160deg, rgba(26,32,60,0.96), rgba(10,13,28,0.97))', border: '1px solid rgba(140,180,255,0.3)', boxShadow: '0 50px 120px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.1), 0 0 60px rgba(54,170,255,0.12)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, font: `700 32px ${fonts.ui}`, color: '#fff', marginBottom: 24 }}>
                  {c.name}
                  {c.tag && <span style={{ ...mono(17, C.cyan, 600), letterSpacing: '0.14em', textTransform: 'uppercase' }}>{c.tag}</span>}
                </div>
                {c.code.map((line, j) => (
                  <div key={j} style={{ ...mono(22), whiteSpace: 'pre', lineHeight: '35px' }}>
                    {line.startsWith('$') ? (
                      <>
                        <span style={{ color: C.cyan }}>$</span>
                        {line.slice(1)}
                      </>
                    ) : (
                      line
                        .replace(/"([^"]+)"/g, '\u0000$1\u0000')
                        .split('\u0000')
                        .map((part, k) => (k % 2 ? <span key={k} style={{ color: '#9df3cb' }}>"{part}"</span> : part))
                    )}
                  </div>
                ))}
                {c.note && <div style={{ marginTop: 28, font: `500 23px ${fonts.ui}`, color: C.dim }}>{c.note}</div>}
              </div>
            </Reveal>
          </div>
        );
      })}
    </div>
    <Reveal at={beats(4)} kind="flip" style={{ marginTop: 44 }}>
      <Badge>The Spectra VS Code extension offers it automatically (VS Code 1.101+)</Badge>
    </Reveal>
  </AbsoluteFill>
);

const Tools = () => {
  const drift = useDrift(10, -6);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 40 }}>
      <div style={{ transform: drift }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 540px)', gap: 26 }}>
          {TOOLS.map(([name, what], i) => (
            <Reveal key={name} at={2 + ((i % 3) + Math.floor(i / 3)) * 4} kind="flip" blur={6}>
              <div style={{ height: 162, borderRadius: 22, padding: '30px 32px', background: 'linear-gradient(160deg, rgba(60,56,140,0.5), rgba(20,20,52,0.85))', border: '1px solid rgba(160,150,255,0.45)', boxShadow: '0 30px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
                <div style={mono(32, '#c9bcff', 600)}>{name}</div>
                <div style={{ marginTop: 14, font: `500 26px ${fonts.ui}`, color: C.dim }}>{what}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
      <Reveal at={beats(4)} style={{ marginTop: 50 }}>
        <div style={{ font: `500 30px ${fonts.ui}`, color: C.dim }}>Each one runs the regular Spectra CLI, so the numbers match a run by hand.</div>
      </Reveal>
    </AbsoluteFill>
  );
};

// the protocol as a sequence diagram: the assistant on the left, Spectra on the right
const CLIENT_X = 290;
const SERVER_X = 1070;
const MESSAGES = [
  { at: beats(1), dir: 1, label: 'tools/call', detail: 'profile_page { url: "http://localhost:5188/" }' },
  { at: beats(2.6), dir: -1, label: 'notifications/progress', detail: 'run 1/3 …' },
  { at: beats(3.6), dir: -1, label: 'notifications/progress', detail: 'run 2/3 …' },
  { at: beats(4.6), dir: -1, label: 'notifications/progress', detail: 'run 3/3 …' },
  { at: beats(6), dir: -1, label: 'result', detail: `14.7 s · ${PROFILE.findingCount} findings`, done: true },
];
const Arrow = ({ m, y }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [m.at, m.at + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const [x1, x2] = m.dir > 0 ? [CLIENT_X + 10, SERVER_X - 10] : [SERVER_X - 10, CLIENT_X + 10];
  const d = `M ${x1} ${y} L ${x2} ${y}`;
  const { strokeDasharray, strokeDashoffset } = evolvePath(p, d);
  const color = m.done ? C.green : m.dir > 0 ? C.violet : C.cyan;
  if (f < m.at) return null;
  return (
    <>
      <path d={d} stroke={color} strokeWidth={4} fill="none" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
      {p > 0.98 && <path d={`M ${x2 - m.dir * 18} ${y - 10} L ${x2} ${y} L ${x2 - m.dir * 18} ${y + 10}`} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {p < 1 && <circle cx={x1 + (x2 - x1) * p} cy={y} r={10} fill="#fff" style={{ filter: `drop-shadow(0 0 14px ${color})` }} />}
    </>
  );
};
const Flow = () => {
  const f = useCurrentFrame();
  const drift = useDrift(5, 9);
  const ys = MESSAGES.map((_, i) => 360 + i * 116);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: drift, transformOrigin: '30% 50%' }}>
        {[
          [CLIENT_X, 'AI assistant', 'Claude Code, Cursor, …'],
          [SERVER_X, 'spectra mcp', 'stdio, JSON-RPC'],
        ].map(([x, name, sub], i) => (
          <div key={name} style={{ position: 'absolute', left: x - 170, top: 150, width: 340, textAlign: 'center' }}>
            <Reveal at={2 + i * 4} kind="pop" blur={0}>
              <div style={{ padding: '22px 0', borderRadius: 20, background: 'linear-gradient(160deg, rgba(26,32,60,0.96), rgba(10,13,28,0.97))', border: `1px solid ${i ? 'rgba(54,214,255,0.6)' : 'rgba(170,160,255,0.6)'}`, boxShadow: `0 30px 70px rgba(0,0,0,0.55), 0 0 40px ${i ? 'rgba(54,214,255,0.2)' : 'rgba(150,130,255,0.2)'}` }}>
                <div style={i ? mono(32, C.cyan, 600) : { font: `700 32px ${fonts.ui}`, color: '#fff' }}>{name}</div>
                <div style={{ marginTop: 6, font: `500 20px ${fonts.ui}`, color: C.faint }}>{sub}</div>
              </div>
            </Reveal>
          </div>
        ))}
        <svg width={1920} height={1080} style={{ position: 'absolute' }}>
          {[CLIENT_X, SERVER_X].map(x => (
            <line key={x} x1={x} x2={x} y1={262} y2={interpolate(f, [4, 26], [262, 930], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' })} stroke="rgba(255,255,255,0.18)" strokeWidth={2} strokeDasharray="6 8" />
          ))}
          {MESSAGES.map((m, i) => (
            <Arrow key={i} m={m} y={ys[i]} />
          ))}
        </svg>
        {MESSAGES.map((m, i) => (
          <div key={i} style={{ position: 'absolute', left: CLIENT_X + 40, width: SERVER_X - CLIENT_X - 80, top: ys[i] - 52, textAlign: 'center' }}>
            <Reveal at={m.at + 4} kind="up" dist={12} blur={2}>
              <span style={{ ...mono(21, m.done ? C.green : m.dir > 0 ? '#c9bcff' : C.cyan, 600), whiteSpace: 'nowrap' }}>{m.label}</span>
              <span style={{ ...mono(20, C.dim), whiteSpace: 'pre' }}>
                {'  '}
                {m.detail}
              </span>
            </Reveal>
          </div>
        ))}
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 1240, top: 250, width: 640 }}>
        <Reveal at={beats(7)} kind="swing" blur={8}>
          <Panel at={beats(7)} style={{ padding: '30px 34px' }}>
            <div style={{ ...mono(17, C.faint, 600), letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 16 }}>result · text + structured data</div>
            <div style={{ ...mono(19), lineHeight: '32px', whiteSpace: 'pre' }}>
              {`Profiled http://localhost:5188/ — 3 page-load
runs (medians).

TBT 0 ms · LCP 120 ms · CLS 0.002
`}
              <span style={{ color: C.amber }}>scripting 1.49 s</span>
              {` · DOM 816 nodes

Findings (13, most costly first):
`}
              <span style={{ color: C.red }}>1. [critical]</span>
              {` Row is slow to render:
   1441ms total, 0.2ms per render
   (7200×) — `}
              <span style={{ color: C.cyan }}>src/Row.jsx:3</span>
              {` (1.44 s)
`}
              <span style={{ color: C.red }}>2. [critical]</span>
              {` src/heavy.js spent 1425ms
   of JavaScript — `}
              <span style={{ color: C.cyan }}>src/heavy.js:2</span>
            </div>
          </Panel>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};

const Safety = () => {
  const drift = useDrift(8, 6);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 40 }}>
      <div style={{ transform: drift }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 740px)', gap: 28 }}>
          {SAFETY.map(([title, detail], i) => (
            <Reveal key={title} at={2 + i * 4} kind="flip" blur={6}>
              <div style={{ display: 'flex', gap: 26, alignItems: 'flex-start', height: 162, padding: '32px 36px', borderRadius: 24, background: 'linear-gradient(160deg, rgba(20,48,44,0.6), rgba(10,14,26,0.95))', border: '1px solid rgba(70,226,160,0.4)', boxShadow: '0 30px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
                <span style={{ flex: 'none', width: 58, height: 58, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'rgba(70,226,160,0.16)', color: C.green, font: `700 32px ${fonts.ui}`, boxShadow: '0 0 30px rgba(70,226,160,0.35)' }}>✓</span>
                <div>
                  <div style={{ font: `700 34px ${fonts.ui}`, color: '#fff' }}>{title}</div>
                  <div style={{ marginTop: 10, font: `500 25px ${fonts.ui}`, color: C.dim }}>{detail}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// each scene arrives quickly and leaves by flying past the camera
const Scene = ({ from, to, children }) => (
  <Sequence from={from} durationInFrames={to - from + 12}>
    <Reveal at={-30} until={to - from - 8} kind="none" exit="through" blur={12} style={{ position: 'absolute', inset: 0 }}>
      {children}
    </Reveal>
  </Sequence>
);

export const McpServer = () => {
  const captions = [
    [F.clients + 4, F.tools - 8, 1, <>Add it to any MCP client</>],
    [F.tools + 4, F.flow - 8, 2, <>Six tools that measure, compare and verify</>],
    [F.flow + 4, F.verify - 8, 3, <>Progress while it runs, a ranked result when it's done</>],
    [F.verify + 4, F.safety - 8, 4, <><span style={{ font: `500 28px ${fonts.mono}`, color: C.cyan }}>verify_change</span>: proof, not guesses</>],
    [F.safety + 4, F.end - 8, 5, <>Safe by default</>],
  ];
  return (
    <AbsoluteFill>
      <Background />
      <Sequence durationInFrames={F.clients + 10}>
        <TitleCard kicker="Spectra MCP server" words={['Performance', 'tools', 'for', '|', 'any', 'AI', 'assistant']} accent={[4, 5, 6]} sub="Profile, compare and verify, over the Model Context Protocol." until={F.clients - 16} />
      </Sequence>
      <Scene from={F.clients} to={F.tools}>
        <Clients />
      </Scene>
      <Scene from={F.tools} to={F.flow}>
        <Tools />
      </Scene>
      <Scene from={F.flow} to={F.verify}>
        <Flow />
      </Scene>
      <Scene from={F.verify} to={F.safety}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 40 }}>
          <Panel at={2} style={{ width: 1440 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 12 }}>
              <Reveal at={8} kind="pop" blur={0}>
                <Verdict at={8}>{VERIFY.verdict}</Verdict>
              </Reveal>
              <Reveal at={14} kind="left" dist={30}>
                <span style={{ font: `500 28px ${fonts.ui}`, color: C.dim }}>confidence: {VERIFY.confidence} · {VERIFY.runs}</span>
              </Reveal>
            </div>
            <StatRows at={14} width={1332} rows={[...VERIFY.headlines, VERIFY.scripting]} />
            <Reveal at={beats(5)}>
              <div style={{ marginTop: 14, font: `500 25px ${fonts.ui}`, color: C.dim }}>
                Only changes bigger than the run-to-run noise count. Findings: <span style={{ color: C.green }}>2 resolved</span>, 1 new.
              </div>
            </Reveal>
          </Panel>
        </AbsoluteFill>
      </Scene>
      <Scene from={F.safety} to={F.end}>
        <Safety />
      </Scene>
      {captions.map(([at, until, step, body]) => (
        <Caption key={at} at={at} until={until} step={step}>
          {body}
        </Caption>
      ))}
      <Sequence from={F.end}>
        <EndCard name="MCP server" badges={['Claude Code', 'Claude Desktop', 'Cursor', 'VS Code']} install={['npx -y @progen-labs/spectra mcp']} />
      </Sequence>
      <Grain />

      <Music name="mcp-server" duration={DURATION} />
      {[F.clients, F.tools, F.flow, F.verify, F.safety, F.end].map(at => (
        <Sfx key={at} name="whoosh" at={at - 12} volume={0.45} />
      ))}
      {captions.map(([at]) => (
        <Sfx key={at} name="tick" at={at} volume={0.2} />
      ))}
      {MESSAGES.map(m => (
        <Sfx key={m.at} name="pop" at={F.flow + m.at} volume={0.18} />
      ))}
      <Sfx name="chime" at={F.flow + beats(6)} volume={0.4} />
      <Sfx name="impact" at={F.verify} volume={0.5} />
    </AbsoluteFill>
  );
};
