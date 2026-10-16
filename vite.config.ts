import { defineConfig } from 'vite';

// relative base so the build runs from any folder or static host
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
});
