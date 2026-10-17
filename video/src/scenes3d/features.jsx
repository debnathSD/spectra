// The twelve feature scenes, in 3D. Each is resolution-independent and timed
// in seconds: the website's feature loops play them on their own (loop: true
// assembles the scene and takes it apart, so the clip loops seamlessly) and
// the launch film plays them inside its chapters. Every number is real
// Spectra output (src/data).
import React, { useContext } from 'react';
import { interpolate } from 'remotion';
import * as THREE from 'three';
import { COMPARE, COMPONENTS, ONE_COMMAND, PR_REPORT, RESULT_JSON, SAFE } from '../data/launch.js';
import { Beam, Tile } from '../three/Brand3D.jsx';
import { Label } from '../three/Label.jsx';
import { useTextures } from '../three/assets.js';
import { ground, simulate } from '../three/physics.js';
import { Floor, Stage3D, glass, glossy, rounded } from '../three/Stage3D.jsx';
import { CLAMP, Chip, Column, Orb, PAL, Panel3D, Ring, SceneTime, useClock, useEnvelope } from './kit.jsx';

const mono = (text, color = '#dfe7ff', size = 0.15, extra) => ({ text, size, font: 'mono', weight: 500, color, ...extra });
const ui = (text, color = '#ffffff', size = 0.2, extra) => ({ text, size, font: 'ui', weight: 700, color, ...extra });

/** The stage for one scene: a slow orbit of the camera, the floor, and the assemble envelope. */
const Shell = ({ loop, cam = [0, 3.3, 9], target = [0, 1.1, 0], sway = 0.16, children, fov = 32 }) => {
  const { s, total } = useClock();
  const ctx = useContext(SceneTime);
  const shift = ctx?.shift ?? 0;
  const dist = ctx?.dist ?? 1;
  const env = useEnvelope(loop);
  const yaw = loop ? Math.sin((s / total) * Math.PI * 2) * sway : sway * Math.sin(s * 0.35);
  const r = Math.hypot(cam[0], cam[2]) * dist;
  const a = Math.atan2(cam[0], cam[2]) + yaw;
  return (
    <Stage3D camera={[Math.sin(a) * r, target[1] + (cam[1] - target[1]) * dist, Math.cos(a) * r]} target={target} fov={fov} shift={shift}>
      <Floor />
      <group scale={[1, Math.max(0.0001, env), 1]} position={[0, 0, 0]}>
        <group scale={0.6 + 0.4 * env}>{children}</group>
      </group>
    </Stage3D>
  );
};

// 1 — One command: the command is typed, the dev server starts, three journeys stack up
const ONE_LINES = [
  'starting the react/vite dev server …',
  'dev server ready — profiling …',
  '3 actionable elements → 3 golden paths',
  '[1/3] Click "Long task"',
  '[2/3] Click "Layout thrash"',
  '[3/3] Click "Layout shift"',
];
const JOURNEY_NAMES = ['Long task', 'Layout thrash', 'Layout shift'];
export const OneCommand = ({ loop, fps = 30 }) => {
  const { s, f, sp } = useClock();
  const typed = ONE_COMMAND.command.slice(0, Math.max(0, Math.floor((s - 0.25) * 30)));
  const shown = Math.max(0, Math.min(ONE_LINES.length, Math.floor((s - 1.2) / 0.38)));
  const done = s > 1.2 + ONE_LINES.length * 0.38 + 0.3;
  const sim = simulate(
    'one-command-stack',
    (world, C) => {
      ground(world, C);
      return JOURNEY_NAMES.map((_, i) => {
        const b = new C.Body({ type: C.Body.STATIC, shape: new C.Box(new C.Vec3(0.95, 0.2, 0.42)), position: new C.Vec3(1.95 + (i - 1) * 0.12, 3.4 + i * 0.5, 1.0) });
        b.quaternion.setFromEuler(0.12 * (i - 1), 0.35 + i * 0.2, 0.08 * (1 - i));
        b.dropAt = Math.round((1.2 + (3 + i) * 0.38) * fps);
        b.dropMass = 1;
        world.addBody(b);
        return b;
      });
    },
    Math.round(12 * fps),
    { fps },
  );
  const bodies = sim(f);
  return (
    <Shell loop={loop} target={[0.3, 1.35, 0]}>
      <Panel3D
        w={4.6}
        h={2.6}
        position={[-1.05, 1.5, 0]}
        rotation={[0, 0.16, 0]}
        lines={[
          mono(`$ ${typed}${typed.length < ONE_COMMAND.command.length && f % 16 < 8 ? '▍' : ''}`, '#36d6ff', 0.25),
          mono(' ', '#000', 0.08),
          ...ONE_LINES.slice(Math.max(0, shown - 3), shown).map(l => mono(l, '#aeb9d6', 0.17)),
          ...(done ? [mono('✓ 3/3 golden paths passed', '#46e2a0', 0.2)] : []),
        ]}
      />
      {/* the dev server: a small tower with a light that turns green */}
      <group position={[2.65, 0, -1.7]}>
        <mesh position={[0, 0.7, 0]} geometry={rounded(1.1, 1.4, 0.9, 0.1)} material={glossy(PAL.slate2)} castShadow receiveShadow />
        <Orb position={[0, 1.15, 0.47]} r={0.1} color={s > 1.58 ? '#46e2a0' : '#ffb020'} />
        <Label position={[0, 0.55, 0.46]} width={1} height={0.5} lines={[ui('dev', '#c6d3f5', 0.16), ui('server', '#c6d3f5', 0.16)]} />
      </group>
      {bodies.map((b, i) => (
        <Chip key={i} text={JOURNEY_NAMES[i]} w={1.9} h={0.4} d={0.84} size={0.2} color={PAL.violet} position={b.p} quaternion={b.q} />
      ))}

    </Shell>
  );
};

