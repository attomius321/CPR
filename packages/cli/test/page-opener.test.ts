// SC1 (decision 930): every address a run opens or prints holds a token of its own; a tab's
// "Open again" opens one as the run opened its first (the browser), else prints it.
import { describe, expect, it } from 'vitest';
import { pageOpener } from '../src/command-diff.js';
import type { CliContext } from '../src/command-context.js';
import { serverKeys } from '../src/server-keys.js';

function context() {
  let stdout = '';
  const opened: string[] = [];
  const ctx = {
    stdout: (text: string) => (stdout += text),
    openUrl: (url: string) => opened.push(url),
  } as unknown as CliContext;
  return { ctx, opened, stdout: () => stdout };
}

describe('pageOpener', () => {
  it('gives each address a token of its own, each traded once', () => {
    const keys = serverKeys();
    const opener = pageOpener(context().ctx, keys);
    opener.at('http://127.0.0.1:5/');
    const [a, b] = [opener.address(), opener.address()];
    expect(a).toMatch(/^http:\/\/127\.0\.0\.1:5\/#k=[\w-]{43}$/);
    expect(b).not.toBe(a);
    expect(keys.trade(a.slice(a.indexOf('#k=') + 3))).toBe(keys.page);
    expect(keys.trade(b.slice(b.indexOf('#k=') + 3))).toBe(keys.page);
  });

  it('prints a fresh address when asked again; opens it too once the run opened the browser', () => {
    const { ctx, opened, stdout } = context();
    const opener = pageOpener(ctx, serverKeys());
    opener.at('http://127.0.0.1:5/');
    opener.again();
    expect(stdout()).toMatch(/^Symbiote viewer: http:\/\/127\.0\.0\.1:5\/#k=[\w-]{43}\n$/);
    expect(opened).toEqual([]);
    opener.browse();
    opener.again();
    expect(opened).toHaveLength(2);
    expect(opened[0]).not.toBe(opened[1]);
  });
});
