import { qwikCity } from '@builder.io/qwik-city/vite';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  plugins: [qwikCity({ mdx: { providerImportSource: '~/components/mdx-provider' } })],
}));
