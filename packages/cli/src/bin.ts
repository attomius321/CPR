#!/usr/bin/env node
import { openLog, watchUncaught } from '@symbiote/log';
import { processContext } from './command-context.js';
import { logProcess, run } from './main.js';

// Symbiote's logs (LG1): every command writes its lines, and an uncaught error is one of them.
const log = openLog({ process: logProcess(process.argv[2], !!process.send), env: process.env });
watchUncaught(log);
process.exitCode = await run(process.argv.slice(2), { ...processContext(), log });
