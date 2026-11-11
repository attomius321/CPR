import { area } from './area.js';

if (area(2, 3) !== 6) throw new Error('area');
if (area(-2, 3) !== 6) throw new Error('a negative side');
