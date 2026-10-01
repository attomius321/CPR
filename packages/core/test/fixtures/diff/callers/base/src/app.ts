import { add, legacy } from './math';

export function total(values: number[]): number {
  return values.reduce((sum, value) => add(sum, value), 0);
}

export function old(): number {
  return legacy();
}
