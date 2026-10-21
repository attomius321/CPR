import { describe, expect, it } from 'vitest';
import {
  contextMenuRoles,
  keyAction,
  outsideAddress,
  parseAppArgs,
  staysInWindow,
  type KeyInput,
} from '../src/policy.js';

describe('parseAppArgs', () => {
  it('reads the server to show and the first title, in either form', () => {
    expect(parseAppArgs(['--url', 'http://127.0.0.1:4100/', '--title', 'Symbiote'])).toEqual({
      url: 'http://127.0.0.1:4100/',
      title: 'Symbiote',
    });
    expect(parseAppArgs(['--url=http://localhost:4100/diff/a..b/', '--title=ky'])).toEqual({
      url: 'http://localhost:4100/diff/a..b/',
      title: 'ky',
    });
  });

  it("ignores Chromium's own switches and anything it does not know", () => {
    expect(
      parseAppArgs(['--no-sandbox', '--url', 'http://127.0.0.1:1/', '--x=1', 'extra']),
    ).toEqual({ url: 'http://127.0.0.1:1/' });
    expect(parseAppArgs([])).toEqual({});
  });

  it('reads a repository to open: an absolute path (N1b)', () => {
    expect(parseAppArgs(['--repo', '/home/a/ky'])).toEqual({ repo: '/home/a/ky' });
    expect(parseAppArgs(['--repo=/home/a/my repo'])).toEqual({ repo: '/home/a/my repo' });
    expect(parseAppArgs(['--repo', 'ky'])).toEqual({});
  });

  it('shows only a Symbiote server on this machine: http on 127.0.0.1 or localhost', () => {
    for (const url of [
      'https://127.0.0.1:4100/',
      'http://example.com/',
      'http://127.0.0.2:4100/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(parseAppArgs(['--url', url])).toEqual({});
    }
  });
});

describe('staysInWindow', () => {
  const home = 'http://127.0.0.1:4100/history';

  it("keeps the server's own pages, a diff's included", () => {
    expect(staysInWindow('http://127.0.0.1:4100/', home)).toBe(true);
    expect(staysInWindow('http://127.0.0.1:4100/diff/a..b/?x=1#y', home)).toBe(true);
  });

  it('sends everything else out: another port, host or scheme', () => {
    expect(staysInWindow('http://127.0.0.1:4101/', home)).toBe(false);
    expect(staysInWindow('http://localhost:4100/', home)).toBe(false);
    expect(staysInWindow('https://github.com/x/y/pull/1', home)).toBe(false);
    expect(staysInWindow('file:///etc/passwd', home)).toBe(false);
    expect(staysInWindow('nonsense', home)).toBe(false);
  });
});

describe('outsideAddress', () => {
  it('hands web addresses to the default browser', () => {
    expect(outsideAddress('https://github.com/x/y/pull/1')).toBe('https://github.com/x/y/pull/1');
    expect(outsideAddress('http://example.com/a?b#c')).toBe('http://example.com/a?b#c');
  });

  it('opens nothing else: files, scripts, other schemes', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'vscode://x', 'nonsense']) {
      expect(outsideAddress(url)).toBeNull();
    }
  });
});

describe('keyAction', () => {
  const key = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
    type: 'keyDown',
    key,
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...mods,
  });

  it('zooms with Ctrl on Linux and Windows, ⌘ on macOS', () => {
    expect(keyAction(key('=', { control: true }), 'linux')).toBe('zoom-in');
    expect(keyAction(key('+', { control: true, shift: true }), 'win32')).toBe('zoom-in');
    expect(keyAction(key('-', { control: true }), 'linux')).toBe('zoom-out');
    expect(keyAction(key('0', { control: true }), 'linux')).toBe('zoom-reset');
    expect(keyAction(key('=', { meta: true }), 'darwin')).toBe('zoom-in');
    expect(keyAction(key('=', { control: true }), 'darwin')).toBeNull();
    expect(keyAction(key('=', { meta: true }), 'linux')).toBeNull();
  });

  it('opens the inspector with Ctrl+Shift+I (⌥⌘I on macOS) or F12', () => {
    expect(keyAction(key('I', { control: true, shift: true }), 'linux')).toBe('devtools');
    expect(keyAction(key('i', { meta: true, alt: true }), 'darwin')).toBe('devtools');
    expect(keyAction(key('F12'), 'win32')).toBe('devtools');
  });

  it("leaves the page's keys alone: plain keys, Ctrl+R and Alt+arrows go to the page first", () => {
    for (const input of [
      key('j'),
      key('['),
      key('r', { control: true }),
      key('ArrowLeft', { alt: true }),
      key('c', { control: true }),
      { ...key('=', { control: true }), type: 'keyUp' },
    ]) {
      expect(keyAction(input, 'linux')).toBeNull();
    }
  });
});

describe('contextMenuRoles', () => {
  const none = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false };

  it('offers nothing where there is no text: no browser menu', () => {
    expect(contextMenuRoles({ isEditable: false, selectionText: '', editFlags: none })).toEqual([]);
  });

  it('offers Copy on selected text', () => {
    expect(
      contextMenuRoles({
        isEditable: false,
        selectionText: 'add',
        editFlags: { ...none, canCopy: true },
      }),
    ).toEqual(['copy']);
  });

  it('offers what a text field can do', () => {
    expect(
      contextMenuRoles({
        isEditable: true,
        selectionText: 'x',
        editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
      }),
    ).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
    expect(
      contextMenuRoles({
        isEditable: true,
        selectionText: '',
        editFlags: { ...none, canPaste: true, canSelectAll: true },
      }),
    ).toEqual(['paste', 'separator', 'selectAll']);
  });
});
