#!/usr/bin/env node
import { openLog, watchUncaught } from '@symbiote/log';
import { processContext, run } from './main.js';

// Symbiote's logs (LG1): the nexus's lines beside the servers' own, and an uncaught error is one.
const log = openLog({ process: 'nexus', env: process.env });
watchUncaught(log);
process.exitCode = await run(process.argv.slice(2), { ...processContext(), log });
