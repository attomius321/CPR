import { describe, expect, it } from 'vitest';
import { compareShapes, type Shape } from '../src/index.js';
import { extractSources } from './helpers/extract.js';

/** Extracts one symbol from two versions of a file and compares their shapes. */
async function compat(id: string, base: string, head: string) {
  const [b, h] = await Promise.all([
    extractSources({ 'src/a.ts': base }),
    extractSources({ 'src/a.ts': head }),
  ]);
  return compareShapes(b.get(`src/a.ts#${id}`)?.shape, h.get(`src/a.ts#${id}`)?.shape);
}

describe('compareShapes', () => {
  it.each([
    ['optional parameter appended', 'f(a: number) {}', 'f(a: number, b?: string) {}', 'compatible'],
    ['default parameter appended', 'f(a: number) {}', 'f(a: number, b = 1) {}', 'compatible'],
    ['parameter renamed', 'f(a: number) {}', 'f(count: number) {}', 'compatible'],
    ['required parameter appended', 'f(a: number) {}', 'f(a: number, b: string) {}', 'breaking'],
    ['parameter retyped', 'f(a: number) {}', 'f(a: string) {}', 'breaking'],
    ['parameter removed', 'f(a: number, b: number) {}', 'f(a: number) {}', 'breaking'],
    ['optional parameter made required', 'f(a?: number) {}', 'f(a: number) {}', 'breaking'],
    ['return type changed', 'f(): number { return 1; }', 'f(): string { return ""; }', 'breaking'],
  ])('functions: %s → %s', async (_, base, head, expected) => {
    expect(await compat('f', `export function ${base}`, `export function ${head}`)).toBe(expected);
  });

  it.each([
    ['optional member added', '{ a: string }', '{ a: string; b?: number }', 'compatible'],
    ['required member added', '{ a: string }', '{ a: string; b: number }', 'additive'],
    ['optional member made required', '{ a?: string }', '{ a: string }', 'additive'],
    ['required member made optional', '{ a: string }', '{ a?: string }', 'breaking'],
    ['member removed', '{ a: string; b: number }', '{ a: string }', 'breaking'],
    ['member retyped', '{ a: string }', '{ a: number }', 'breaking'],
  ])('interfaces: %s → %s', async (_, base, head, expected) => {
    expect(await compat('T', `export interface T ${base}`, `export interface T ${head}`)).toBe(
      expected,
    );
  });

  it('compares object members of intersection type aliases', async () => {
    expect(
      await compat(
        'R',
        'export type R = Request & { id: string };',
        'export type R = Request & { id: string; clone(): R };',
      ),
    ).toBe('additive');
    expect(
      await compat(
        'R',
        'export type R = Request & { id: string };',
        'export type R = Response & { id: string };',
      ),
    ).toBe('breaking');
  });

  it('treats enum members as required', async () => {
    expect(await compat('E', 'export enum E { A }', 'export enum E { A, B }')).toBe('additive');
  });

  it('is unknown without shapes', () => {
    const shape: Shape = { rest: 'x' };
    expect(compareShapes(undefined, shape)).toBe('unknown');
  });
});
