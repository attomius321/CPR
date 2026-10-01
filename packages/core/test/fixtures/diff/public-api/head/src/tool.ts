import { internalHelper } from './parse';

export function clean(value: string): string {
  return internalHelper(value, true);
}
