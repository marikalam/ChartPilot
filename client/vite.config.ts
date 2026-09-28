import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served from marikalam.github.io/apps/chartpilot/ (the apps repo's gh-pages branch)
  base: '/apps/chartpilot/',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 800 },
});
