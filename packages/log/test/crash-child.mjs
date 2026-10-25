// The crash test's child (`crash.test.ts`): opens a log, watches uncaught errors, then throws in a
// callback or rejects, at once. (Thrown at a module's top level, an error comes as a rejection:
// the module's evaluation rejects.)
import { openLog, watchUncaught } from '../src/index.js';

const log = openLog({ process: 'crash-test', env: process.env });
watchUncaught(log);
log.log.info('started');
if (process.argv[2] === 'throw') {
  setImmediate(() => {
    throw new Error('thrown at start');
  });
} else void Promise.reject(new Error('rejected at start'));
