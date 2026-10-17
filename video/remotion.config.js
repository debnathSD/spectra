// Settings for `npm run studio`; scripts/render.mjs passes its own.
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('png');
Config.setCrf(16);
