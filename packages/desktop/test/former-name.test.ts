import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { moveFormerConfig } from '../src/former-name.js';
import { readState } from '../src/state.js';

/** Symbiote's former name, as its folder and the viewer's keys were called. */
const FORMER = 'cpr';

const dir = mkdtempSync(join(tmpdir(), 'symbiote-former-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('moveFormerConfig', () => {
  it("moves the former settings folder to Symbiote's, once", () => {
    const home = join(dir, 'a');
    mkdirSync(join(home, FORMER, 'app'), { recursive: true });
    writeFileSync(join(home, FORMER, 'app.json'), '{}');
    writeFileSync(join(home, FORMER, 'app', 'state.json'), '{}');
    moveFormerConfig(join(home, 'symbiote'));
    expect(readFileSync(join(home, 'symbiote', 'app.json'), 'utf8')).toBe('{}');
    expect(existsSync(join(home, 'symbiote', 'app', 'state.json'))).toBe(true);
    expect(existsSync(join(home, FORMER))).toBe(false);
  });

  it('leaves both when Symbiote has its own already', () => {
    const home = join(dir, 'b');
    mkdirSync(join(home, FORMER), { recursive: true });
    mkdirSync(join(home, 'symbiote'), { recursive: true });
    writeFileSync(join(home, FORMER, 'app.json'), 'old');
    moveFormerConfig(join(home, 'symbiote'));
    expect(existsSync(join(home, 'symbiote', 'app.json'))).toBe(false);
    expect(existsSync(join(home, FORMER, 'app.json'))).toBe(true);
  });
});

describe('readState and the former choices', () => {
  it("reads the viewer's choices kept under the former name, the new ones first", () => {
    const file = join(dir, 'state.json');
    writeFileSync(
      file,
      JSON.stringify({
        choices: {
          [`${FORMER}.viewer.theme`]: 'light',
          [`${FORMER}.viewer.sidenav`]: 'rail',
          'symbiote.viewer.sidenav': 'open',
        },
      }),
    );
    expect(readState(file).choices).toEqual({
      'symbiote.viewer.theme': 'light',
      'symbiote.viewer.sidenav': 'open',
    });
  });
});
