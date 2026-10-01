import type { LanguageAdapter } from '../../adapter.js';
import { danglingTs, exposureTs } from './detect.js';
import { extractTs } from './extract.js';
import { isTsSource } from './files.js';
import { loadTsProject, type TsRevision } from './project.js';
import { incomingTs, outgoingTs } from './references.js';

export type { TsRevision } from './project.js';

export const typescriptAdapter: LanguageAdapter<TsRevision> = {
  id: 'typescript',
  matches: isTsSource,
  // Defer so a bad config rejects instead of throwing synchronously.
  load: (source, options) => Promise.resolve().then(() => loadTsProject(source, options)),
  extract: extractTs,
  incoming: incomingTs,
  outgoing: outgoingTs,
  dangling: danglingTs,
  exposure: exposureTs,
  warnings: (revision) => revision.warnings,
};
