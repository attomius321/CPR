// The hook's copy (fix/hive-runner-flaws, decision 721): `claude-settings.json` names a copy of
// the hook in Symbiote's cache, by its content, which outlives the build it came from.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { copyHook, HOOK_FILES } from '../src/agent-hook-copy.js';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const sourceOf = (file: string) => readFileSync(join(src, file.replace(/\.js$/, '.ts')), 'utf8');

/** The modules a source imports or re-exports at run time (`import type` left out). */
const importsOf = (file: string) =>
  [
    ...sourceOf(file).matchAll(/^(?:import|export)(?!\s+type\b)[^;]*?from '\.\/([\w-]+)\.js'/gm),
  ].map((m) => `${m[1]}.js`);

/** The hook as the build makes it: each file of the list, ESM, its types gone. */
function build(into: string) {
  mkdirSync(into, { recursive: true });
  for (const file of HOOK_FILES) {
    const { outputText } = ts.transpileModule(sourceOf(file), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
    });
    writeFileSync(join(into, file), outputText);
  }
}

let dir: string;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the hook's copy in Symbiote's cache (decision 721)", () => {
  it('copies the hook and every module it runs, no fewer', () => {
    const closure = new Set<string>();
    const walk = (file: string) => {
      if (closure.has(file)) return;
      closure.add(file);
      for (const next of importsOf(file)) walk(next);
    };
    walk('agent-hook.js');
    expect([...closure].sort()).toEqual([...HOOK_FILES].sort());
  });

  it('records a thread after the build it was copied from is gone', async () => {
    const dist = join(dir, 'dist');
    const cache = join(dir, 'cache');
    build(dist);
    const hook = await copyHook(dist, cache);
    expect(hook.startsWith(join(cache, 'hooks'))).toBe(true);
    expect(hook).toMatch(/[\\/][0-9a-f]{16}[\\/]agent-hook\.js$/);
    // A worktree's build, deleted with its worktree.
    rmSync(dist, { recursive: true });

    // A workspace whose worktree is `worktree`, as Symbiote records it.
    const symbiote = join(dir, 'repo', 'symbiote');
    const worktree = join(dir, 'worktree');
    mkdirSync(worktree, { recursive: true });
    mkdirSync(join(symbiote, 'workspaces', 'feature'), { recursive: true });
    writeFileSync(
      join(symbiote, 'workspaces', 'feature', 'x.json'),
      JSON.stringify({ branch: 'feature/x', worktree }),
    );
    execFileSync(process.execPath, [hook, symbiote], {
      input: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'session-1',
        cwd: worktree,
        prompt: 'Go on.',
      }),
    });
    const line = readFileSync(join(symbiote, 'threads', 'feature', 'x.jsonl'), 'utf8').trim();
    expect(JSON.parse(line)).toMatchObject({
      kind: 'prompt',
      text: 'Go on.',
      session: 'session-1',
    });
  });

  it('one folder a content: the same build copied once, another beside it, none removed', async () => {
    const dist = join(dir, 'dist');
    const cache = join(dir, 'cache');
    build(dist);
    const first = await copyHook(dist, cache);
    expect(await copyHook(dist, cache)).toBe(first);
    appendFileSync(join(dist, 'thread.js'), '\n// another build\n');
    const second = await copyHook(dist, cache);
    expect(second).not.toBe(first);
    expect(existsSync(first)).toBe(true);
    // No half-written folder left beside them.
    expect(readdirSync(join(cache, 'hooks'))).toHaveLength(2);
  });
});
