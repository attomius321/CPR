import { describe, expect, it } from 'vitest';
import type { WorkspaceShell } from '@symbiote/core';
import {
  closeQuestion,
  shellAfter,
  shellName,
  shellOfUrl,
  shownTab,
  withShell,
  type TabState,
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

describe("the tab a workspace's page shows (V45, V89)", () => {
  /** An agent with a terminal, shells allowed and none open, nothing picked. */
  const state = (change: Partial<TabState> = {}): TabState => ({
    chosen: null,
    shells: [],
    shellShown: null,
    split: null,
    terminals: true,
    shellsCan: true,
    hive: false,
    ...change,
  });
  const none = { shellNumber: null, splitNumber: null, shownShell: undefined };

  it("is the agent's terminal unless a tab is picked, its thread when it has no terminal", () => {
    expect(shownTab(state())).toEqual({ ...none, view: 'terminal' });
    expect(shownTab(state({ terminals: false }))).toEqual({ ...none, view: 'thread' });
    expect(shownTab(state({ chosen: 'terminal', terminals: false }))).toEqual({
      ...none,
      view: 'thread',
    });
    expect(shownTab(state({ chosen: 'activity' }))).toEqual({ ...none, view: 'activity' });
  });

  it("shows Run only for Hive's workspaces", () => {
    expect(shownTab(state({ chosen: 'run' })).view).toBe('terminal');
    expect(shownTab(state({ chosen: 'run', hive: true })).view).toBe('run');
  });

  it('shows the shell picked; once it went, its neighbour; none left, the agent', () => {
    const open = [shell(1), shell(2), shell(4)];
    expect(shownTab(state({ chosen: 'shell', shellShown: 2, shells: open }))).toEqual({
      ...none,
      shellNumber: 2,
      view: 'shell',
      shownShell: shell(2),
    });
    expect(shownTab(state({ chosen: 'shell', shellShown: 3, shells: open }))).toEqual({
      ...none,
      shellNumber: 2,
      view: 'shell',
      shownShell: shell(2),
    });
    expect(shownTab(state({ chosen: 'shell', shellShown: 1, shells: [] }))).toEqual({
      ...none,
      view: 'terminal',
    });
  });

  it('keeps the shell picked while the shells are read, and leaves it where shells cannot run', () => {
    expect(shownTab(state({ chosen: 'shell', shellShown: 2, shells: null }))).toEqual({
      ...none,
      shellNumber: 2,
      view: 'shell',
    });
    expect(
      shownTab(state({ chosen: 'shell', shellShown: 2, shells: [shell(2)], shellsCan: false })),
    ).toEqual({ ...none, shellNumber: 2, view: 'terminal' });
  });

  it("splits the agent's terminal with a shell, its neighbour once it went", () => {
    const open = [shell(1), shell(2), shell(4)];
    expect(shownTab(state({ split: 2, shells: open, chosen: 'activity' }))).toEqual({
      ...none,
      splitNumber: 2,
      view: 'terminal',
      shownShell: shell(2),
    });
    expect(shownTab(state({ split: 3, shells: open }))).toEqual({
      ...none,
      splitNumber: 2,
      view: 'terminal',
      shownShell: shell(2),
    });
    expect(shownTab(state({ split: 2, shells: null }))).toEqual({
      ...none,
      splitNumber: 2,
      view: 'terminal',
    });
  });

  it('does not split with no shell left, no shells or no terminal', () => {
    expect(shownTab(state({ split: 2, shells: [], chosen: 'activity' }))).toEqual({
      ...none,
      view: 'activity',
    });
    expect(shownTab(state({ split: 2, shells: [shell(2)], shellsCan: false }))).toEqual({
      ...none,
      view: 'terminal',
    });
    expect(shownTab(state({ split: 2, shells: [shell(2)], terminals: false }))).toEqual({
      ...none,
      view: 'thread',
    });
  });
});
