// Every agent Symbiote starts is denied the tools that reach the person's other sessions on their
// own (decision 1078): it lists none of them and runs none of their routines. SendMessage stays,
// as every ability an agent has does; an issue's writer keeps its deny of it (1068).
import { describe, expect, it } from 'vitest';
import { agentSettings } from '../src/claude-code.js';
import { reviewerSettings } from '../src/hive-review.js';
import { claudeMerger } from '../src/merge-agent.js';
import { pageAgentSettings } from '../src/page-agent-files.js';
import type { RunWithInput } from '../src/programs.js';
import { claudeAdviceArgs } from '../src/workspace-advice.js';
import { issueWriterSettings } from '../src/writer-reach.js';

/** Claude Code 2.1.325's tools that reach another session on their own: listed, a routine run. */
const SESSION_TOOLS = ['ListAgents', 'RemoteTrigger'];

/** A settings file's deny rules. */
const denied = (text: string): unknown[] =>
  (JSON.parse(text) as { permissions?: { deny?: unknown[] } }).permissions?.deny ?? [];

/** The tools `--disallowedTools` names in `args`. */
const disallowed = (args: readonly string[]): string[] => {
  const at = args.indexOf('--disallowedTools');
  return at < 0 ? [] : (args[at + 1] ?? '').split(',');
};

describe("the person's other sessions are out of every agent's reach (decision 1078)", () => {
  it('a workspace agent, normal mode and Hive: the shared settings file', () => {
    const text = agentSettings({ node: '/n', hook: '/h', symbiote: '/r/symbiote', cache: '/c' });
    expect(denied(text)).toEqual(expect.arrayContaining(SESSION_TOOLS));
    // Its own subagents are followed up with it.
    expect(denied(text)).not.toContain('SendMessage');
  });

  it('a writer from an issue: its own settings file, SendMessage denied as before (1068)', () => {
    const text = issueWriterSettings({
      hooks: {},
      folder: '/c/writers/w',
      cacheDir: '/c',
      hosts: [],
      secrets: [],
      protect: [],
    });
    expect(denied(text)).toEqual(expect.arrayContaining([...SESSION_TOOLS, 'SendMessage']));
  });

  it('Nucleus and Scribe: the page agent settings file, with or without its activity', () => {
    for (const text of [
      pageAgentSettings({ node: '/n', gate: '/g' }, 'linux'),
      pageAgentSettings({ node: '/n', gate: '/g', activity: '/a.jsonl' }, 'linux', {
        worktree: { bgIsolation: 'none' },
      }),
    ]) {
      expect(denied(text)).toEqual(expect.arrayContaining(SESSION_TOOLS));
    }
  });

  it("Hive's running reviewer", () => {
    expect(denied(reviewerSettings())).toEqual(expect.arrayContaining(SESSION_TOOLS));
  });

  it("the merger's agent", async () => {
    const calls: string[][] = [];
    const run: RunWithInput = (_command, args) => {
      calls.push([...args]);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    await claudeMerger('/bin/claude', { run }).run({ cwd: '/wt', prompt: 'P' });
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls)
      expect(disallowed(args)).toEqual(expect.arrayContaining(SESSION_TOOLS));
  });

  it('the advisor', () => {
    const args = claudeAdviceArgs({ instructions: 'I', schema: {} });
    expect(disallowed(args)).toEqual(expect.arrayContaining(SESSION_TOOLS));
  });
});