// 2 — Real user journeys: a light runs the golden paths, and each one passes
const NODES = [
  { name: 'Page load', p: [-3.1, 0, 0.9] },
  { name: 'Long task', p: [-1.05, 0, -0.55] },
  { name: 'Layout thrash', p: [1.05, 0, 0.75] },
  { name: 'Layout shift', p: [3.1, 0, -0.6] },
];
const PATH = new THREE.CatmullRomCurve3(NODES.map(n => new THREE.Vector3(n.p[0], 0.06, n.p[2])), false, 'centripetal');
const PATH_GEO = new THREE.TubeGeometry(PATH, 240, 0.045, 10, false);
export const Journeys = ({ loop }) => {
  const { s, sp } = useClock();
  const run = interpolate(s, [0.7, 4.3], [0, 1], CLAMP);
  const at = PATH.getPointAt(Math.min(0.999, run));
  PATH_GEO.setDrawRange(0, Math.floor((PATH_GEO.index.count * interpolate(s, [0.35, 1.0], [0, 1], CLAMP)) / 6) * 6);
  return (
    <Shell loop={loop} cam={[0, 4.4, 9.4]} target={[0, 0.6, 0]}>
      <mesh geometry={PATH_GEO}>
        <meshStandardMaterial color={PAL.cyan} emissive={PAL.cyan} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      {NODES.map((n, i) => {
        const pass = run >= i / 3 - 0.001 && s > 0.7;
        const pop = pass ? sp(0.7 + (i / 3) * 3.6) : 0;
        return (
          <group key={n.name} position={n.p}>
            <mesh position={[0, 0.05, 0]} geometry={rounded(1.5, 0.1, 1.1, 0.04)} material={glossy(pass ? '#14503c' : PAL.slate2, pass ? '#22c98a' : '#000000', pass ? 0.25 : 0)} receiveShadow castShadow />
            <Chip text={n.name} position={[0, 0.66, 0]} w={1.85} h={0.56} d={0.2} size={0.21} color={PAL.slate} />
            {pop > 0.01 && <Chip text="✓ PASS" position={[0, 1.42, 0]} scale={pop} w={1.3} h={0.44} d={0.16} size={0.2} color="#16a874" />}
          </group>
        );
      })}
      {s > 0.65 && s < 4.6 && <Orb position={[at.x, 0.2, at.z]} r={0.16} color="#ffffff" intensity={4} />}
      {s > 4.4 && <Label position={[0, 2.35, -1]} width={6} height={0.6} lines={[ui('3/3 golden paths passed', '#46e2a0', 0.38)]} opacity={interpolate(s, [4.4, 4.8], [0, 1], CLAMP)} />}
    </Shell>
  );
};

