import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Label } from './Label.jsx';
import { glossy, rounded } from './Stage3D.jsx';

const gradientTexture = (stops, size = 512) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, size, size, 0);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const roundedRect = (w, h, r) => {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
};

const PULSE = [[14, 52], [33, 52], [44, 26], [58, 76], [68, 52], [86, 52]];
let markParts = null;
const parts = () => {
  if (markParts) return markParts;
  const S = 1.6;
  const geo = new THREE.ExtrudeGeometry(roundedRect(S, S, 0.42), { depth: 0.34, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 10, curveSegments: 32 });
  geo.translate(0, 0, -0.17);
  const face = gradientTexture([[0, '#5ac8fa'], [0.55, '#0a84ff'], [1, '#bf5af2']]);
  face.repeat.set(1 / (S + 0.14), 1 / (S + 0.14));
  face.offset.set(0.5, 0.5);
  const side = gradientTexture([[0, '#1b4fbf'], [1, '#5a2aa8']]);
  const faceMat = new THREE.MeshPhysicalMaterial({ map: face, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05 });
  const sideMat = new THREE.MeshPhysicalMaterial({ map: side, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 });
  const path = new THREE.CurvePath();
  const pts = PULSE.map(([x, y]) => new THREE.Vector3(((x - 50) / 100) * S * 0.72, (-(y - 50) / 100) * S * 0.72, 0.25));
  for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
  const tube = new THREE.TubeGeometry(path, 400, 0.05, 14, false);
  const tubeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.6, roughness: 0.3 });
  const cap = new THREE.SphereGeometry(0.05, 16, 16);
  markParts = { geo, mats: [faceMat, sideMat], tube, tubeMat, cap, pts };
  return markParts;
};

/** The Spectra mark in 3D. draw: 0–1, how much of the pulse line is drawn. */
export const Mark3D = ({ position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, draw = 1 }) => {
  const p = parts();
  const count = p.tube.index.count;
  useMemo(() => p.tube.setDrawRange(0, Math.floor((count * Math.max(0, Math.min(1, draw))) / 6) * 6), [p, count, draw]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={p.geo} material={p.mats} castShadow receiveShadow />
      {draw > 0 && <mesh geometry={p.tube} material={p.tubeMat} />}
      {draw > 0 && <mesh geometry={p.cap} material={p.tubeMat} position={p.pts[0]} />}
      {draw >= 1 && <mesh geometry={p.cap} material={p.tubeMat} position={p.pts.at(-1)} />}
    </group>
  );
};

/** A rounded, glossy tile with text on its face. */
export const Tile = ({ w = 2, h = 0.7, d = 0.24, color = '#16203f', lines, labelW, position, quaternion, rotation, scale = 1, emissive, emissiveIntensity = 0, castShadow = true }) => (
  <group position={position} quaternion={quaternion} rotation={rotation} scale={scale}>
    <mesh geometry={rounded(w, h, d, Math.min(0.1, h / 4))} material={glossy(color, emissive, emissiveIntensity)} castShadow={castShadow} receiveShadow />
    {lines && <Label position={[0, 0, d / 2 + 0.006]} width={labelW || w * 0.94} height={h * 0.94} lines={lines} />}
  </group>
);

/** A glowing beam between two points. */
export const Beam = ({ from, to, color = '#36d6ff', radius = 0.02, progress = 1 }) => {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const end = a.clone().lerp(b, Math.max(0.0001, progress));
  const mid = a.clone().add(end).multiplyScalar(0.5);
  const len = a.distanceTo(end);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(a).normalize());
  return (
    <mesh position={mid.toArray()} quaternion={q.toArray()}>
      <cylinderGeometry args={[radius, radius, len, 10]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.4} toneMapped={false} />
    </mesh>
  );
};
