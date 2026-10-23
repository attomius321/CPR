import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'packages/*/test/fixtures/**',
      'spikes/**',
      // Files given to a workspace's agent with its brief (V40): the person's, not linted.
      'symbiote/documents/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  // The desktop app's start page: a classic script in its window.
  {
    files: ['packages/desktop/start/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
);