// 3 — The exact culprit: the call tree in 3D, and the one block that matters lifts out
const BLOCKS = [
  { name: 'main.jsx', x: 0, w: 6.2, level: 0, color: '#28407e' },
  { name: 'App · src/main.jsx:15', x: 0, w: 5.6, level: 1, color: '#33509a' },
  { name: 'Row · src/Row.jsx:3', x: -0.4, w: 4.6, level: 2, culprit: true },
  { name: 'Panel', x: 2.55, w: 0.7, level: 2, color: '#3e5fb0' },
  { name: 'burn · src/heavy.js:2', x: -0.45, w: 4.3, level: 3, color: '#5a4bd0' },
];
export const Culprit = ({ loop }) => {
  const { s, sp } = useClock();
  const lift = sp(2.1, { damping: 12, stiffness: 120, mass: 0.8 });
  const pulse = 0.35 + 0.25 * Math.sin(s * 6);
  return (
    <Shell loop={loop} cam={[0, 3.2, 10]} target={[0, 1.5, 0]}>
      {BLOCKS.map((b, i) => {
        const drop = sp(0.2 + i * 0.16, { damping: 11, stiffness: 150, mass: 0.7 });
        const y = 0.25 + b.level * 0.52 + (1 - drop) * 4;
        const z = b.culprit ? lift * 1.1 : 0;
        const color = b.culprit ? '#e8455f' : b.color;
        return (
          <group key={b.name} position={[b.x, y + (b.culprit ? lift * 0.25 : 0), z]}>
            <mesh geometry={rounded(b.w, 0.46, 0.9, 0.07)} material={b.culprit ? glossy(color, color, s > 2.1 ? pulse : 0.15) : glossy(color)} castShadow receiveShadow />
            {b.w > 1 && <Label position={[0, 0, 0.456]} width={b.w - 0.1} height={0.42} lines={[mono(b.name, '#ffffff', 0.2, { weight: 600 })]} />}
          </group>
        );
      })}
      {lift > 0.02 && (
        <Chip text="1.44 s · seen in 3/3 runs" position={[-0.4, 2.5 + lift * 0.5, 1.1]} scale={lift} w={3.6} h={0.56} d={0.2} size={0.23} color="#2a0f1a" textColor="#ff9fb2" />
      )}
    </Shell>
  );
};

// 4 — Component insight: render counts per component; Row towers, Wasted is flagged
export const Components = ({ loop }) => {
  const { sp } = useClock();
  const H = { Row: 3.1, App: 0.34, Panel: 0.2, Wasted: 0.2 };
  return (
    <Shell loop={loop} cam={[0, 3, 9.6]} target={[0, 1.35, 0]}>
      {COMPONENTS.map((c, i) => {
        const g = sp(0.3 + i * 0.15, { damping: 11, stiffness: 110, mass: 0.8 });
        const x = (i - 1.5) * 1.75;
        const row = c.name === 'Row';
        const wasted = c.wasted > 0;
        return (
          <Column
            key={c.name}
            x={x}
            height={H[c.name] * g}
            color={row ? '#e8455f' : wasted ? '#e09a1c' : PAL.blue}
            glowing={row}
            label={c.name}
            value={g > 0.6 ? (wasted ? `${c.wasted} wasted` : `${c.renders.toLocaleString('en-US')} renders`) : null}
            valueColor={row ? '#ffb3c1' : wasted ? '#ffd27a' : '#c6d3f5'}
          />
        );
      })}
      {sp(1.6) > 0.02 && <Chip text="Row · 1.44 s rendering" position={[0.2, 3.35, -0.6]} scale={sp(1.6)} w={3.4} h={0.54} d={0.18} size={0.23} color="#2a0f1a" textColor="#ff9fb2" />}
    </Shell>
  );
};

// 5 — Proof, not guesses: the after column drops below the noise band, with the verdict
export const Proof = ({ loop }) => {
  const { sp, s } = useClock();
  const grow = sp(0.2, { damping: 14, stiffness: 120 });
  const drop = sp(1.5, { damping: 7, stiffness: 90, mass: 0.9 });
  const before = 3.0 * grow;
  const after = before - (before - 0.19) * drop;
  const line = COMPARE.lines[0];
  return (
    <Shell loop={loop} cam={[0, 2.9, 9.6]} target={[0, 1.45, 0]}>
      <Column x={-1.3} w={1.2} height={before} color="#5a6a95" label="Before" value={grow > 0.6 ? line.before : null} valueColor="#c6d3f5" />
      <Column x={1.3} w={1.2} height={after} color={PAL.green} glowing={drop > 0.5} label="After" value={drop > 0.85 ? line.after : null} valueColor="#8ff0c4" />
      {/* the run-to-run noise band: changes inside it don't count */}
      <mesh position={[0, 3.0 * grow, 0]} geometry={rounded(4.4, 0.16 * grow + 0.001, 1.3, 0.05)} material={glass('#9fd8ff')} />
      {drop > 0.85 && (
        <>
          <Chip text={`✓ ${COMPARE.verdict} ${line.delta}`} position={[1.3, 1.75, 0.5]} scale={sp(2.4)} w={2.9} h={0.6} d={0.2} size={0.25} color="#14684a" />
          <Label position={[0, 3.55 * grow, 0]} width={5} height={0.45} lines={[ui('run-to-run noise', '#9fd8ff', 0.21)]} opacity={interpolate(s, [2.4, 2.8], [0, 1], CLAMP)} />
        </>
      )}
    </Shell>
  );
};

