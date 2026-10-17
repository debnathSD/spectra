import { loadFont as inter } from '@remotion/google-fonts/Inter';
import { loadFont as grotesk } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as mono } from '@remotion/google-fonts/JetBrainsMono';

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** seconds → frames */
export const s = sec => Math.round(sec * FPS);

// Everything is cut to the music: 128 BPM, with a two-beat pickup before the
// drop (scripts/synth.js), so bars start at beats 2, 6, 10, …
export const BPM = 128;
export const BEAT = (FPS * 60) / BPM; // 28.125 frames
/** beats → frames */
export const beats = n => Math.round(n * BEAT);
export const PICKUP = 2;

export const fonts = {
  ui: inter('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] }).fontFamily,
  display: grotesk('normal', { weights: ['500', '600', '700'], subsets: ['latin'] }).fontFamily,
  mono: mono('normal', { weights: ['400', '500', '600'], subsets: ['latin'] }).fontFamily,
};

export const C = {
  bg: '#060912',
  ink: '#eef1fb',
  dim: '#aeb6cc',
  faint: '#7d869f',
  cyan: '#36d6ff',
  blue: '#0a84ff',
  violet: '#b9a5ff',
  green: '#46e2a0',
  red: '#ff8da8',
  amber: '#ffc764',
  panel: 'rgba(12, 16, 32, 0.92)',
  line: 'rgba(255, 255, 255, 0.1)',
};
export const GRAD_TEXT = {
  background: 'linear-gradient(100deg, #8b8bff, #36d6ff 50%, #c99bff)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
};
export const BRAND = 'linear-gradient(135deg, #5ac8fa, #0a84ff 55%, #bf5af2)';
