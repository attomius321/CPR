import { parse } from './parse';

export function main(argv: string[]): string[] {
  return parse(argv[0] ?? '');
}
