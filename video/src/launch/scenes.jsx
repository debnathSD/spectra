// The launch film's chapters. Each one plays inside a <Sequence>, so its
// frames start at 0; `len` is its length in frames.
import React from 'react';
import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Panel, StatRows, Verdict } from '../components/Cards.jsx';
import { Reveal } from '../components/motion.jsx';
import { Highlight, LINE, Lines, Terminal, ToolCall, Typed } from '../components/Terminal.jsx';
import { FRAMEWORKS, SURFACES } from '../data/launch.js';
import { CHANGE, PROFILE, VERIFY } from '../data/session.js';
import { CLAMP, Chip, Orb, PAL, Ring, SceneTime } from '../scenes3d/kit.jsx';
import { FEATURE_SCENES } from '../scenes3d/features.jsx';
import { Beam, Mark3D, Tile } from '../three/Brand3D.jsx';
import { Label } from '../three/Label.jsx';
import { ground, simulate } from '../three/physics.js';
import { Floor, Stage3D, glass, glossy, rounded } from '../three/Stage3D.jsx';
import { BEAT, C, GRAD_TEXT, beats, fonts } from '../theme.js';
import { footage } from '../vscode/edit.js';
import { CLI_FEATURES, CLI_FEATURE_BEATS } from './timeline.js';
import { ChapterCard, ChapterTag, Flash, Grad, SideText, Slam } from './ui.jsx';

const BAR = BEAT * 4;
const useT = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { f, fps, sp: (at, config = { damping: 15, stiffness: 120, mass: 0.7 }) => spring({ frame: f - at, fps, config }) };
};
const fade = (f, len, inF = 8, outF = 8) => Math.min(interpolate(f, [0, inF], [0, 1], CLAMP), interpolate(f, [len - outF, len], [1, 0], CLAMP));

// ---------------------------------------------------------------- cold open
const PARTS = Array.from({ length: 70 }, (_, i) => ({
  from: [(random(`px${i}`) - 0.5) * 16, random(`py${i}`) * 7 - 1, (random(`pz${i}`) - 0.5) * 10 - 2],
  to: [(random(`tx${i}`) - 0.5) * 1.2, 2.9 + (random(`ty${i}`) - 0.5) * 1.2, (random(`tz${i}`) - 0.5) * 0.3],
  color: random(`c${i}`) > 0.5 ? '#36d6ff' : '#a98bff',
}));
export const OpenScene = ({ len }) => {
  const { f, sp } = useT();
  const drop = beats(2); // the first downbeat
  const gather = interpolate(f, [0, drop], [0, 1], { ...CLAMP, easing: t => t * t * t });
  const land = sp(drop, { damping: 11, stiffness: 120, mass: 0.8 });
  const draw = interpolate(f, [drop + 10, drop + 46], [0, 1], CLAMP);
  const z = interpolate(f, [0, len], [10.5, 8.2]);
  return (
    <AbsoluteFill>
      <Stage3D camera={[Math.sin(f / 300) * 1.2, 2.6, z]} target={[0, 2.0, 0]}>
        <Floor />
        {f < drop + 4 &&
          PARTS.map((p, i) => {
            const pos = p.from.map((v, k) => v + (p.to[k] - v) * gather);
            return <Orb key={i} position={pos} r={0.04 + 0.03 * random(`r${i}`)} color={p.color} intensity={3.5} />;
          })}
        {f >= drop - 2 && <Mark3D position={[0, 2.9, 0]} rotation={[0.12, (1 - land) * -2.6 - 0.32 + Math.sin(f / 70) * 0.1, 0]} scale={0.25 + 0.72 * land} draw={draw} />}
      </Stage3D>
      <Flash at={drop} strength={0.6} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 700, textAlign: 'center' }}>
        <Reveal at={drop + 16} until={beats(2 + 8) - 6} kind="flip" exit="flip">
          <div style={{ font: `700 150px ${fonts.display}`, letterSpacing: '-0.05em', lineHeight: 1, ...GRAD_TEXT }}>Spectra</div>
        </Reveal>
        <Reveal at={drop + 34} until={beats(2 + 8) - 6} style={{ marginTop: 10 }}>
          <div style={{ font: `500 34px ${fonts.ui}`, color: C.dim, letterSpacing: '0.01em' }}>Frontend performance, measured.</div>
        </Reveal>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 712, textAlign: 'center', gap: 6 }}>
        <div style={{ display: 'flex', gap: 28 }}>
          <Slam at={beats(2 + 8)} until={len - 6}>Free.</Slam>
          <Slam at={beats(2 + 9)} until={len - 6}>
            <Grad>Open source.</Grad>
          </Slam>
        </div>
        <Reveal at={beats(2 + 12)} until={len - 6} kind="flip">
          <div style={{ font: `600 46px ${fonts.ui}`, color: '#fff', letterSpacing: '-0.01em' }}>For every frontend you build.</div>
        </Reveal>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- the problem
