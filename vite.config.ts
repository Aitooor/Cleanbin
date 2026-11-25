import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isDemo = process.env.VITE_DEMO_MODE === '1';

export default defineConfig({
  base: isDemo ? process.env.VITE_BASE_PATH || '/Cleanbin/' : '/',
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: isDemo ? 'dist/demo' : 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
  },
});
