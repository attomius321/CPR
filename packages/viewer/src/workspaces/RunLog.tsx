// A Hive run's log on the Run tab (decisions 700, 863): its running step's last lines as they
// stream, and the full log under a step, read when opened.
import { useEffect, useState } from 'react';
import type { LogRead } from '@symbiote/core';
import { DocumentsIcon } from '../ui/icons.js';
import { StepLog } from './StepLog.js';
import { Loading } from '../ui/Loading.js';
import { enc } from './run-words.js';

/** A Hive run's log (decision 700): `/api/workspaces/hive/log`, streamed as a merge's is. */
const logSource = (branch: string, log: string) => (from: number) =>
  `/api/workspaces/hive/log?branch=${enc(branch)}&log=${enc(log)}&from=${from}`;

// ESC [ … a letter: a log's colours and cursor moves, left out of its tail.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** The last `count` lines the running step of a log wrote (decision 863), as it streams. */
export function useLogTail(branch: string, log: string | undefined, count = 4): string[] {
  const [tail, setTail] = useState<string[]>([]);
  useEffect(() => {
    setTail([]);
    if (!log) return;
    let text = '';
    const events = new EventSource(logSource(branch, log)(0));
    events.addEventListener('lines', (event) => {
      const read = JSON.parse((event as MessageEvent<string>).data) as LogRead<string>;
      for (const line of read.lines) {
        // A new step's lines are its own.
        if ('step' in line || 'run' in line) text = '';
        else if ('out' in line) text = (text + line.out).slice(-8_000);
      }
      const lines = text
        .replace(ANSI, '')
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter((l) => l !== '');
      setTail(lines.slice(-count));
    });
    events.addEventListener('gone', () => events.close());
    events.onerror = () => events.close();
    return () => events.close();
  }, [branch, log, count]);
  return tail;
}

/** Full log: a run's log under its step, read when opened; live while it runs. */
export function FullLog({
  branch,
  log,
  label,
  running = false,
  commands,
  expected,
}: {
  branch: string;
  log: string;
  label: string;
  running?: boolean;
  commands?: string[];
  expected?: number[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button ghost run-full-log"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <DocumentsIcon />
        {open ? 'Hide the log' : 'Full log'}
      </button>
      {open && (
        <StepLog
          id={log}
          source={logSource(branch, log)}
          state={
            running
              ? {
                  running: true,
                  checking: true,
                  ...(commands ? { commands } : {}),
                  ...(expected ? { expected } : {}),
                }
              : { running: false, checking: false }
          }
          label={label}
          className="hive-log run-log"
          waitingWords={<Loading inline>Reading its log…</Loading>}
        />
      )}
    </>
  );
}
