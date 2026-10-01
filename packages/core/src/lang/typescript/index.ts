import type { LanguageAdapter } from '../../adapter.js';
import { extractTs, isTsSource } from './extract.js';
import { loadTsProject, type TsRevision } from './project.js';

export type { TsRevision } from './project.js';

export const typescriptAdapter: LanguageAdapter<TsRevision> = {
  id: 'typescript',
  matches: isTsSource,
  // Defer so a bad config rejects instead of throwing synchronously.
  load: (source, options) => Promise.resolve().then(() => loadTsProject(source, options)),
  extract: extractTs,
};
