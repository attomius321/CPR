import { qwikRouter } from '@qwik.dev/router/vite';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  plugins: [qwikRouter({ routesDir: './src/app' })],
}));
