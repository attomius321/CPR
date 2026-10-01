import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../src/index.js';

describe('@cpr/core', () => {
  it('exposes a semver schema version', () => {
    expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
