// The person's pinned folders (NX4, decisions 617–619): kept in Symbiote's settings folder, beside
// `hive.json`, from one run of the nexus to the next (each run serves on a new port, so a page's
// own storage starts empty). A pinned repository is a card among the Symbiotes, a pinned folder a
// place (fix/nexus-pinned-symbiotes, decisions 627, 628); pinning starts nothing.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { checkoutOf, repositoryRoot, within, type Folder } from './folders.js';

/** The file in Symbiote's settings folder (`configDir`) that keeps the nexus's own choices. */
export const PINS_FILE = 'nexus.json';

/** A pinned folder, as the page draws it: a repository's with what it has checked out. */
export interface Pin extends Pick<Folder, 'branch' | 'detached'> {
  name: string;
  path: string;
  /** It holds a `.git` folder or file, as a listing marks a repository. */
  repository: boolean;
  /** Its folder is gone: kept until the person unpins it. */
  missing?: true;
}

/** What a pin or an unpin answers: the pins after it, or why not. */
export type PinAnswer = { pinned: Pin[] } | { status: 400 | 404 | 422; error: string };

export interface Pins {
  /** The pins, in the order pinned. */
  read(): Promise<Pin[]>;
  /** Pins or unpins `path`, an absolute folder. */
  set(path: string, pinned: boolean): Promise<PinAnswer>;
}

/** The file's fields, or none when it is missing or not an object. */
async function readFields(file: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The pinned paths in `file`, in the order pinned, each once; none when it is missing or broken. */
export async function readPinned(file: string): Promise<string[]> {
  const { pinned } = await readFields(file);
  if (!Array.isArray(pinned)) return [];
  const paths = pinned
    .filter((path): path is string => typeof path === 'string' && isAbsolute(path))
    .map((path) => resolve(path));
  return [...new Set(paths)];
}

/** `paths` as `file`'s pins, the rest of it kept, written whole: a reader never sees half of it. */
export async function writePinned(file: string, paths: readonly string[]): Promise<void> {
  const fields = await readFields(file);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ...fields, pinned: paths }, null, 2)}\n`);
  await rename(temp, file);
}

/**
 * Each pinned path as the page draws it: its name, gone or not, a repository or not and, for one,
 * what it has checked out, read from its `HEAD` as a listing reads it (decision 555).
 */
export function describePins(paths: readonly string[]): Promise<Pin[]> {
  return Promise.all(
    paths.map(async (path): Promise<Pin> => {
      const name = basename(path) || '/';
      const folder = await stat(path).then(
        (stats) => stats.isDirectory(),
        () => false,
      );
      if (!folder) return { name, path, repository: false, missing: true };
      const checkout = await checkoutOf(path);
      return { name, path, repository: checkout !== null, ...checkout };
    }),
  );
}

/**
 * The pins in `file`. A pin is a folder that exists and is not inside a repository (decision 554:
 * Folders never lists inside one), a repository's root being fine; an unpin takes any path. Writes
 * are taken one at a time, each from the file as it is then, so pins asked for at once are kept.
 */
export function pins({
  file,
  home,
  repositoryOf = repositoryRoot,
}: {
  file: string;
  home: string;
  repositoryOf?: (folder: string) => Promise<string | null>;
}): Pins {
  let queue: Promise<unknown> = Promise.resolve();

  async function set(asked: string, pinned: boolean): Promise<PinAnswer> {
    const path = resolve(asked);
    const paths = await readPinned(file);
    if (!pinned) {
      if (paths.includes(path))
        await writePinned(
          file,
          paths.filter((p) => p !== path),
        );
      return { pinned: await describePins(paths.filter((p) => p !== path)) };
    }
    const why = await refused(path);
    if (why) return why;
    if (!paths.includes(path)) await writePinned(file, [...paths, path]);
    return { pinned: await describePins(paths.includes(path) ? paths : [...paths, path]) };
  }

  async function refused(path: string): Promise<PinAnswer | null> {
    const folder = await stat(path).then(
      (stats) => stats.isDirectory(),
      () => null,
    );
    if (folder === null) return { status: 404, error: `No such folder: ${path}` };
    if (!folder) return { status: 400, error: `Not a folder: ${path}` };
    // In a `.git` folder git names no top level: asked from the folder holding it.
    const root = await repositoryOf(path.replace(/\/\.git(?:\/.*)?$/, '') || '/');
    if (root === null || root === path || within(home, root)) return null;
    return {
      status: 422,
      error: `${path} is inside the repository ${root}: pin the repository`,
    };
  }

  return {
    read: async () => describePins(await readPinned(file)),
    set: (path, pinned) => {
      const answer = queue.then(() => set(path, pinned));
      queue = answer.catch(() => undefined);
      return answer;
    },
  };
}
