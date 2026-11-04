// The hook's copy (fix/hive-runner-flaws, decision 721): `symbiote/claude-settings.json` names a
// copy of `agent-hook.js` and the modules it runs, in Symbiote's cache, in a folder named by their
// content and never removed. A `symbiote view` built in a worktree writes its own hook into that
// file; with its build's own path, a session started then recorded nothing once the worktree was
// deleted. Each build's copy stays, so whichever view wrote the file last, its hook is there.
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The hook and every module it runs (its imports; `agent-hook-copy.test.ts` keeps the list whole). */
export const HOOK_FILES = [
  'agent-hook.js',
  'thread.js',
  'tool-activity.js',
  'events-ping.js',
] as const;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Copies the hook's files from `dist` into `<cacheDir>/hooks/<their content>/` unless they are
 * there, beside a `package.json` that makes them ES modules; the copied hook's path. Written in a
 * folder of its own and renamed into place, so a hook path never names half a copy.
 */
export async function copyHook(dist: string, cacheDir: string): Promise<string> {
  const texts = await Promise.all(HOOK_FILES.map((file) => readFile(join(dist, file))));
  const hash = createHash('sha256');
  for (const [i, file] of HOOK_FILES.entries()) {
    hash.update(`${file}\0`);
    hash.update(texts[i] ?? '');
    hash.update('\0');
  }
  const folder = join(cacheDir, 'hooks', hash.digest('hex').slice(0, 16));
  const hook = join(folder, 'agent-hook.js');
  if (await exists(hook)) return hook;
  const temp = `${folder}.${randomBytes(4).toString('hex')}.tmp`;
  await mkdir(temp, { recursive: true });
  try {
    await writeFile(join(temp, 'package.json'), '{ "type": "module" }\n');
    for (const [i, file] of HOOK_FILES.entries()) await writeFile(join(temp, file), texts[i] ?? '');
    await rename(temp, folder);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    // Another process put the same copy in place first.
    if (!(await exists(hook))) throw error;
  }
  return hook;
}