// 6 — Budgets that hold: columns against glass limits; two break through and fail the build
export const Budgets = ({ loop }) => {
  const { sp, s } = useClock();
  const CHECKS = [
    { label: 'TBT', fill: 0.05, ok: true, value: '0 ms / 200' },
    { label: 'Scripting', fill: 2.4, ok: false, value: '1.46 s / 500 ms' },
    { label: 'Critical', fill: 1.55, ok: false, value: '3 / 0' },
  ];
  const LIMIT = 1.25;
  return (
    <Shell loop={loop} cam={[0, 3.1, 9.8]} target={[0, 1.5, 0]}>
      {CHECKS.map((c, i) => {
        const g = sp(0.3 + i * 0.25, { damping: 12, stiffness: 90, mass: 0.9 });
        const h = LIMIT * c.fill * g;
        const over = h > LIMIT;
        const x = (i - 1) * 2.2;
        const shake = over && !c.ok ? Math.sin(s * 40) * 0.03 * Math.max(0, 1 - (s - 1.3)) : 0;
        return (
          <group key={c.label} position={[x + shake, 0, 0]}>
            <Column w={1.05} height={h} color={c.ok ? PAL.green : over ? '#e8455f' : PAL.blue} glowing={over} label={c.label} value={g > 0.8 ? c.value : null} valueColor={c.ok ? '#8ff0c4' : '#ffb3c1'} />
            <mesh position={[0, LIMIT, 0]} geometry={rounded(1.7, 0.05, 1.7, 0.02)} material={glass(c.ok ? '#bff5dd' : '#ffc2cd')} />
          </group>
        );
      })}
      {s > 2.3 && <Chip text="✗ budget exceeded · exit code 2" position={[0, 3.95, -1.2]} scale={sp(2.3)} w={4.6} h={0.6} d={0.2} size={0.25} color="#3a1220" textColor="#ff9fb2" />}
    </Shell>
  );
};

// 7 — Pull request checks: the check turns green and the report fills in
export const PullRequests = ({ loop }) => {
  const { s, sp } = useClock();
  const rows = Math.max(0, Math.min(3, Math.floor((s - 1.9) / 0.4) + 1));
  const ok = s > 1.6;
  const pend = Math.max(0, 1 - sp(1.6));
  return (
    <Shell loop={loop} cam={[0, 2.6, 9.6]} target={[0, 1.55, 0]}>
      <Panel3D
        w={5.4}
        h={2.7}
        position={[0.45, 1.65, 0]}
        rotation={[0, -0.12, 0]}
        lines={[
          ui(ok ? 'Spectra: ✅ Improved' : 'Spectra: running …', ok ? '#ffffff' : '#c6d3f5', 0.3),
          mono(' ', '#000', 0.08),
          ...PR_REPORT.rows.slice(0, ok ? rows : 0).map(([m, a, b]) => mono(`${m.replace('Largest contentful paint', 'LCP').replace('Total blocking time', 'Blocking time').padEnd(15)} ${a.padStart(6)} → ${b}`, '#8ff0c4', 0.2)),
        ]}
      />
      <group position={[-3.05, 2.85, 0.4]}>
        <mesh rotation={[0, 0, s * 4 * pend]}>
          <torusGeometry args={[0.36, 0.06, 16, 64, Math.PI * (2 - 1.4 * pend)]} />
          <meshStandardMaterial color={ok ? '#22c98a' : '#ffb020'} emissive={ok ? '#22c98a' : '#ffb020'} emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
        {ok && <Label position={[0, 0, 0.05]} width={0.6} height={0.6} lines={[ui('✓', '#46e2a0', 0.44)]} opacity={sp(1.6)} />}
      </group>
      <Chip text="#42 · Speed up the product list" position={[0.3, 3.55, 0]} w={4.2} h={0.42} d={0.14} size={0.16} color={PAL.slate2} textColor="#c6d3f5" rotation={[0, -0.12, 0]} />
    </Shell>
  );
};

