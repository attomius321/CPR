import { readFileSync } from 'node:fs';
import lodash from 'lodash';

export function load() {
  readFileSync('x');
  return lodash;
}
