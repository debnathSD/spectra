import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Background } from '../components/Background.jsx';
import { FEATURE_SCENES } from '../scenes3d/features.jsx';

// A seamless 6-second loop of one feature scene, for the cards on the
// Spectra page (960 × 540, 30 fps, no sound).
export const FEATURE_IDS = Object.keys(FEATURE_SCENES);
export const FeatureLoop = ({ feature }) => {
  const Scene = FEATURE_SCENES[feature];
  return (
    <AbsoluteFill>
      <Background floor={false} />
      <Scene loop fps={30} />
    </AbsoluteFill>
  );
};