// 8 — AI that verifies: measure → change → verify → keep, around a loop of light
const STEPS = ['Measure', 'Change', 'Verify', 'Keep or revert'];
export const AiVerify = ({ loop }) => {
  const { s, total } = useClock();
  const R = 2.3;
  const angle = -Math.PI / 2 + (s / total) * Math.PI * 2 * (loop ? 1 : 0.9);
  const orb = [Math.cos(angle) * R, 0.35, Math.sin(angle) * R];
  return (
    <Shell loop={loop} cam={[0, 4.2, 8.6]} target={[0, 0.5, 0]}>
      <Ring radius={R} />
      {STEPS.map((name, i) => {
        const a = -Math.PI / 2 + (i / 4) * Math.PI * 2;
        const near = Math.cos(angle - a) > 0.93;
        return (
          <group key={name} position={[Math.cos(a) * R, 0, Math.sin(a) * R]}>
            <Chip text={name} position={[0, 0.5, 0]} w={name.length > 8 ? 2.6 : 1.9} h={0.6} d={0.24} size={0.23} color={near ? (i === 3 ? '#16a874' : PAL.violet) : PAL.slate2} emissive={near ? '#ffffff' : undefined} emissiveIntensity={near ? 0.05 : 0} />
          </group>
        );
      })}
      <Orb position={orb} r={0.15} color="#ffffff" intensity={4} />
      <Chip text="✓ IMPROVED −93%" position={[0, 2.25, -0.4]} w={3.1} h={0.6} d={0.22} size={0.26} color="#14684a" scale={Math.max(0.0001, interpolate(Math.cos(angle - Math.PI / 2), [0.6, 1], [0, 1], CLAMP))} />
    </Shell>
  );
};

// 9 — In your editor: CodeLens and a squiggle at the exact line, and the hover with the fix
export const Editor = ({ loop }) => {
  const { s, sp } = useClock();
  const lens = s > 0.8;
  const squiggle = s > 1.2;
  const hover = sp(1.9, { damping: 14, stiffness: 130 });
  return (
    <Shell loop={loop} cam={[0, 2.4, 9.2]} target={[0.2, 1.6, 0]}>
      <Panel3D
        w={6}
        h={3.2}
        position={[-0.3, 1.75, 0]}
        rotation={[0, 0.14, 0]}
        color="#1a1d2b"
        lines={[
          mono(lens ? '   ⚡ Row · 7,200 renders · 1.44 s' : ' ', '#7fb4ff', 0.19),
          mono('3  export function Row({ index }) {', '#ffd479', 0.21, squiggle ? { wavy: [3, 35, '#ffb020'] } : undefined),
          mono('4    burn(0.15);', '#dcdcaa', 0.21),
          mono('5    return <div>Row {index}</div>;', '#9cdcfe', 0.21),
          mono('6  }', '#ffd479', 0.21),
        ]}
      />
      {hover > 0.02 && (
        <Panel3D
          w={4.9}
          h={1.25}
          d={0.12}
          position={[0.9, 0.75, 0.9 * hover]}
          rotation={[0, 0.08, 0]}
          scale={hover}
          color="#252a3d"
          lines={[mono('Row is slow to render: 1441ms', '#ffffff', 0.2), mono('Fix: move it into useMemo …', '#8ff0c4', 0.18)]}
        />
      )}
    </Shell>
  );
};

