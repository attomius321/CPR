import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ThreadEntry } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import type { CodexThread } from '../src/app-server.js';
import { fileWindow } from '../src/thread.js';
import {
  TRANSCRIPT_END,
  TRANSCRIPT_FIRST,
  codexRunsOn,
  runsOnIn,
  transcriptOf,
  transcriptReader,
} from '../src/workspace-running.js';

/**
 * Claude Code 2.1.316's transcript of a session (V83's real run, its words replaced): a turn on
 * Haiku 5.5 at low, `/model sonnet` and `/effort medium` typed, a turn on Sonnet 5.5 at medium.
 */
const TRANSCRIPT = readFileSync(
  join(import.meta.dirname, 'fixtures', 'transcript-2.1.316.jsonl'),
  'utf8',
);
const LINES = TRANSCRIPT.trimEnd().split('\n');

/** An answer as Claude Code writes it (the fixture's shape), on `model` at `effort`. */
const answer = (fields: Record<string, unknown>, message: Record<string, unknown> = {}) =>
  JSON.stringify({
    parentUuid: 'p',
    isSidechain: false,
    type: 'assistant',
    timestamp: '2026-10-31T10:00:00.000Z',
    sessionId: 's1',
    ...fields,
    message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], ...message },
  });

describe('runsOnIn (V83)', () => {
  it("reads today's transcript: the newest answer's model, level and time", () => {
    expect(runsOnIn(TRANSCRIPT)).toEqual({
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      at: '2026-10-31T09:26:10.348Z',
    });
  });

  it('says what the last answer ran on until another answers: a command typed changes nothing yet', () => {
    // The first turn's answer, then `/model sonnet` and `/effort medium`: no answer since.
    expect(runsOnIn(LINES.slice(0, 9).join('\n'))).toEqual({
      model: 'claude-haiku-5-5',
      effort: 'low',
      at: '2026-10-31T09:25:35.757Z',
    });
  });

  it("passes over a subagent's answer and a command's synthetic one", () => {
    const text = [
      ...LINES,
      answer({ isSidechain: true, effort: 'low' }, { model: 'claude-haiku-4-5-20251001' }),
      answer({}, { model: '<synthetic>' }),
    ].join('\n');
    expect(runsOnIn(text)).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' });
  });

  it('takes the model asked for when the answer names none, and leaves out a level not given', () => {
    expect(runsOnIn(answer({ requestedModel: 'claude-opus-5-5', effort: 'xhigh' }))).toEqual({
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      at: '2026-10-31T10:00:00.000Z',
    });
    // Haiku 4.5 takes no level.
    expect(runsOnIn(answer({}, { model: 'claude-haiku-4-5-20251001' }))).toEqual({
      model: 'claude-haiku-4-5-20251001',
      at: '2026-10-31T10:00:00.000Z',
    });
  });

  it('keeps only what reads as a model and a level; broken lines and other kinds are skipped', () => {
    const text = [
      answer({ effort: 'high' }, { model: 'claude-opus-5-5' }),
      answer({ effort: 'very high', timestamp: 7 }, { model: '--model opus' }),
      '{"type":"assistant","message":',
      'not json',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' }, effort: 'low' }),
    ].join('\n');
    // The newest answer has neither a model nor a level that reads as one: the one before it.
    expect(runsOnIn(text)).toEqual({
      model: 'claude-opus-5-5',
      effort: 'high',
      at: '2026-10-31T10:00:00.000Z',
    });
    expect(runsOnIn('')).toBeNull();
    expect(runsOnIn(LINES.slice(0, 2).join('\n'))).toBeNull();
  });
});

