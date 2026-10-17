import React from 'react';
import { Audio, Sequence, interpolate, staticFile } from 'remotion';

/** The background track (scripts/music.mjs), faded in and out. */
export const Music = ({ name, duration, volume = 0.8 }) => (
  <Audio
    src={staticFile(`music/${name}.wav`)}
    volume={f => volume * interpolate(f, [0, 30, duration - 90, duration - 4], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
  />
);

/** A one-shot sound effect at frame `at`. */
export const Sfx = ({ name, at, volume = 0.4 }) => (
  <Sequence from={Math.max(0, at)} durationInFrames={180} layout="none">
    <Audio src={staticFile(`music/${name}.wav`)} volume={volume} />
  </Sequence>
);
