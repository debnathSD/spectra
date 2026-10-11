/**
 * Vite plugin: the dev server doubles as the Spectra backend. The API itself
 * lives in server/api.js so the standalone dashboard server can mount the exact
 * same routes; this plugin just wires it into Vite's Connect middleware.
 */
import { createApi } from './api.js';

export default function perfProfiler() {
  return {
    name: 'perf-profiler',
    configureServer(server) {
      const api = createApi();
      server.httpServer?.on('close', () => api.dispose());
      // Vite's Connect stack strips the '/api' mount prefix from req.url, which
      // is exactly what api.handle expects.
      server.middlewares.use('/api', api.handle);
    },
  };
}