describe('transcriptOf (V83)', () => {
  const at = '2026-10-31T10:00:00.000Z';
  const entry = (fields: Partial<ThreadEntry> & Pick<ThreadEntry, 'kind'>, session = 's1') =>
    ({ at, session, ...fields }) as ThreadEntry;

  it("is the newest session's: its newest start or prompt that has one", () => {
    expect(
      transcriptOf([
        entry({ kind: 'start', source: 'startup', transcript: '/p/s1.jsonl' }),
        entry({ kind: 'prompt', text: 'Go', transcript: '/p/s1.jsonl' }),
        entry({ kind: 'report', text: 'Done' }),
        entry({ kind: 'start', source: 'startup', transcript: '/p/s2.jsonl' }, 's2'),
        entry({ kind: 'notice', type: 'idle_prompt' }, 's2'),
      ]),
    ).toBe('/p/s2.jsonl');
  });

  it("is none for a thread its hooks wrote before V83, or a path that is not a transcript's", () => {
    expect(transcriptOf([entry({ kind: 'prompt', text: 'Go' })])).toBeUndefined();
    expect(transcriptOf([])).toBeUndefined();
    expect(
      transcriptOf([entry({ kind: 'prompt', text: 'Go', transcript: 'relative/s1.jsonl' })]),
    ).toBeUndefined();
    expect(
      transcriptOf([entry({ kind: 'prompt', text: 'Go', transcript: '/etc/passwd' })]),
    ).toBeUndefined();
  });
});

describe('transcriptReader (V83)', () => {
  /** A reader counting the bytes it asks for. */
  function counted() {
    const reads: number[] = [];
    const reader = transcriptReader({
      window: (path, bytes) => {
        reads.push(bytes);
        return fileWindow(path, bytes);
      },
    });
    return { reader, reads };
  }

  it('reads a transcript once, then again only when it changed: its end, for the newest answer', async () => {
    const path = join(tempDir(), 's1.jsonl');
    writeFileSync(path, `${LINES.slice(0, 9).join('\n')}\n`);
    const { reader, reads } = counted();
    expect(await reader.runsOn(path)).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(await reader.runsOn(path)).toMatchObject({ model: 'claude-haiku-5-5' });
    expect(reads).toEqual([TRANSCRIPT_FIRST]);
    appendFileSync(path, `${LINES.slice(9).join('\n')}\n`);
    expect(await reader.runsOn(path)).toMatchObject({
      model: 'claude-sonnet-5-5',
      effort: 'medium',
    });
    expect(reads).toEqual([TRANSCRIPT_FIRST, TRANSCRIPT_END]);
  });

  it("keeps what it read when a tool's long result fills the end it reads", async () => {
    const path = join(tempDir(), 's1.jsonl');
    writeFileSync(path, TRANSCRIPT);
    const { reader } = counted();
    expect(await reader.runsOn(path)).toMatchObject({ model: 'claude-sonnet-5-5' });
    const result = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(200_000) }] },
    });
    appendFileSync(path, `${result}\n`);
    expect(await reader.runsOn(path)).toMatchObject({ model: 'claude-sonnet-5-5' });
  });

  it("finds an answer a long tool's result away when it knows nothing of the transcript yet", async () => {
    const path = join(tempDir(), 's1.jsonl');
    const result = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(1_400_000) }] },
    });
    writeFileSync(path, `${TRANSCRIPT}${result}\n`);
    expect(await transcriptReader().runsOn(path)).toMatchObject({ model: 'claude-sonnet-5-5' });
  });

  it('is null for a transcript gone or never written', async () => {
    const path = join(tempDir(), 's1.jsonl');
    const reader = transcriptReader();
    expect(await reader.runsOn(path)).toBeNull();
    writeFileSync(path, TRANSCRIPT);
    expect(await reader.runsOn(path)).toMatchObject({ model: 'claude-sonnet-5-5' });
    rmSync(path);
    expect(await reader.runsOn(path)).toBeNull();
  });
});

describe('codexRunsOn (V83)', () => {
  const thread = (fields: Partial<CodexThread>): CodexThread => ({
    id: 'thread-1',
    createdAt: 1_793_437_000,
    updatedAt: 1_793_437_651,
    status: 'idle',
    turns: [],
    ...fields,
  });

  it("is its thread's model and level, as of the thread's last change", () => {
    expect(codexRunsOn(thread({ model: 'gpt-5.6-terra', effort: 'high' }))).toEqual({
      model: 'gpt-5.6-terra',
      effort: 'high',
      at: new Date(1_793_437_651_000).toISOString(),
    });
    // No level set: the model's own, which the thread does not say.
    expect(codexRunsOn(thread({ model: 'gpt-6-luna' }))).toEqual({
      model: 'gpt-6-luna',
      at: new Date(1_793_437_651_000).toISOString(),
    });
    expect(codexRunsOn(thread({}))).toBeNull();
  });
});
