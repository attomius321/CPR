// Symbiote's logs (LG1, `docs/plan/lg1-logs.md`): every Symbiote process's lines in one local
// folder, which another app reads (`ops/logs/`).
export { dayOf, KEEP_DAYS, logsDir, nextDay, pruneLogs } from './folder.js';
export { openLog, silentLog, watchUncaught, type Log, type OpenLogOptions } from './log.js';
export type { Logger } from 'pino';
