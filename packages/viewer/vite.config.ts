import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: `cpr view` serves the build from any path.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
