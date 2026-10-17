import { ThreeCanvas } from '@remotion/three';
import React, { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Studio lighting: a soft room for reflections, a key light with soft
// shadows, cyan and violet rim lights, filmic tone mapping.
const Studio = ({ exposure = 1.05 }) => {
  const { gl, scene } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.38;
    return () => {
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, exposure]);
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[4, 9, 6]}
        intensity={2.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0004}
        shadow-radius={6}
      />
      <pointLight position={[-7, 3, -4]} intensity={60} distance={30} color="#36d6ff" />
      <pointLight position={[7, 2.5, -3]} intensity={50} distance={30} color="#b07cff" />
    </>
  );
};

/** A shadow-catching floor with a faint glowing grid. */
export const Floor = ({ y = 0, size = 60, grid = true, shadow = 0.32 }) => (
  <group position={[0, y, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <shadowMaterial transparent opacity={shadow} />
    </mesh>
    {grid && <gridHelper args={[size, size, '#1d6fb8', '#16305a']} position={[0, 0.002, 0]} material-transparent material-opacity={0.35} />}
  </group>
);

/**
 * A transparent WebGL layer over the HTML background. camera: position and
 * look-at target; fov in degrees.
 */
export const Stage3D = ({ camera = [0, 4, 10], target = [0, 1, 0], fov = 32, exposure, children, style, shift = 0 }) => {
  const { width, height } = useVideoConfig();
  return (
    <ThreeCanvas width={width} height={height} style={{ position: 'absolute', inset: 0, ...style }} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }} camera={{ fov, position: camera, near: 0.1, far: 200 }}>
      <CameraRig position={camera} target={target} shift={shift} />
      <Studio exposure={exposure} />
      {children}
    </ThreeCanvas>
  );
};

/** Moves the camera every frame (the props can be animated); shift moves the picture right, in pixels. */
export const CameraRig = ({ position, target, shift = 0 }) => {
  const { camera, size } = useThree();
  camera.position.set(...position);
  camera.lookAt(...target);
  if (shift) camera.setViewOffset(size.width, size.height, -shift, 0, size.width, size.height);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  return null;
};

// --- materials
const cacheM = new Map();
const memo = (key, make) => (cacheM.has(key) ? cacheM.get(key) : (cacheM.set(key, make()), cacheM.get(key)));
/** Glossy, clear-coated plastic, like a premium device finish. */
export const glossy = (color, emissive = '#000000', emissiveIntensity = 0) =>
  memo(`g${color}${emissive}${emissiveIntensity}`, () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, emissive, emissiveIntensity }));
/** Brushed dark metal for bases and frames. */
export const metal = color => memo(`m${color}`, () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0.85, clearcoat: 0.4 }));
/** Frosted glass. */
export const glass = (tint = '#bfe8ff') => memo(`x${tint}`, () => new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.18, metalness: 0, transmission: 1, thickness: 0.6, ior: 1.42, transparent: true, opacity: 1 }));
/** A light that glows. */
export const glow = (color, intensity = 2.2) => memo(`e${color}${intensity}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 }));

const cacheG = new Map();
/** A rounded box, shared per size. */
export const rounded = (w, h, d, r = 0.08) => {
  const k = `${w}|${h}|${d}|${r}`;
  if (!cacheG.has(k)) cacheG.set(k, new RoundedBoxGeometry(w, h, d, 5, r));
  return cacheG.get(k);
};

export const useMaterial = (make, deps) => useMemo(make, deps); // eslint-disable-line react-hooks/exhaustive-deps
