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
      // Symbiote's own files in this checkout, which symbiote/.gitignore keeps out of git: the
      // documents given with a brief (V40), and Hive's records, which keep the tests its reviewer
      // wrote in a throwaway copy (`symbiote/hive/<branch>/r1/packages/…`). Not this project's code.
      'symbiote/**',
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
