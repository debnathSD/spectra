// Textures for 3D scenes. While rendering, the 3D canvas only redraws when the
// frame changes, so a scene that waits for images holds the frame until they
// have loaded and then redraws once.
import { useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import * as THREE from 'three';

const textures = new Map();
const load = file => {
  if (!textures.has(file))
    textures.set(
      file,
      new Promise((resolve, reject) =>
        new THREE.TextureLoader().load(
          staticFile(file),
          t => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 8;
            resolve(t);
          },
          undefined,
          reject,
        ),
      ),
    );
  return textures.get(file);
};
const ready = new Map();

/** The textures for `files` (paths in public/), or null until they have loaded. */
export const useTextures = files => {
  const key = files.join('|');
  const { advance } = useThree();
  const [loaded, setLoaded] = useState(() => ready.get(key) || null);
  const [handle] = useState(() => (ready.has(key) ? null : delayRender(`textures ${key}`)));
  useEffect(() => {
    if (loaded) return;
    Promise.all(files.map(load)).then(list => {
      ready.set(key, list);
      setLoaded(list);
    });
  }, [key, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loaded && handle !== null) {
      advance(performance.now());
      continueRender(handle);
    }
  }, [loaded, handle, advance]);
  return loaded;
};
