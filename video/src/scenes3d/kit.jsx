// Building blocks for the 3D scenes: timing in seconds (so a scene plays the
// same at 30 or 60 fps), glossy columns, panels of text, orbs and a loop
// envelope that assembles a scene from nothing and takes it apart again.
import React, { createContext, useContext } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Tile } from '../three/Brand3D.jsx';
import { Label } from '../three/Label.jsx';
import { glossy, glow, rounded } from '../three/Stage3D.jsx';

export const PAL = { blue: '#1f6fff', cyan: '#22c7f0', violet: '#7a6cff', purple: '#a45cf0', green: '#22c98a', red: '#ff4d6d', amber: '#ffb020', ink: '#eef3ff', slate: '#141c38', slate2: '#1c2750' };
export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

/**
 * Inside a longer film a scene can play faster (scale) and needs to know how
 * long it lasts (total, in its own seconds).
 */
export const SceneTime = createContext(null);

/** Time in seconds, and springs that start at a given second. */
export const useClock = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const ctx = useContext(SceneTime);
  const f = frame * (ctx?.scale ?? 1);
  const s = f / fps;
  const sp = (at, config = { damping: 15, stiffness: 140, mass: 0.7 }) => spring({ frame: f - at * fps, fps, config });
  const ramp = (a, b, from = 0, to = 1) => interpolate(s, [a, b], [from, to], CLAMP);
  return { f, fps, s, sp, ramp, total: ctx?.total ?? durationInFrames / fps };
};

/** 0 → 1 as a looped scene assembles, 1 → 0 as it comes apart at the end. */
export const useEnvelope = (loop, outFor = 0.7) => {
  const { sp, s, total } = useClock();
  if (!loop) return 1;
  const a = sp(0, { damping: 18, stiffness: 120, mass: 0.6 });
  const b = s > total - outFor ? interpolate(s, [total - outFor, total - 0.05], [0, 1], CLAMP) : 0;
  return Math.max(0, Math.min(1, a) * (1 - b * b));
};

/** A glossy column growing from the floor, with a label in front and a value on top. */
export const Column = ({ x = 0, z = 0, w = 0.9, height, color, label, value, valueColor = '#ffffff', glowing = false, labelColor = '#c6d3f5' }) => {
  const h = Math.max(0.02, height);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} geometry={rounded(w, h, w, Math.min(0.1, h / 2.2))} material={glowing ? glossy(color, color, 0.35) : glossy(color)} castShadow receiveShadow />
      {label && <Label position={[0, 0.17, w / 2 + 1.0]} width={w * 2} height={0.4} lines={[{ text: label, size: 0.21, weight: 700, color: labelColor }]} />}
      {value && <Label position={[0, h + 0.36, 0]} width={w * 2.6} height={0.5} lines={[{ text: value, size: 0.28, weight: 700, color: valueColor, font: 'display' }]} />}
    </group>
  );
};

/**
 * A dark glossy panel standing up, with lines of text on its face.
 * lines: [{ text, size, color, font, weight }]
 */
export const Panel3D = ({ w = 4, h = 2.2, d = 0.16, position, rotation, scale = 1, lines, align = 'left', color = PAL.slate, padding = 0.22 }) => (
  <group position={position} rotation={rotation} scale={scale}>
    <mesh geometry={rounded(w, h, d, 0.12)} material={glossy(color)} castShadow receiveShadow />
    {/* a thin bright rim on the face */}
    <mesh position={[0, 0, d / 2 + 0.001]} geometry={rounded(w - 0.04, h - 0.04, 0.002, 0.1)} material={glossy('#0c1226')} />
    {lines && <Label position={[0, 0, d / 2 + 0.01]} width={w - 0.1} height={h - 0.1} align={align} padding={padding} lines={lines} />}
  </group>
);

/** A small glowing sphere. */
export const Orb = ({ position, color = PAL.cyan, r = 0.13, intensity = 3 }) => (
  <mesh position={position} castShadow>
    <sphereGeometry args={[r, 32, 32]} />
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} toneMapped={false} />
  </mesh>
);

/** A chip: a short rounded tile with one line of text. */
export const Chip = ({ text, color = PAL.slate2, textColor = '#ffffff', w = 1.9, h = 0.5, d = 0.22, font = 'ui', size = 0.2, ...rest }) => (
  <Tile w={w} h={h} d={d} color={color} lines={[{ text, size, weight: 700, color: textColor, font }]} {...rest} />
);

/** A ring of glowing light lying on the floor. */
export const Ring = ({ radius = 2, y = 0.02, color = PAL.cyan, tube = 0.035, arc = Math.PI * 2 }) => (
  <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <torusGeometry args={[radius, tube, 16, 160, arc]} />
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.4} toneMapped={false} />
  </mesh>
);

export { glow };
