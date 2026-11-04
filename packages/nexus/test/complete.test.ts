import { describe, expect, it } from 'vitest';
import type { Folder } from '../src/folders.js';
import { completed, completion, into, typedPath, up } from '../src/page/complete.js';

const HOME = '/home/dev';
const entry = (name: string, repository = false): Folder => ({
  name,
  path: `${HOME}/work/acme/${name}`,
  repository,
});
const acme = [
  entry('admin-portal', true),
  entry('billing-service', true),
  entry('billing-service.worktrees'),
  entry('Brand-assets'),
  entry('brand-site', true),
];

describe('typedPath (decision 910)', () => {
  it('is the folder to list and the start of the name after the last /', () => {
    expect(typedPath('~/work/acme/bi', HOME)).toEqual({
      folder: `${HOME}/work/acme`,
      prefix: 'bi',
    });
    expect(typedPath('~/work/acme/', HOME)).toEqual({ folder: `${HOME}/work/acme`, prefix: '' });
    expect(typedPath('~/wo', HOME)).toEqual({ folder: HOME, prefix: 'wo' });
    expect(typedPath('~/', HOME)).toEqual({ folder: HOME, prefix: '' });
    expect(typedPath('~', HOME)).toEqual({ folder: HOME, prefix: '' });
    expect(typedPath('/mnt/c/Us', HOME)).toEqual({ folder: '/mnt/c', prefix: 'Us' });
    expect(typedPath('/', HOME)).toEqual({ folder: '/', prefix: '' });
    expect(typedPath('/srv', HOME)).toEqual({ folder: '/', prefix: 'srv' });
    expect(typedPath('  ~/code/ ', HOME)).toEqual({ folder: `${HOME}/code`, prefix: '' });
  });

  it('is null for a search: neither ~ nor / first, or another person’s ~', () => {
    expect(typedPath('store', HOME)).toBeNull();
    expect(typedPath('acme/bi', HOME)).toBeNull();
    expect(typedPath('~bob/x', HOME)).toBeNull();
    expect(typedPath('', HOME)).toBeNull();
  });
});

describe('completion', () => {
  it('is the entries starting with what was typed (case aside), the others, and their common part', () => {
    expect(completion(acme, 'bi')).toEqual({
      hits: [acme[1], acme[2]],
      others: [acme[0], acme[3], acme[4]],
      common: 'billing-service',
    });
    expect(completion(acme, 'b').common).toBe('b');
    expect(completion(acme, 'BR')).toMatchObject({ hits: [acme[3], acme[4]], common: 'Brand-' });
    expect(completion(acme, 'x')).toEqual({ hits: [], others: acme, common: '' });
    expect(completion(acme, '')).toEqual({ hits: acme, others: [], common: '' });
  });
});

describe('completed (Tab)', () => {
  it('fills in the common part; one entry whole, a folder with its /', () => {
    expect(completed('~/work/acme/bi', acme)).toBe('~/work/acme/billing-service');
    expect(completed('~/work/acme/billing-service.', acme)).toBe(
      '~/work/acme/billing-service.worktrees/',
    );
    // A repository: the end of the way down (decision 554), no / after it.
    expect(completed('~/work/acme/ad', acme)).toBe('~/work/acme/admin-portal');
    expect(completed('~/work/acme/brand-s', acme)).toBe('~/work/acme/brand-site');
    // Nothing more in common, or nothing at all: as it was.
    expect(completed('~/work/acme/b', acme)).toBe('~/work/acme/b');
    expect(completed('~/work/acme/x', acme)).toBe('~/work/acme/x');
    expect(completed('/mnt/', [{ name: 'c', path: '/mnt/c', repository: false }])).toBe('/mnt/c/');
  });
});

describe('into (→ or Enter on a folder)', () => {
  it('is the folder typed whole, with its /', () => {
    expect(into('~/work/acme/bi', acme[2] as Folder)).toBe(
      '~/work/acme/billing-service.worktrees/',
    );
    expect(into('/mn', { name: 'mnt' })).toBe('/mnt/');
  });
});

describe('up (Backspace right after a /)', () => {
  it('is the folder above; null where there is none, or not right after a /', () => {
    expect(up('~/work/acme/')).toBe('~/work/');
    expect(up('~/work/')).toBe('~/');
    expect(up('/mnt/c/')).toBe('/mnt/');
    expect(up('/mnt/')).toBe('/');
    expect(up('/')).toBeNull();
    expect(up('~/')).toBeNull();
    expect(up('~/work/ac')).toBeNull();
    expect(up('store')).toBeNull();
  });
});