// 10 — Visual dashboard: the real dashboard screens, fanned out in 3D
const SHOTS = [
  { file: 'dashboard/dashboard-overview.webp', w: 1120, h: 760 },
  { file: 'dashboard/culprits-top.webp', w: 1084, h: 625 },
  { file: 'dashboard/tab-page-map.webp', w: 1094, h: 446 },
];
const Screen = ({ tex, w, h, position, rotation, scale = 1 }) => (
  <group position={position} rotation={rotation} scale={scale}>
    <mesh geometry={rounded(w + 0.12, h + 0.12, 0.1, 0.06)} material={glossy('#0e1428')} castShadow />
    <mesh position={[0, 0, 0.056]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  </group>
);
// one large screen, flipping in 3D from one real view to the next
const Screens = ({ loop }) => {
  const { s, total, fps } = useClock();
  const tex = useTextures(SHOTS.map(x => x.file));
  if (!tex) return null;
  const per = loop ? total / SHOTS.length : 2.2;
  const i = Math.floor(s / per) % SHOTS.length;
  const local = s - Math.floor(s / per) * per;
  // flip out over the last 0.35 s of each view, in over the first 0.35 s of the next
  const flipIn = interpolate(local, [0, 0.35], [-1, 0], CLAMP);
  const flipOut = interpolate(local, [per - 0.35, per], [0, 1], CLAMP);
  const angle = (flipIn + flipOut) * (Math.PI / 2);
  const x = SHOTS[i];
  const w = 6.4;
  const h = Math.min(3.9, (w * x.h) / x.w);
  void fps;
  return <Screen tex={tex[i]} w={(h * x.w) / x.h} h={h} position={[0, 1.95, 0]} rotation={[0.04, angle - 0.18, 0]} />;
};
export const Dashboard = ({ loop }) => (
  <Shell loop={loop} cam={[0, 2.1, 9.2]} target={[0, 1.9, 0]} sway={0.1}>
    <Screens loop={loop} />
  </Shell>
);

// 11 — JSON for any tool: one versioned result, picked up by CI, scripts and AI agents
const TARGETS = [
  { name: 'CI', p: [3.0, 2.6, -0.4] },
  { name: 'Scripts', p: [3.2, 1.55, 0.3] },
  { name: 'AI agents', p: [3.0, 0.55, 0.9] },
];
export const JsonOut = ({ loop }) => {
  const { s, sp } = useClock();
  return (
    <Shell loop={loop} cam={[0, 2.5, 9.6]} target={[0.4, 1.5, 0]}>
      <Panel3D w={3.6} h={3.05} position={[-1.7, 1.65, 0]} rotation={[0, 0.2, 0]} lines={RESULT_JSON.map(l => mono(l, l.includes('"') ? '#9df3cb' : '#dfe7ff', 0.135))} />
      {TARGETS.map((t, i) => {
        const pop = sp(0.4 + i * 0.15);
        return <Chip key={t.name} text={t.name} position={t.p} scale={pop} w={1.9} h={0.55} d={0.24} size={0.2} color={PAL.violet} rotation={[0, -0.25, 0]} />;
      })}
      {TARGETS.map((t, i) => {
        // packets of JSON flying from the result to each tool, over and over
        const cycle = ((s - 1 - i * 0.35) % 1.6 + 1.6) % 1.6;
        if (s < 1 + i * 0.35) return null;
        const p = Math.min(1, cycle / 1.1);
        const from = new THREE.Vector3(0.1, 1.7, 0.3);
        const to = new THREE.Vector3(t.p[0] - 1, t.p[1], t.p[2]);
        const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.9, 0.4));
        const pt = new THREE.QuadraticBezierCurve3(from, mid, to).getPoint(p);
        return p < 1 ? <Orb key={`o${i}`} position={pt.toArray()} r={0.1} color={PAL.cyan} /> : null;
      })}
      {TARGETS.map((t, i) => (
        <Beam key={`b${i}`} from={[0.1, 1.7, 0.3]} to={[t.p[0] - 1, t.p[1], t.p[2]]} radius={0.008} progress={interpolate(s, [0.6 + i * 0.15, 1.1 + i * 0.15], [0, 1], CLAMP)} color="#2a6fb8" />
      ))}
    </Shell>
  );
};

