import { CprError } from '@cpr/core';

export interface RemoteLocation {
  host: string;
  /** Project path without `.git`: `owner/repo`, `group/subgroup/project`. */
  path: string;
}

/**
 * Host and project path of a git remote URL: `https://host/path.git`,
 * `ssh://git@host:2222/path.git`, or scp-like `git@host:path.git`.
 */
export function parseRemote(url: string): RemoteLocation {
  let host: string;
  let path: string;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(url);
  if (/^[a-z][a-z+.-]*:\/\//i.test(url)) {
    const parsed = new URL(url);
    host = parsed.hostname;
    path = decodeURIComponent(parsed.pathname);
  } else if (scp?.[1] && scp[2]) {
    host = scp[1];
    path = scp[2];
  } else {
    throw new CprError(`cannot tell the forge project from remote URL '${url}'`);
  }
  path = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  if (!host || !path.includes('/')) {
    throw new CprError(`cannot tell the forge project from remote URL '${url}'`);
  }
  return { host: host.toLowerCase(), path };
}
