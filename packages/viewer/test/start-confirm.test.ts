import { describe, expect, it } from 'vitest';
import { startConfirmNote } from '../src/settings/start-confirm.js';

// Settings' switch on Nucleus's page in words (NU8, decisions 783, 786).
describe('startConfirmNote', () => {
  it('says what it does, off or on, and what still waits', () => {
    const off = startConfirmNote({ withoutConfirm: false, own: false, hive: false }, 'Nucleus');
    expect(off).toMatch(/^With it on, Nucleus starts a workspace at once/);
    expect(off).toContain('verdicts, merges and clean-ups still wait for your Confirm');
    expect(off).toContain('kept out of git');
    expect(startConfirmNote({ withoutConfirm: true, own: true, hive: false }, 'Nucleus')).toMatch(
      /^Nucleus starts a workspace at once/,
    );
  });

  it("while Hive is on: on, in Alpha Ceph's name, the person's choice kept", () => {
    expect(startConfirmNote({ withoutConfirm: true, own: false, hive: true }, 'Alpha Ceph')).toBe(
      'On while Hive mode is on: Alpha Ceph starts workspaces without asking you. Your own choice (off) holds again when Hive is off.',
    );
    expect(
      startConfirmNote({ withoutConfirm: true, own: true, hive: true }, 'Alpha Ceph'),
    ).toContain('(on)');
  });
});