// 12 — Safe by default: destructive actions bounce off the shield, safe ones go through
const SHIELD_YAW = -0.75;
export const Safe = ({ loop, fps = 30 }) => {
  const { f, s } = useClock();
  const sim = simulate(
    'safe-shield',
    (world, C) => {
      ground(world, C);
      const shield = new C.Body({ type: C.Body.STATIC, shape: new C.Box(new C.Vec3(0.15, 1.6, 1.4)), position: new C.Vec3(0.6, 1.6, -0.6) });
      shield.quaternion.setFromEuler(0, SHIELD_YAW, 0);
      world.addBody(shield);
      const chips = SAFE.blocked.map((_, i) => {
        const b = new C.Body({ type: C.Body.STATIC, shape: new C.Box(new C.Vec3(0.75, 0.22, 0.3)), position: new C.Vec3(-3.3, 1.0 + i * 0.7, -0.6 + (i - 1) * 0.25) });
        b.dropAt = Math.round((0.5 + i * 0.55) * fps);
        b.dropMass = 1;
        b.onFrame = (frame, body) => {
          if (frame === body.dropAt) body.velocity.set(7, 1.5, 0);
        };
        world.addBody(b);
        return b;
      });
      return chips;
    },
    Math.round(12 * fps),
    { fps },
  );
  const bodies = sim(f);
  return (
    <Shell loop={loop} cam={[0, 3.2, 9.6]} target={[0, 1.2, 0]}>
      {/* the shield, angled to face the camera */}
      <group position={[0.6, 1.6, -0.6]} rotation={[0, SHIELD_YAW, 0]}>
        <mesh geometry={rounded(0.3, 3.2, 2.8, 0.12)} material={glass('#9fd8ff')} />
        <mesh>
          <boxGeometry args={[0.04, 3.24, 2.84]} />
          <meshStandardMaterial color={PAL.cyan} emissive={PAL.cyan} emissiveIntensity={0.5 + 0.6 * Math.max(0, Math.sin(s * 3))} transparent opacity={0.22} toneMapped={false} />
        </mesh>
        <Label position={[0.17, 0.2, 0]} rotation={[0, Math.PI / 2, 0]} width={2.6} height={1.2} lines={[ui('🛡', '#9fd8ff', 0.45), ui('safe mode', '#9fd8ff', 0.3)]} />
      </group>
      {bodies.map((b, i) => (
        <Chip key={i} text={`✗ ${SAFE.blocked[i]}`} position={b.p} quaternion={b.q} w={1.5} h={0.44} d={0.6} size={0.22} color="#7a1e33" textColor="#ffd0d9" />
      ))}
      {/* safe actions go on in a lane in front of the shield */}
      {SAFE.allowed.map((name, i) => {
        const t0 = 0.8 + i * 0.7;
        const x = interpolate(s, [t0, t0 + 2.4], [-4.4, 4.6], CLAMP);
        if (s < t0) return null;
        return <Chip key={name} text={`✓ ${name}`} position={[x, 0.32, 1.6]} w={2.2} h={0.5} d={0.5} size={0.21} color="#14684a" />;
      })}
    </Shell>
  );
};

