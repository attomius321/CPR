import { SCHEMA_VERSION } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { run } from '../src/main.js';

function cpr(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = run(argv, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

describe('cpr', () => {
  it('prints help with no arguments', () => {
    const { code, stdout } = cpr();
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: cpr');
  });

  it('prints the version and schema version', () => {
    const { code, stdout } = cpr('--version');
    expect(code).toBe(0);
    expect(stdout).toMatch(
      new RegExp(`^cpr \\d+\\.\\d+\\.\\d+ \\(graph schema ${SCHEMA_VERSION}\\)\\n$`),
    );
  });

  it('rejects unknown commands with a usage error', () => {
    const { code, stderr } = cpr('nope');
    expect(code).toBe(2);
    expect(stderr).toContain("unknown command 'nope'");
  });
});
