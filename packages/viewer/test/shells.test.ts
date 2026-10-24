import { describe, expect, it } from 'vitest';
import type { WorkspaceShell } from '@symbiote/core';
import {
  closeQuestion,
  shellAfter,
  shellName,
  shellOfUrl,
  withShell,
} from '../src/workspaces/shells.js';

const shell = (number: number, running?: string): WorkspaceShell => ({
  id: `t${number}`,
  number,
  ...(running ? { running } : {}),
});

describe("a workspace's shells (V45)", () => {
  it('reads the shell picked in the address: &shell=<n>', () => {
    expect(shellOfUrl('?branch=feature/x&shell=2')).toBe(2);
    expect(shellOfUrl('?branch=feature/x&shell=12')).toBe(12);
    for (const search of [
      '?branch=feature/x',
      '?shell=',
      '?shell=0',
      '?shell=-1',
      '?shell=1.5',
      '?shell=a',
      '?shell=02',
    ]) {
      expect(shellOfUrl(search), search).toBeNull();
    }
  });

  it('names a shell by its number', () => {
    expect(shellName(1)).toBe('Shell 1');
    expect(shellName(8)).toBe('Shell 8');
  });

  it('asks before closing a shell only when a program runs in it, naming the program', () => {
    expect(closeQuestion(shell(2))).toBeNull();
    expect(closeQuestion(shell(2, 'node'))).toBe(
      'node is running in Shell 2: closing the shell ends it.',
    );
  });

  it('shows the shell before the one that closed, else the one after, else none', () => {
    const open = [shell(1), shell(2), shell(4)];
    expect(shellAfter(open, 2)).toBe(1);
    expect(shellAfter(open, 4)).toBe(2);
    expect(shellAfter(open, 1)).toBe(2);
    expect(shellAfter([shell(3)], 3)).toBeNull();
    expect(shellAfter([], 1)).toBeNull();
  });

  it('adds a shell in the order of the numbers, once', () => {
    expect(withShell([shell(1), shell(3)], shell(2)).map((s) => s.number)).toEqual([1, 2, 3]);
    expect(withShell([shell(1), shell(2)], shell(2))).toEqual([shell(1), shell(2)]);
  });
});