// 13 — The AI fix harness: an agent's changes ride through your checks and
// Spectra's measurement; only a proven fix reaches "kept" (the test bench's cases)
const GATES = [
  { x: -2.6, label: 'Agent', color: PAL.violet },
  { x: -0.2, label: 'Your checks', color: PAL.cyan },
  { x: 2.2, label: 'Measure', color: PAL.blue },
];
const SPEED = 2.9;
const CHANGES = [
  { text: 'return null', at: 0.25, fails: 1, note: '✗ npm test failed' },
  { text: '// keep in sync', at: 0.95, fails: 2, note: '✗ within noise' },
  { text: 'useMemo(() => burn(…))', at: 1.75, fails: 0, note: '✓ −90%' },
];
const reach = (c, gate) => c.at + (GATES[gate].x - GATES[0].x) / SPEED;
const KEPT_X = 3.6;
export const FixHarness = ({ loop, fps = 30 }) => {
  const { s, f, sp } = useClock();
  const sim = simulate(
    'fix-harness',
    (world, C) => {
      ground(world, C);
      const belt = new C.Body({ type: C.Body.STATIC, shape: new C.Box(new C.Vec3(3.9, 0.15, 0.5)), position: new C.Vec3(0.3, 0.25, 0) });
      world.addBody(belt);
      return CHANGES.map(c => {
        const t = reach(c, c.fails || 1);
        const b = new C.Body({ type: C.Body.STATIC, shape: new C.Box(new C.Vec3(1.05, 0.17, 0.32)), position: new C.Vec3(GATES[c.fails || 1].x + 0.35, 0.6, 0) });
        b.dropAt = Math.round(t * fps);
        b.dropMass = 1;
        b.onFrame = (frame, body) => {
          // knocked off the back of the belt, carrying the belt's speed
          if (frame === body.dropAt) {
            body.velocity.set(1.0, 0.35, -2.2);
            body.angularVelocity.set(-2.2, 0.3, 0.4);
          }
        };
        world.addBody(b);
        return b;
      });
    },
    Math.round(12 * fps),
    { fps },
  );
  const bodies = sim(f);
  const flash = (gate, ok, at) => (s >= at && s < at + 0.6 ? (ok ? '#22c98a' : '#ff4d6d') : null);
  return (
    <Shell loop={loop} cam={[0, 3.6, 10.2]} target={[0.4, 1.0, 0]} sway={0.1}>
      {/* the belt */}
      <mesh position={[0.3, 0.25, 0]} geometry={rounded(7.8, 0.3, 1, 0.08)} material={glossy('#1a2346')} receiveShadow castShadow />
      <mesh position={[0.3, 0.41, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7.6, 0.06]} />
        <meshStandardMaterial color={PAL.cyan} emissive={PAL.cyan} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {GATES.map((g, i) => {
        const hit = CHANGES.map(c => {
          if (i === 0) return null;
          const t = reach(c, i);
          if (c.fails && c.fails < i) return null;
          return flash(i, c.fails !== i, t);
        }).find(Boolean);
        const color = hit || g.color;
        return (
          <group key={g.label} position={[g.x, 0, 0]}>
            {[-0.75, 0.75].map(z => (
              <mesh key={z} position={[0, 0.95, z]} geometry={rounded(0.18, 1.5, 0.18, 0.06)} material={glossy(color, hit || '#000000', hit ? 1.2 : 0)} castShadow />
            ))}
            <mesh position={[0, 1.75, 0]} geometry={rounded(0.22, 0.22, 1.72, 0.08)} material={glossy(color, color, hit ? 1.4 : 0.35)} castShadow />
            <Chip text={g.label} position={[0, 2.25, 0]} w={1.9} h={0.46} d={0.16} size={0.2} color={PAL.slate} />
          </group>
        );
      })}
      {/* where a proven fix ends up */}
      <group position={[KEPT_X + 0.2, 0, 1.6]}>
        <mesh position={[0, 0.06, 0]} geometry={rounded(2.3, 0.12, 1.1, 0.05)} material={glossy('#145a42', '#22c98a', 0.4)} receiveShadow />
        <Label position={[0, 0.13, 0.56]} width={2.2} height={0.36} lines={[ui('✓ kept as a commit', '#8ff0c4', 0.17)]} />
      </group>
      {CHANGES.map((c, k) => {
        if (s < c.at) return null;
        const pop = sp(c.at, { damping: 12, stiffness: 160 });
        const end = c.fails ? reach(c, c.fails) : null;
        const color = c.fails ? (s >= end ? '#7a1e33' : PAL.violet) : s >= reach(c, 2) + 0.2 ? '#16a874' : PAL.violet;
        let pos;
        let quat;
        if (c.fails && s >= end) {
          pos = bodies[k].p;
          quat = bodies[k].q;
        } else {
          const x = GATES[0].x + (s - c.at) * SPEED + 0.35;
          const keptAt = (KEPT_X - GATES[0].x) / SPEED;
          const done = !c.fails && s - c.at > keptAt;
          // the proven fix slides off the end of the belt onto the "kept" pad
          const slide = Math.min(1, (s - c.at - keptAt) / 0.4);
          pos = done ? [KEPT_X + 0.2 * slide, 0.6 - 0.35 * slide, 1.6 * slide] : [Math.min(x, KEPT_X), 0.6, 0];
        }
        const gateNote = c.fails ? end : reach(c, 2);
        return (
          <group key={c.text}>
            <Chip text={c.text} position={pos} quaternion={quat} scale={pop} w={2.1} h={0.34} d={0.64} size={0.17} font="mono" color={color} textColor="#ffffff" />
            {s >= gateNote && s < gateNote + 0.8 && (
              <Chip text={c.note} position={[GATES[c.fails || 2].x, 3.0, 0.3]} scale={sp(gateNote)} w={2.1} h={0.42} d={0.14} size={0.19} color={c.fails ? '#3a1220' : '#14684a'} textColor={c.fails ? '#ff9fb2' : '#ffffff'} />
            )}
          </group>
        );
      })}
      {s > reach(CHANGES[2], 2) + 1.05 && <Chip text="7cae6fa · perf: Row" position={[KEPT_X + 0.2, 1.05, 1.6]} scale={sp(reach(CHANGES[2], 2) + 1.05)} w={2.3} h={0.38} d={0.14} size={0.16} font="mono" color={PAL.slate} textColor="#8ff0c4" />}
    </Shell>
  );
};

export const FEATURE_SCENES = {
  'one-command': OneCommand,
  journeys: Journeys,
  culprit: Culprit,
  components: Components,
  proof: Proof,
  budgets: Budgets,
  'pull-requests': PullRequests,
  ai: AiVerify,
  editor: Editor,
  dashboard: Dashboard,
  json: JsonOut,
  safe: Safe,
  fix: FixHarness,
};
