#!/usr/bin/env node
import { defaultCacheDir } from '@symbiote/core';
import { moveFormerCache } from './former-name.js';
import { run } from './main.js';

moveFormerCache(defaultCacheDir(), process.env);
process.exitCode = await run(process.argv.slice(2));