const CITY = Array.from({ length: 63 }, (_, i) => {
  const x = (i % 9) - 4;
  const z = Math.floor(i / 9) - 4;
  return { x: x * 1.15, z: z * 1.15, h: 0.4 + random(`h${i}`) * 2.2, color: random(`k${i}`) > 0.5 ? '#2c4fa8' : '#4a3fb0', culprit: x === 0 && z === 1 };
});
export const ProblemScene = ({ len }) => {
  const { f, sp } = useT();
  const collapse = sp(BAR * 2, { damping: 20, stiffness: 90 });
  const rise = sp(BAR * 2 + 10, { damping: 10, stiffness: 100, mass: 0.9 });
  const cam = [interpolate(f, [0, len], [-5, 3]), interpolate(f, [0, len], [3.4, 4.6]), interpolate(f, [0, len], [11, 9.2])];
  return (
    <AbsoluteFill style={{ opacity: fade(f, len, 6, 6) }}>
      <Stage3D camera={cam} target={[0, 1.2, 0.5]}>
        <Floor />
        {CITY.map((c, i) => {
          const grow = sp(i * 0.9, { damping: 14, stiffness: 110 });
          const h = c.culprit ? c.h * grow * (1 - collapse) + 2.6 * rise : c.h * grow * (1 - 0.94 * collapse);
          return (
            <mesh key={i} position={[c.x, Math.max(0.02, h) / 2, c.z]} geometry={rounded(0.9, Math.max(0.04, h), 0.9, 0.06)} material={c.culprit && rise > 0.05 ? glossy('#e8455f', '#e8455f', 0.45) : glossy(c.color)} castShadow receiveShadow />
          );
        })}
        {rise > 0.4 && <Chip text="Row · src/Row.jsx:3 · 1.44 s" position={[0, 3.25, 1.9]} scale={rise} w={4.2} h={0.6} d={0.2} size={0.26} color="#2a0f1a" textColor="#ff9fb2" />}
      </Stage3D>
      <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(6,9,18,0.92) 0%, rgba(6,9,18,0.7) 18%, transparent 38%)' }} />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 880, textAlign: 'center' }}>
        <div style={{ position: 'relative', height: 140, width: 1800 }}>
          <AbsoluteFill style={{ alignItems: 'center' }}>
            <Slam at={4} until={BAR - 4} size={96}>
              Your app feels slow.
            </Slam>
          </AbsoluteFill>
          <AbsoluteFill style={{ alignItems: 'center' }}>
            <Slam at={BAR} until={BAR * 2 - 4} size={96}>
              Profilers show you everything.
            </Slam>
          </AbsoluteFill>
          <AbsoluteFill style={{ alignItems: 'center' }}>
            <Slam at={BAR * 2 + 4} until={len - 6} size={96}>
              Spectra shows you <Grad>the one thing.</Grad>
            </Slam>
          </AbsoluteFill>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 01 MCP
const CLIENTS = ['Claude Code', 'Cursor', 'VS Code', 'Claude Desktop', 'Windsurf'];
const TOOLS = ['profile_page', 'verify_change', 'compare_profiles', 'run_golden_paths', 'list_reports', 'get_report'];
const McpWorld = ({ toolsAt }) => {
  const { f, fps } = useT();
  const sim = simulate(
    'mcp-tools',
    (world, Cn) => {
      ground(world, Cn);
      return TOOLS.map((_, i) => {
        const b = new Cn.Body({ type: Cn.Body.STATIC, shape: new Cn.Box(new Cn.Vec3(1.15, 0.2, 0.4)), position: new Cn.Vec3(0.5 + ((i % 3) - 1) * 2.35, 3 + i * 0.3, 1.1 + Math.floor(i / 3) * 0.95) });
        b.quaternion.setFromEuler(0.25 * ((i % 2) * 2 - 1), 0.12 * (i - 2.5), 0.1);
        b.dropAt = toolsAt + i * 5;
        b.dropMass = 1;
        world.addBody(b);
        return b;
      });
    },
    Math.round(16 * fps),
    { fps },
  );
  const bodies = sim(f);
  return (
    <>
      <group position={[0, 2.1, -0.6]}>
        <Mark3D rotation={[0.1, f / 90, 0]} scale={0.62} />
        <mesh>
          <sphereGeometry args={[1.25, 64, 64]} />
          <primitive object={glass('#cfeaff')} attach="material" />
        </mesh>
      </group>
      <Ring radius={1.6} y={0.03} />
      {CLIENTS.map((name, i) => {
        const a = Math.PI * (0.92 + (i / (CLIENTS.length - 1)) * 1.16);
        const p = [Math.cos(a) * 3.3, 1.2 + (i % 2) * 0.9, Math.sin(a) * 2.4 - 1.2];
        const packet = ((f / fps) * 0.9 + i * 0.37) % 1;
        const along = [p[0] + (0 - p[0]) * packet, p[1] + (2.1 - p[1]) * packet, p[2] + (-0.6 - p[2]) * packet];
        return (
          <group key={name}>
            <Beam from={p} to={[0, 2.1, -0.6]} radius={0.012} color="#2a8fd8" />
            <Orb position={along} r={0.08} color={PAL.cyan} />
            <Chip text={name} position={p} w={2.1} h={0.56} d={0.22} size={0.22} color={PAL.slate2} rotation={[0, -Math.cos(a) * 0.3, 0]} />
          </group>
        );
      })}
      {bodies.map((b, i) => (
        <Chip key={TOOLS[i]} text={TOOLS[i]} position={b.p} quaternion={b.q} w={2.3} h={0.4} d={0.8} size={0.19} font="mono" color="#3b2f9e" textColor="#e6dcff" />
      ))}
    </>
  );
};
export const McpScene = ({ len }) => {
  const { f } = useT();
  const startWorld = BAR - 8;
  return (
    <AbsoluteFill>
      <Sequence from={startWorld} layout="none">
        <AbsoluteFill style={{ opacity: fade(f - startWorld, len - startWorld, 10, 8) }}>
          <Stage3D camera={[0.6, 3.6, 12.5]} target={[0, 1.7, 0.4]} shift={410}>
            <Floor />
            <McpWorld toolsAt={BAR * 2} />
          </Stage3D>
        </AbsoluteFill>
      </Sequence>
      <Sequence durationInFrames={BAR + 10} layout="none">
        <ChapterCard n="01" title="MCP server" line="Real measurements for any AI assistant." until={BAR - 10} />
      </Sequence>
      <Sequence from={BAR} layout="none">
        <ChapterTag n="01" title="MCP server" until={len - BAR - 8} />
        <SideText
          at={6}
          until={len - BAR - 8}
          top={210}
          title="Your assistant, now measuring"
          body="Claude Code, Cursor, VS Code and every MCP client get six tools to profile, verify and compare."
          you="It measures before it edits. No more guessing."
          users="Fixes land on the code that costs them time."
        />
        <AbsoluteFill style={{ alignItems: 'flex-start', justifyContent: 'flex-end', padding: '0 0 56px 92px' }}>
          <Reveal at={BAR * 3} until={len - BAR - 8} kind="depth" blur={8}>
            <div style={{ width: 760, padding: '24px 30px', borderRadius: 20, background: 'linear-gradient(160deg, rgba(20,26,50,0.95), rgba(8,11,22,0.95))', border: '1px solid rgba(54,214,255,0.35)', boxShadow: '0 30px 80px rgba(0,0,0,0.6)', font: `500 22px ${fonts.mono}`, lineHeight: 1.6, color: '#dfe7ff', whiteSpace: 'pre' }}>
              <span style={{ color: C.violet }}>profile_page</span>
              <span style={{ color: C.faint }}> → 3 page-load runs (medians)</span>
              {'\n'}TBT 0 ms · LCP 120 ms · <span style={{ color: C.amber }}>scripting 1.49 s</span>
              {'\n'}
              <span style={{ color: C.red }}>1. [critical]</span> Row is slow to render: 1441ms
              {'\n'}   <span style={{ color: C.cyan }}>src/Row.jsx:3</span> · Fix: move it into useMemo
            </div>
          </Reveal>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 02 Claude Code
const claudeBlocks = T => {
  const dim = t => <span style={{ color: C.faint }}>{t}</span>;
  return [
    { at: T.ask - 10, lines: 1, el: <div style={{ height: LINE }}><span style={{ color: C.cyan }}>&gt; </span><Typed text="Make the home page faster." at={T.ask} cps={34} /></div> },
    { at: T.profile, lines: 2, el: <ToolCall name="profile_page" args={`url: "${PROFILE.url}"`} at={T.profile} doneAt={T.profiled} seconds={PROFILE.seconds} /> },
    {
      at: T.found,
      lines: 2,
      el: (
        <div style={{ paddingLeft: 30 }}>
          <Highlight at={T.found + 12} until={T.edit}>
            <Lines at={T.found}>{[<><span style={{ color: C.red }}>1. [critical]</span> Row is slow to render: 1441ms</>, <>   <span style={{ color: C.cyan }}>src/Row.jsx:3</span>{dim(' · 1.44 s · 3/3 runs')}</>]}</Lines>
          </Highlight>
        </div>
      ),
    },
    {
      at: T.edit,
      lines: 3,
      el: (
        <div>
          <div style={{ height: LINE }}><span style={{ color: C.green }}>● </span><b>Update</b> {dim(`(${CHANGE.file})`)}</div>
          <div style={{ marginLeft: 30, borderRadius: 10, overflow: 'hidden' }}>
            <Lines at={T.edit + 4} step={5}>{[<span style={{ display: 'block', background: 'rgba(255,95,120,0.16)', color: '#ffa3b5' }}>{`-${CHANGE.before}`}</span>, <span style={{ display: 'block', background: 'rgba(70,226,160,0.16)', color: '#9df3cb' }}>{`+${CHANGE.after}`}</span>]}</Lines>
          </div>
        </div>
      ),
    },
    { at: T.verify, lines: 2, el: <ToolCall name="verify_change" args='baseline: "…/profile-…006.json"' at={T.verify} doneAt={T.verified} seconds={VERIFY.seconds} /> },
    { at: T.result, lines: 2, el: <div style={{ paddingLeft: 30 }}><Lines at={T.result}>{[<>Verdict: <span style={{ color: C.green, fontWeight: 600 }}>{VERIFY.verdict}</span>{dim(` (confidence: ${VERIFY.confidence})`)}</>, <><span style={{ color: C.green }}>✓</span> JavaScript CPU time: 1.55 s → <span style={{ color: C.green }}>107 ms</span> (−93%)</>]}</Lines></div> },
  ];
};
export const ClaudeScene = ({ len }) => {
  const { f, fps } = useT();
  const o = BAR; // after the chapter card
  const T = { ask: o + 12, profile: o + 60, profiled: o + 150, found: o + 156, edit: o + 230, verify: o + 300, verified: o + 400, result: o + 406 };
  const stats = BAR * 5.6;
  const blocks = claudeBlocks(T);
  const enter = spring({ frame: f - o, fps, config: { damping: 18, stiffness: 120 } });
  const back = spring({ frame: f - stats, fps, config: { damping: 26, stiffness: 150 } });
  const t = f / 60;
  return (
    <AbsoluteFill>
      <Sequence from={o - 8} layout="none">
        <SceneTime.Provider value={{ scale: 1, total: (len - o) / fps, shift: 470 }}>
          <AbsoluteFill style={{ opacity: fade(f - o + 8, len - o + 8, 10, 8) * (1 - back * 0.6) }}>{React.createElement(FEATURE_SCENES.ai, { loop: false, fps })}</AbsoluteFill>
        </SceneTime.Provider>
      </Sequence>
      <Sequence durationInFrames={BAR + 10} layout="none">
        <ChapterCard n="02" title="Claude Code plugin" line="Ask for a faster page. Get proof." until={BAR - 10} />
      </Sequence>
      {f >= o - 4 && (
        <AbsoluteFill style={{ padding: '170px 0 0 70px' }}>
          <div
            style={{
              width: 1060,
              opacity: Math.min(1, enter * 1.5) * (1 - back * 0.7) * fade(f, len, 1, 10),
              transform: `perspective(2400px) translateZ(${-(1 - enter) * 900 - back * 300}px) rotateY(${12 - (1 - enter) * 30 + Math.sin(t * 0.7) * 1.5}deg) rotateX(3deg) scale(0.86)`,
              transformOrigin: '0% 50%',
              filter: back ? `blur(${back * 5}px)` : undefined,
            }}
          >
            <Terminal title="claude — demo-app" blocks={blocks} width={1060} height={780} fontSize={26} />
          </div>
        </AbsoluteFill>
      )}
      <Sequence from={BAR} layout="none">
        <ChapterTag n="02" title="Claude Code plugin" until={len - BAR - 8} />
      </Sequence>
      <Sequence from={stats} layout="none">
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 26 }}>
          <Reveal at={0} until={len - stats - 8} kind="none" exit="through" blur={10}>
            <Panel at={2} style={{ width: 1360, padding: '36px 50px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 10 }}>
                <Reveal at={6} kind="pop" blur={0}>
                  <Verdict at={6}>{VERIFY.verdict}</Verdict>
                </Reveal>
                <span style={{ font: `500 28px ${fonts.ui}`, color: C.dim }}>confidence: {VERIFY.confidence} · {VERIFY.runs}</span>
              </div>
              <StatRows at={10} width={1260} rows={VERIFY.headlines} />
            </Panel>
          </Reveal>
          <div style={{ display: 'flex', gap: 22 }}>
            {[
              ['For you', 'One sentence in, a verified fix out.', '#36d6ff'],
              ['For your users', 'Only changes that measurably help are kept.', '#46e2a0'],
            ].map(([who, text, color], i) => (
              <Reveal key={who} at={30 + i * 6} until={len - stats - 8} kind="flip" blur={4}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '16px 24px', borderRadius: 16, background: 'rgba(14,20,40,0.92)', border: `1px solid ${color}55`, boxShadow: `inset 3px 0 0 ${color}` }}>
                  <span style={{ font: `700 17px ${fonts.mono}`, color, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{who}</span>
                  <span style={{ font: `600 27px ${fonts.ui}`, color: '#fff' }}>{text}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 03 VS Code
const M = name => footage.markers.find(m => m.name === name);
const mice = footage.markers.filter(m => m.name === 'mouse');
const centerOf = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const VS_SEGMENTS = (() => {
  const lens = centerOf(M('verify:done').lens);
  const hover = centerOf(M('hover').box);
  const notify = centerOf(M('verify:done').notification);
  const all = { x: footage.viewport.width / 2, y: footage.viewport.height / 2 };
  return [
    { from: M('profile:done').t - 0.5, to: M('profile:done').t + 2.9, beats: 8, cam: [[0, 1, all], [3.5, 2.1, { x: lens.x + 60, y: lens.y + 30 }]] },
    { from: mice[0].t, to: mice[0].t + 3.6, beats: 6, cam: [[0, 1.5, hover]] },
    { from: M('edit:type').t, to: M('edit:saved').t, beats: 6, cam: [[0, 2.2, { x: lens.x + 90, y: lens.y + 50 }]] },
    { from: M('verify:shown').t - 0.3, to: M('verify:shown').t + 3.4, beats: 8, cam: [[0, 1.9, notify], [4.5, 1, all]] },
  ];
})();
const FootageWindow = ({ width, start }) => {
  const { f, fps } = useT();
  const W = width;
  const H = Math.round((W * footage.viewport.height) / footage.viewport.width);
  const K = W / footage.viewport.width;
  let at = start;
  const segs = VS_SEGMENTS.map(s => {
    const frames = beats(s.beats);
    const seg = { ...s, start: at, frames, rate: (s.to - s.from) / (frames / fps) };
    at += frames;
    return seg;
  });
  const keys = segs.flatMap(s => s.cam.map(([b, z, p]) => ({ frame: s.start + Math.round(b * BEAT), z, x: p.x, y: p.y })));
  let cam = { z: 1, x: footage.viewport.width / 2, y: footage.viewport.height / 2 };
  for (const k of keys) {
    if (f < k.frame) break;
    const p = spring({ frame: f - k.frame, fps, config: { damping: 26, stiffness: 150, mass: 0.8 } });
    cam = { z: Math.exp(Math.log(cam.z) + (Math.log(k.z) - Math.log(cam.z)) * p), x: cam.x + (k.x - cam.x) * p, y: cam.y + (k.y - cam.y) * p };
  }
  // zoom inside the window, keeping it filled
  const tx = Math.min(0, Math.max(W - cam.z * W, W / 2 - cam.z * cam.x * K));
  const ty = Math.min(0, Math.max(H - cam.z * H, H / 2 - cam.z * cam.y * K));
  const video = staticFile('footage/vscode.mp4');
  return (
    <div style={{ width: W, height: H, borderRadius: 16, overflow: 'hidden', position: 'relative', background: '#1e1e1e', boxShadow: '0 60px 160px rgba(0,0,0,0.75), 0 0 140px rgba(54,150,255,0.22), 0 0 0 1px rgba(255,255,255,0.14)' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${cam.z})` }}>
        {f < segs[0].start && (
          <Freeze frame={Math.round(segs[0].from * 60)}>
            <OffthreadVideo src={video} muted style={{ width: '100%', height: '100%' }} />
          </Freeze>
        )}
        {segs.map((s, i) => (
          <Sequence key={i} from={s.start} durationInFrames={s.frames + (i < segs.length - 1 ? 8 : 400)} layout="none">
            <AbsoluteFill style={{ opacity: i ? interpolate(f - s.start, [0, 8], [0, 1], CLAMP) : 1 }}>
              <OffthreadVideo src={video} trimBefore={Math.round(s.from * 60)} playbackRate={s.rate} muted style={{ width: '100%', height: '100%' }} />
            </AbsoluteFill>
          </Sequence>
        ))}
        {[0, 1, 2].map(i => (
          <span key={i} style={{ position: 'absolute', top: 11 * K, left: (14 + i * 20) * K, width: 12 * K, height: 12 * K, borderRadius: '50%', background: ['#ff5f57', '#febc2e', '#28c840'][i] }} />
        ))}
      </div>
    </div>
  );
};
export const VsCodeScene = ({ len }) => {
  const { f, fps } = useT();
  const o = BAR;
  const enter = spring({ frame: f - o, fps, config: { damping: 18, stiffness: 110 } });
  const t = f / 60;
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={BAR + 10} layout="none">
        <ChapterCard n="03" title="VS Code extension" line="Findings at the exact line." until={BAR - 10} />
      </Sequence>
      {f >= o - 6 && (
        <AbsoluteFill style={{ padding: '200px 0 0 760px' }}>
          <div style={{ opacity: Math.min(1, enter * 1.5) * fade(f, len, 1, 10), transform: `perspective(2600px) translateZ(${-(1 - enter) * 1000}px) rotateY(${-10 + (1 - enter) * -30 + Math.sin(t * 0.6) * 1.2}deg) rotateX(4deg)`, transformOrigin: '100% 50%' }}>
            <FootageWindow width={1080} start={o} />
          </div>
        </AbsoluteFill>
      )}
      <Sequence from={o} layout="none">
        <ChapterTag n="03" title="VS Code extension" until={len - o - 8} />
        <SideText
          at={6}
          until={len - o - 8}
          top={270}
          title="In your editor"
          body="Problems at the right line, render counts above your components, and Verify against baseline."
          you="No context switch. It all happens where you code."
          users="Slow components are caught as you write them."
        />
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- one npm package
const NpmWorld = () => {
  const { f, fps, sp } = useT();
  const sim = simulate(
    'npm-box',
    (world, Cn) => {
      ground(world, Cn);
      const b = new Cn.Body({ mass: 3, shape: new Cn.Box(new Cn.Vec3(1.1, 1.1, 1.1)), position: new Cn.Vec3(0, 6.5, 0), angularDamping: 0.35 });
      b.quaternion.setFromEuler(0.04, 0.5, 0.03);
      b.angularVelocity.set(0, 2.6, 0);
      world.addBody(b);
      return [b];
    },
    Math.round(10 * fps),
    { fps, substeps: 6 },
  );
  const [box] = sim(f);
  return (
    <>
      <group position={box.p} quaternion={box.q}>
        <mesh geometry={rounded(2.2, 2.2, 2.2, 0.16)} material={glossy('#1f5fe0')} castShadow receiveShadow />
        {[0, 1, 2, 3].map(k => (
          <group key={k} rotation={[0, (k * Math.PI) / 2, 0]}>
            <Label position={[0, 0.1, 1.11]} width={2} height={1.2} lines={[{ text: '@progen-labs/', size: 0.2, weight: 700, color: '#d8e6ff', font: 'mono' }, { text: 'spectra', size: 0.38, weight: 700, color: '#ffffff', font: 'display' }, { text: 'MIT · free', size: 0.16, weight: 600, color: '#bcd6ff', font: 'mono' }]} />
          </group>
        ))}
      </group>
      {['CLI', 'Dashboard', 'MCP server', 'VS Code', 'GitHub Action'].map((name, i) => {
        const pop = sp(BAR * 1.5 + i * 5, { damping: 12, stiffness: 110, mass: 0.7 });
        const a = Math.PI * (0.08 + (i / 4) * 0.84);
        const to = [Math.cos(a) * -3.9, 1.5 + Math.sin(a) * 1.5, -0.4];
        return pop > 0.01 ? <Chip key={name} text={name} position={[to[0] * pop, 1.1 + (to[1] - 1.1) * pop, to[2]]} scale={pop} w={2.3} h={0.6} d={0.24} size={0.24} color={PAL.violet} /> : null;
      })}
    </>
  );
};
export const NpmScene = ({ len }) => {
  const { f } = useT();
  return (
    <AbsoluteFill style={{ opacity: fade(f, len, 8, 8) }}>
      <Stage3D camera={[0, 3.2, 11]} target={[0, 1.9, 0]}>
        <Floor />
        <NpmWorld />
      </Stage3D>
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 70, textAlign: 'center' }}>
        <Slam at={6} until={len - 8} size={94}>
          It all runs on <Grad>one free package.</Grad>
        </Slam>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 80 }}>
        <Reveal at={BAR * 2} until={len - 8} kind="depth">
          <div style={{ padding: '22px 40px', borderRadius: 20, background: 'linear-gradient(180deg, rgba(20,26,48,0.95), rgba(8,11,22,0.95))', border: '1px solid rgba(54,214,255,0.4)', boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 50px rgba(54,214,255,0.15)', font: `500 38px ${fonts.mono}`, color: '#fff' }}>
            <span style={{ color: C.cyan }}>$ </span>npm install --save-dev @progen-labs/spectra
          </div>
        </Reveal>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 04 the CLI
export const CliScene = ({ len }) => {
  const { f, fps } = useT();
  const each = beats(CLI_FEATURE_BEATS);
  const scale = 1.5;
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={BAR + 10} layout="none">
        <ChapterCard n="04" title="The CLI" line="Every feature, one command away." until={BAR - 10} />
      </Sequence>
      <Sequence from={BAR} layout="none">
        <ChapterTag n="04" title="The CLI" until={len - BAR - 8} />
      </Sequence>
      {CLI_FEATURES.map((x, i) => {
        const from = BAR + i * each;
        return (
          <Sequence key={x.scene} from={from - 6} durationInFrames={each + 12} layout="none">
            <SceneTime.Provider value={{ scale, total: ((each + 12) / fps) * scale, shift: x.shift ?? 410, dist: 1.25 }}>
              <AbsoluteFill style={{ opacity: fade(f - from + 6, each + 12, 10, 10) }}>{React.createElement(FEATURE_SCENES[x.scene], { loop: false, fps })}</AbsoluteFill>
            </SceneTime.Provider>
            <SideText at={8} until={each} top={250} title={x.title} body={x.body} you={x.you} users={x.users} />
            <AbsoluteFill style={{ alignItems: 'flex-end', justifyContent: 'flex-start', padding: '52px 92px 0 0' }}>
              <Reveal at={6} until={each} kind="up" dist={10}>
                <span style={{ font: `600 22px ${fonts.mono}`, color: C.faint, letterSpacing: '0.14em' }}>
                  {String(i + 1).padStart(2, '0')} / {CLI_FEATURES.length}
                </span>
              </Reveal>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 05 the AI fix harness
export const HarnessScene = ({ len }) => {
  const { f, fps } = useT();
  const o = BAR;
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={BAR + 10} layout="none">
        <ChapterCard n="05" title="AI fix harness" line="Hands-off fixes, proven." until={BAR - 10} />
      </Sequence>
      <Sequence from={o - 8} layout="none">
        <SceneTime.Provider value={{ scale: 1, total: (len - o + 8) / fps, shift: 290, dist: 1.5 }}>
          <AbsoluteFill style={{ opacity: fade(f - o + 8, len - o + 8, 10, 8) }}>{React.createElement(FEATURE_SCENES.fix, { loop: false, fps })}</AbsoluteFill>
        </SceneTime.Provider>
      </Sequence>
      <Sequence from={o} layout="none">
        <ChapterTag n="05" title="AI fix harness" until={len - o - 8} />
        <SideText
          at={4}
          until={len - o - 8}
          top={240}
          title="spectra fix"
          body="An AI agent fixes the costliest findings in a copy of your code. A change is kept only if your checks pass and it measures faster."
          you="Review a branch of proven fixes."
          users="Real speed-ups, never a broken page."
        />
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- frameworks
const FrameworkWorld = () => {
  const { sp } = useT();
  return FRAMEWORKS.map((fw, i) => {
    const drop = sp(10 + i * 7, { damping: 9, stiffness: 120, mass: 0.8 });
    const back = i < 3;
    const x = ((i % 3) - 1) * 3.2;
    const z = back ? -0.8 : 1.0;
    const y = (back ? 2.35 : 0.75) + (1 - drop) * 6;
    return (
      <group key={fw.name} position={[x, y, z]} rotation={[-0.12, 0, 0]}>
        <Tile w={2.9} h={1.3} d={0.32} color={fw.deep ? '#182a5a' : '#202842'} emissive={fw.deep ? '#2b6cff' : undefined} emissiveIntensity={fw.deep ? 0.12 : 0} lines={[{ text: fw.name, size: 0.42, weight: 700, color: fw.color, font: 'display' }, { text: fw.deep ? 'components · deep' : 'files & lines', size: 0.18, weight: 600, color: fw.deep ? '#9fd8ff' : '#9aa6c8', font: 'mono' }]} />
      </group>
    );
  });
};
export const FrameworksScene = ({ len }) => {
  const { f } = useT();
  return (
    <AbsoluteFill style={{ opacity: fade(f, len, 8, 8) }}>
      <Stage3D camera={[Math.sin(f / 200) * 1.5, 3.6, 12]} target={[0, 1.4, 0]}>
        <Floor />
        <FrameworkWorld />
      </Stage3D>
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 70, textAlign: 'center' }}>
        <Slam at={4} until={len - 8} size={100}>
          Works with <Grad>your stack.</Grad>
        </Slam>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 70, textAlign: 'center' }}>
        <Reveal at={BAR * 1.2} until={len - 8} kind="up">
          <div style={{ font: `500 32px ${fonts.ui}`, color: C.dim, maxWidth: 1500, lineHeight: 1.4 }}>
            Component-level detail for <b style={{ color: '#fff' }}>React, Next.js, Vue and Angular</b>. File-and-line detail for Svelte and any other build.
          </div>
        </Reveal>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- open source
const OpenWorld = () => {
  const { f, sp } = useT();
  return (
    <>
      <Mark3D position={[0, 2.2, 0]} rotation={[0.1, Math.sin(f / 70) * 0.5, 0]} scale={1.05} />
      <Ring radius={3.4} y={0.03} />
      {SURFACES.map((s, i) => {
        const a = -1.15 + (i / (SURFACES.length - 1)) * 2.3;
        const pop = sp(14 + i * 6, { damping: 12, stiffness: 120 });
        return (
          <group key={s.name} position={[Math.sin(a) * 4.4, 0.7 + (i % 2) * 0.55 + Math.sin(f / 40 + i) * 0.06, Math.cos(a) * 2.4 - 0.2]} rotation={[0, -a * 0.35, 0]} scale={pop}>
            <Tile w={2.75} h={0.95} d={0.26} color={PAL.slate2} lines={[{ text: s.name, size: 0.27, weight: 700, color: '#ffffff' }, { text: s.cmd, size: 0.14, weight: 500, color: '#9fd8ff', font: 'mono' }]} />
          </group>
        );
      })}
    </>
  );
};
export const OpenSourceScene = ({ len }) => {
  const { f } = useT();
  return (
    <AbsoluteFill style={{ opacity: fade(f, len, 8, 6) }}>
      <Stage3D camera={[0, 3.4, 12.5]} target={[0, 1.6, 0]}>
        <Floor />
        <OpenWorld />
      </Stage3D>
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 64, textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 26 }}>
          <Slam at={4} until={len - 6} size={104}>
            Free.
          </Slam>
          <Slam at={4 + beats(1)} until={len - 6} size={104}>
            <Grad>Open source.</Grad>
          </Slam>
          <Slam at={4 + beats(2)} until={len - 6} size={104}>
            MIT.
          </Slam>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(6,9,18,0.9) 0%, rgba(6,9,18,0.6) 16%, transparent 32%)' }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 66, textAlign: 'center' }}>
        <Reveal at={BAR * 1.5} until={len - 6} kind="up">
          <div style={{ font: `600 34px ${fonts.ui}`, color: '#fff' }}>No account. No paid tier. Runs on your machine.</div>
        </Reveal>
        <Reveal at={BAR * 2.2} until={len - 6} kind="up" style={{ marginTop: 10 }}>
          <div style={{ font: `500 28px ${fonts.ui}`, color: C.dim }}>Built in the open by Progen Labs, a nonprofit. Free today, free forever.</div>
        </Reveal>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- the end card
export const EndScene = ({ len }) => {
  const { f, sp } = useT();
  const land = sp(0, { damping: 12, stiffness: 110, mass: 0.8 });
  return (
    <AbsoluteFill>
      <Stage3D camera={[0, 2.6, interpolate(f, [0, len], [9.5, 8.6])]} target={[0, 2.35, 0]}>
        <Floor />
        <Mark3D position={[0, 3.05, 0]} rotation={[0.1, (1 - land) * 3 - 0.3 + Math.sin(f / 60) * 0.12, 0]} scale={0.5 + 0.5 * land} draw={interpolate(f, [8, 40], [0, 1], CLAMP)} />
        {PARTS.map((p, i) => {
          const burst = interpolate(f, [0, 70], [0, 1], { ...CLAMP, easing: t => 1 - Math.pow(1 - t, 3) });
          const pos = [p.to[0] * 0.3 + (p.from[0] - p.to[0] * 0.3) * burst, 3 + (p.from[1] - 3) * burst, p.from[2] * burst];
          return burst < 0.995 ? <Orb key={i} position={pos} r={0.035} color={p.color} intensity={3.5 * (1 - burst)} /> : null;
        })}
      </Stage3D>
      <Flash at={0} strength={0.55} />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 610, textAlign: 'center' }}>
        <Reveal at={10} kind="flip">
          <div style={{ font: `700 140px ${fonts.display}`, letterSpacing: '-0.05em', lineHeight: 1, ...GRAD_TEXT }}>Spectra</div>
        </Reveal>
        <Reveal at={20} style={{ marginTop: 14 }}>
          <div style={{ font: `600 42px ${fonts.ui}`, color: '#fff' }}>Find it. Fix it. Prove it.</div>
        </Reveal>
        <div style={{ display: 'flex', gap: 22, marginTop: 40 }}>
          {['npm i -D @progen-labs/spectra', 'github.com/progen-labs/spectra'].map((line, i) => (
            <Reveal key={line} at={30 + i * 5} kind="flip">
              <div style={{ padding: '16px 26px', borderRadius: 16, background: 'rgba(12,16,32,0.9)', border: '1px solid rgba(54,214,255,0.35)', font: `500 28px ${fonts.mono}`, color: '#fff' }}>{line}</div>
            </Reveal>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
