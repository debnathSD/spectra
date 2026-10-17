import { useThree } from '@react-three/fiber';
import React, { useEffect, useMemo, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import * as THREE from 'three';
import { fonts, fontsDone } from '../theme.js';

// Text for 3D objects, drawn into a high-resolution canvas texture once the
// brand fonts have loaded, and shown unlit so it stays crisp and bright.
// While rendering, the 3D canvas only redraws when the frame changes, so a
// label that waits for fonts holds the frame and redraws once it is ready.
let fontsReady = null;
let fontsLoaded = false;
const whenFonts = () => (fontsReady ??= fontsDone().then(() => document.fonts.ready));

const useFontsReady = () => {
  const { advance } = useThree();
  const [ready, setReady] = useState(fontsLoaded);
  const [handle] = useState(() => (fontsLoaded ? null : delayRender('3D label fonts')));
  useEffect(() => {
    if (!ready)
      whenFonts().then(() => {
        fontsLoaded = true;
        setReady(true);
      });
  }, [ready]);
  useEffect(() => {
    if (ready && handle !== null) {
      advance(performance.now());
      continueRender(handle);
    }
  }, [ready, handle, advance]);
  return ready;
};

const cache = new Map();
/**
 * lines: [{ text, size, weight, color, font: 'ui' | 'mono' | 'display' }], top to bottom.
 * width × height in world units; align: 'left' | 'center'.
 */
export const Label = ({ lines, width = 2, height = 0.6, align = 'center', position, rotation, opacity = 1, padding = 0.08 }) => {
  const ready = useFontsReady();
  const texture = useMemo(() => {
    if (!ready) return null;
    const key = JSON.stringify([lines, width, height, align, padding]);
    if (cache.has(key)) return cache.get(key);
    const ppu = 420; // pixels per world unit
    const c = document.createElement('canvas');
    c.width = Math.round(width * ppu);
    c.height = Math.round(height * ppu);
    const ctx = c.getContext('2d');
    const total = lines.reduce((a, l) => a + l.size * 1.25, 0);
    let y = (c.height - total * ppu) / 2;
    for (const l of lines) {
      const px = l.size * ppu;
      ctx.font = `${l.weight || 600} ${px}px "${fonts[l.font || 'ui']}"`;
      ctx.fillStyle = l.color || '#ffffff';
      ctx.textBaseline = 'top';
      ctx.textAlign = align;
      const x0 = align === 'center' ? c.width / 2 : padding * ppu;
      ctx.fillText(l.text, x0, y + px * 0.12, c.width - padding * 2 * ppu);
      if (l.wavy) {
        // an editor-style squiggle under part of the line: wavy = [fromChar, toChar, color]
        const [a, b, color] = l.wavy;
        const left = x0 + ctx.measureText(l.text.slice(0, a)).width;
        const right = x0 + ctx.measureText(l.text.slice(0, b)).width;
        const base = y + px * 1.12;
        ctx.strokeStyle = color;
        ctx.lineWidth = px * 0.07;
        ctx.beginPath();
        for (let x = left; x <= right; x += 2) ctx.lineTo(x, base + Math.sin((x - left) / (px * 0.12)) * px * 0.07);
        ctx.stroke();
      }
      y += px * 1.25;
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    cache.set(key, t);
    return t;
  }, [ready, lines, width, height, align, padding]);
  if (!texture) return null;
  return (
    <mesh position={position} rotation={rotation} renderOrder={2}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} toneMapped={false} depthWrite={false} />
    </mesh>
  );
};
