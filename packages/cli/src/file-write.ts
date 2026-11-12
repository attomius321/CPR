// How the CLI writes the files it keeps (records, state, settings): whole, so a reader never sees
// half of one, and safe to call twice at once — two tabs saving one review, a page's last save
// as it closes: one temporary name for both made one write fail and could leave a broken file.
import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** Who is told of each file written whole: the page's stream (V94a), by the file's path. */
const written = new Set<(path: string) => void>();

/** Tells `listener` the path of each file this process writes whole; the way to stop. */
export function onWritten(listener: (path: string) => void): () => void {
  written.add(listener);
  return () => written.delete(listener);
}

/**
 * Writes `data` to `path` whole: to a hidden temporary file of its own beside it, then renamed
 * over it; its folder made first. Of two writes at once, the last renamed is the file. `mode`: a
 * file holding a secret is the user's alone (0600, SC1).
 */
export async function writeFileWhole(
  path: string,
  data: string | Uint8Array,
  mode?: number,
): Promise<void> {
  await writeWhole(path, data, mode);
  for (const listener of written) listener(path);
}

async function writeWhole(path: string, data: string | Uint8Array, mode?: number): Promise<void> {
  const folder = dirname(path);
  await mkdir(folder, { recursive: true });
  const temp = join(
    folder,
    `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    await writeFile(temp, data, mode === undefined ? undefined : { mode });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
