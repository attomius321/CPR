// SC1 (decisions 930–932): the run's secrets — the page's, the bridge's, Nucleus's — and the
// one-time tokens an opened address carries.
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { addressWith, runKeys, serverKeys, withoutFragment } from '../src/server-keys.js';

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe('serverKeys', () => {
  it('makes three different secrets per run, each long and URL-safe', () => {
    const keys = serverKeys();
    const all = [keys.page, keys.bridge, keys.nucleus];
    expect(new Set(all).size).toBe(3);
    for (const key of all) expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(serverKeys().page).not.toBe(keys.page);
  });

  it('takes the page key it is given (the e2e harness’s SYMBIOTE_PAGE_KEY)', () => {
    expect(serverKeys({ page: 'given-key' }).page).toBe('given-key');
    // An empty one is none.
    expect(serverKeys({ page: '' }).page).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('trades an open token once, for the page key', () => {
    const keys = serverKeys();
    const token = keys.open();
    expect(token).not.toBe(keys.page);
    expect(keys.trade(token)).toBe(keys.page);
    expect(keys.trade(token)).toBeUndefined();
    expect(keys.trade('made-up')).toBeUndefined();
    expect(keys.trade('')).toBeUndefined();
  });

  it('keeps the newest 20 tokens: an older one no longer trades', () => {
    const keys = serverKeys();
    const tokens = Array.from({ length: 21 }, () => keys.open());
    expect(keys.trade(tokens[0] ?? '')).toBeUndefined();
    expect(keys.trade(tokens[1] ?? '')).toBe(keys.page);
    expect(keys.trade(tokens[20] ?? '')).toBe(keys.page);
  });

  it('tells each caller by its header: the page, the bridge, Nucleus', () => {
    const keys = serverKeys();
    expect(keys.isPage(req({ 'x-symbiote-key': keys.page }))).toBe(true);
    expect(keys.isPage(req({ 'x-symbiote-key': keys.bridge }))).toBe(false);
    expect(keys.isPage(req({}))).toBe(false);
    expect(keys.isBridge(req({ 'x-symbiote-key': keys.bridge }))).toBe(true);
    expect(keys.isBridge(req({ 'x-symbiote-key': keys.page }))).toBe(false);
    expect(keys.isNucleus(req({ 'x-symbiote-nucleus': keys.nucleus }))).toBe(true);
    expect(keys.isNucleus(req({ 'x-symbiote-nucleus': keys.bridge }))).toBe(false);
    expect(keys.isNucleus(req({ 'x-symbiote-caller': 'nucleus' }))).toBe(false);
    expect(keys.isPage(req({ 'x-symbiote-key': `${keys.page}x` }))).toBe(false);
  });
});

describe('runKeys', () => {
  it('takes the keys an environment gives out of it and of this process’s, for no child to inherit', () => {
    process.env.SYMBIOTE_PAGE_KEY = 'p';
    process.env.SYMBIOTE_NUCLEUS_KEY = 'n';
    const { keys, env } = runKeys({ ...process.env, PATH: '/bin' });
    expect([keys.page, keys.nucleus]).toEqual(['p', 'n']);
    expect(env).not.toHaveProperty('SYMBIOTE_PAGE_KEY');
    expect(env).not.toHaveProperty('SYMBIOTE_NUCLEUS_KEY');
    expect(env.PATH).toBe('/bin');
    expect(process.env.SYMBIOTE_PAGE_KEY).toBeUndefined();
    expect(process.env.SYMBIOTE_NUCLEUS_KEY).toBeUndefined();
    // None given: made.
    expect(runKeys({}).keys.nucleus).toMatch(/^[\w-]{43}$/);
  });
});

describe('addresses', () => {
  it('puts a token in the fragment, and takes it out for logs', () => {
    expect(addressWith('http://127.0.0.1:4173/', 'abc')).toBe('http://127.0.0.1:4173/#k=abc');
    expect(addressWith('http://127.0.0.1:4173/diff/a..b/', 'abc')).toBe(
      'http://127.0.0.1:4173/diff/a..b/#k=abc',
    );
    expect(withoutFragment('http://127.0.0.1:4173/git#k=abc')).toBe('http://127.0.0.1:4173/git');
    expect(withoutFragment('http://127.0.0.1:4173/')).toBe('http://127.0.0.1:4173/');
  });
});
