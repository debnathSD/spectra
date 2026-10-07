import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// A tiny dev-mode React app with deliberate performance problems, used to
// check that the profiler finds them. Run with `npm run demo`.
export default defineConfig({
  root: here,
  cacheDir: path.join(here, '../../.vite-demo'),
  plugins: [react()],
  server: { port: 5188, strictPort: true },
});
