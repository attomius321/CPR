// The person's Confirm on Symbiote's MCP (decision 361): an ask held for them, answered, expired or
// gone; and Nucleus's calls recorded with their Confirms (NU2), numbered with the asks.
import type { McpAsk, McpCaller, NucleusActivityLine, WithoutConfirm } from '@symbiote/core';
import { headOf } from './nucleus-activity.js';
import { MAX_COMMAND } from './tool-activity.js';
import type { McpContext, McpOptions } from './mcp-context.js';
import { ToolProblem, type Args } from './mcp-tools.js';

const callerKey = (c: McpCaller) =>
  c.via === 'nucleus' ? 'nucleus' : `mcp\u0000${c.client ?? ''}\u0000${c.folder ?? ''}`;

/** Asks held for the person, and Nucleus's calls recorded. */
export function mcpConfirm({
  options,
  now,
  askMs,
  held,
}: Pick<McpContext, 'now' | 'askMs' | 'held'> & {
  options: Pick<McpOptions, 'onAsks' | 'record'>;
}) {
  let asked = 0;
  let recorded = 0;
  /**
   * Holds `words` for the person, for `caller`: their answer, and `done` to call once the call
   * that asked is over.
   */
  function ask(tool: string, words: string, caller: McpCaller, signal: AbortSignal) {
    const key = callerKey(caller);
    if ([...held.values()].some((h) => callerKey(h.ask.by) === key)) {
      throw new ToolProblem(
        'An ask of yours waits for the person already: wait for their answer, then ask again',
      );
    }
    const at = now();
    const ask: McpAsk = {
      id: `a${++asked}-${at.getTime().toString(36)}`,
      tool,
      words,
      by: caller,
      at: at.toISOString(),
      until: new Date(at.getTime() + askMs).toISOString(),
    };
    let done = () => {};
    const finished = new Promise<void>((resolve) => (done = resolve));
    const answer = new Promise<'yes' | 'no' | 'expired' | 'gone'>((resolve) => {
      const timer = setTimeout(() => settle('expired'), askMs);
      const gone = () => settle('gone');
      function settle(answer: 'yes' | 'no' | 'expired' | 'gone') {
        clearTimeout(timer);
        signal.removeEventListener('abort', gone);
        held.delete(ask.id);
        options.onAsks?.();
        resolve(answer);
      }
      if (signal.aborted) return settle('gone');
      signal.addEventListener('abort', gone);
      held.set(ask.id, { ask, settle, finished });
      options.onAsks?.();
    });
    return { answer, done, ask };
  }

  /** Where Nucleus's calls are recorded (NU2): a call's start, its end, a Confirm's. */
  function recorder(name: string, args: Args, caller: McpCaller) {
    const record = options.record;
    if (!record || caller.via !== 'nucleus') return null;
    const started = now();
    const head = {
      session: 'symbiote',
      id: `m${++recorded}-${started.getTime().toString(36)}`,
      tool: name,
      source: 'symbiote' as const,
    };
    const put = (line: NucleusActivityLine) => {
      try {
        record(line);
      } catch {
        // A call is never failed by its record.
      }
    };
    const input = JSON.stringify(args);
    put({
      at: started.toISOString(),
      ...head,
      phase: 'start',
      ...(input !== '{}' ? { input: input.slice(0, MAX_COMMAND) } : {}),
    });
    return {
      id: head.id,
      asked(ask: McpAsk) {
        put({
          at: ask.at,
          kind: 'confirm',
          ask: ask.id,
          tool: ask.tool,
          words: ask.words,
          call: head.id,
          stage: 'asked',
          until: ask.until,
        });
      },
      /** A start that went without a Confirm (NU8, decision 785): its words and why. */
      skipped(tool: string, words: string, why: WithoutConfirm) {
        const at = now();
        put({
          at: at.toISOString(),
          kind: 'confirm',
          ask: `s${++asked}-${at.getTime().toString(36)}`,
          tool,
          words,
          call: head.id,
          stage: 'skipped',
          why,
        });
      },
      answered(ask: McpAsk, answer: 'yes' | 'no' | 'expired' | 'gone') {
        const at = now();
        put({
          at: at.toISOString(),
          kind: 'confirm',
          ask: ask.id,
          tool: ask.tool,
          words: ask.words,
          call: head.id,
          stage: 'ended',
          answer: answer === 'yes' ? 'confirmed' : answer === 'no' ? 'declined' : answer,
          ms: Math.max(0, at.getTime() - Date.parse(ask.at)),
        });
      },
      ended(done: { text: string; isError?: true } | null) {
        const at = now();
        put({
          at: at.toISOString(),
          ...head,
          phase: 'end',
          ms: Math.max(0, at.getTime() - started.getTime()),
          ...(done ? headOf(done.text) : {}),
          ...(done?.isError ? { failed: true as const } : {}),
          ...(done ? {} : { interrupted: true as const }),
        });
      },
    };
  }

  return { ask, recorder };
}
