import { useEffect, useRef, useState } from 'react';
import type { IMarker, Terminal } from '@xterm/xterm';
import type { MergeEntry, MergeLogLine, MergeLogRead } from '@symbiote/core';
import { logRuns, logText, NO_TEXT, stepName, type LogStep, type StepMark } from './merge-log.js';
import { duration, mergeLive } from './merges.js';
import { TERMINAL_FONT, TERMINAL_FONT_SIZE, TERMINAL_THEME } from './terminal.js';

/** A broken stream is opened again after this, from where it was. */
const RECONNECT_MS = 2_000;

/** Each mark's tone, as the merge's label colours it. */
const TONES: Record<StepMark, string> = {
  running: 'merge-tone-wait',
  passed: 'merge-tone-done',
  failed: 'merge-tone-bad',
  stopped: 'merge-tone-you',
  waiting: '',
  'not-run': '',
};

const WORDS: Record<StepMark, string> = {
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  stopped: 'stopped',
  waiting: 'waiting',
  'not-run': 'not run',
};

/**
 * A merge's log (V46a, decisions 314 and 316): its steps — the merge, the merger agent, each check
 * command, the landing — with their marks and times, and beside them everything they wrote, in a
 * read-only terminal (xterm.js, the agent terminal's chunk and colours) that follows the end
 * unless scrolled up; a new run (Retry, Request changes, an answer) brings it back to the end
 * (fix/merge-viewer-on-conflict). A click on a step scrolls to its heading. The lines come from
 * `/api/merges/log` as they are written, whichever Symbiote merges; `onLogged` says the first
 * arrived. Nothing is drawn for a merge with no log once it no longer runs (one made before V46).
 */
export function MergeLog({
  entry,
  hidden = false,
  onLogged,
}: {
  entry: MergeEntry;
  /** Kept, streaming, while another view is shown (V46c). */
  hidden?: boolean;
  onLogged?: () => void;
}) {
  const [lines, setLines] = useState<MergeLogLine[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<{ term: Terminal | null; markers: (IMarker | undefined)[] }>({
    term: null,
    markers: [],
  });
  const told = useRef(onLogged);
  told.current = onLogged;

  useEffect(() => {
    let gone = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | null = null;
    let next = 0;
    let state = NO_TEXT;
    // What arrived before the terminal loaded: written once it has.
    let waiting: { text: string; heading: boolean }[] | null = [];
    const write = (text: string, heading: boolean) => {
      const term = shown.current.term;
      if (!term) {
        waiting?.push({ text, heading });
        return;
      }
      // Once parsed, the heading is the line above the cursor.
      term.write(
        text,
        heading ? () => shown.current.markers.push(term.registerMarker(-1)) : undefined,
      );
    };
    // Lines came before: a run among the lines after them is a new one.
    let begun = false;
    const connect = () => {
      source = new EventSource(`/api/merges/log?id=${encodeURIComponent(entry.id)}&from=${next}`);
      source.addEventListener('lines', (event) => {
        const read = JSON.parse((event as MessageEvent<string>).data) as MergeLogRead;
        next = read.next;
        for (const line of read.lines) {
          const made = logText(line, state);
          state = made.state;
          if (made.text !== '') write(made.text, made.heading === true);
          // Scrolled up in the last run, the person would not see this one start.
          if (begun && 'run' in line) {
            shown.current.term?.write('', () => shown.current.term?.scrollToBottom());
          }
        }
        if (read.lines.length > 0) {
          begun = true;
          setLines((all) => [...all, ...read.lines]);
          told.current?.();
        }
      });
      source.addEventListener('gone', () => source?.close());
      source.onerror = () => {
        source?.close();
        if (!gone) retry = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/xterm/css/xterm.css'),
        // Its cell is measured from the font it is given: loaded first.
        document.fonts.load(`${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT}`),
      ]);
      const element = box.current;
      if (gone || !element) return;
      const term = new Terminal({
        theme: TERMINAL_THEME,
        fontFamily: TERMINAL_FONT,
        fontSize: TERMINAL_FONT_SIZE,
        disableStdin: true,
        cursorBlink: false,
        convertEol: true,
        scrollback: 10_000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();
      // Nothing is typed here: no cursor.
      term.write('\x1b[?25l');
      shown.current.term = term;
      for (const { text, heading } of waiting ?? []) write(text, heading);
      waiting = null;
      observer = new ResizeObserver(() => fit.fit());
      observer.observe(element);
    })();

    return () => {
      gone = true;
      source?.close();
      clearTimeout(retry);
      observer?.disconnect();
      shown.current.term?.dispose();
      shown.current = { term: null, markers: [] };
    };
  }, [entry.id]);

  const runs = logRuns(lines, entry);
  const running = runs.some((run) => run.steps.some((s) => s.mark === 'running'));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const scrollTo = (index: number) => {
    const { term, markers } = shown.current;
    const marker = markers[index];
    if (term && marker && marker.line >= 0) term.scrollToLine(marker.line);
  };
  const timeOf = (step: LogStep) =>
    step.mark === 'running' && step.at !== undefined
      ? duration(Math.max(0, now - step.at))
      : step.ms !== undefined
        ? duration(step.ms)
        : step.mark === 'passed' || step.mark === 'failed'
          ? ''
          : WORDS[step.mark];

  const empty = lines.length === 0 && !mergeLive([entry]);
  return (
    <section className={`merge-log${empty ? ' empty' : ''}`} aria-label="Its log" hidden={hidden}>
      <ol className="merge-steps" aria-label="Its steps">
        {runs.flatMap((run, r) => [
          ...(runs.length > 1
            ? [
                <li key={`run ${r}`} className="merge-steps-run">
                  {r === 0 ? 'Run 1' : `Run ${r + 1} · ${run.why ?? ''}`}
                </li>,
              ]
            : []),
          ...run.steps.map((step, i) => {
            const time = timeOf(step);
            const name = stepName(step);
            return (
              <li key={`${r} ${i}`}>
                <button
                  type="button"
                  className={`merge-step mark-${step.mark} ${TONES[step.mark]}`}
                  aria-label={`${name}: ${WORDS[step.mark]}${step.ms !== undefined || step.mark === 'running' ? `, ${time}` : ''}`}
                  disabled={step.index === undefined}
                  onClick={() => step.index !== undefined && scrollTo(step.index)}
                >
                  <span className="merge-step-dot" aria-hidden="true" />
                  <span
                    className={`merge-step-name${step.step === 'check' ? ' merge-step-command' : ''}`}
                  >
                    {name}
                  </span>
                  <span className="merge-step-time">{time}</span>
                </button>
              </li>
            );
          }),
        ])}
        {runs.length === 0 && <li className="merge-steps-run">Waiting for its turn</li>}
      </ol>
      <div className="merge-terminal" ref={box} role="log" aria-label="What it wrote" />
    </section>
  );
}
