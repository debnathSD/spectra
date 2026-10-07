import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import perfProfiler from './server/plugin.js';

export default defineConfig({
  plugins: [react(), perfProfiler()],
  server: { port: Number(process.env.PORT) || 5178, open: false },
});
