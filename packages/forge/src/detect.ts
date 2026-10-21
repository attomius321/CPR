import { SymbioteError } from '@symbiote/core';
import { GitHubForge } from './github.js';
import { GitLabForge } from './gitlab.js';
import { parseRemote } from './remote.js';
import type { Env, Forge, ForgeKind } from './types.js';

/**
 * The forge serving a remote: from `kind` when given (self-hosted hosts), else from the host
 * name (`github…`, `gitlab…`), else from `SYMBIOTE_FORGE`.
 */
export function detectForge(remoteUrl: string, env: Env, kind?: ForgeKind): Forge {
  const { host, path } = parseRemote(remoteUrl);
  const forge =
    kind ??
    (host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : undefined) ??
    (env.SYMBIOTE_FORGE === 'github' || env.SYMBIOTE_FORGE === 'gitlab'
      ? env.SYMBIOTE_FORGE
      : undefined);
  if (forge === 'github') return new GitHubForge(host, path, env);
  if (forge === 'gitlab') return new GitLabForge(host, path, env);
  throw new SymbioteError(
    `cannot tell whether ${host} is GitHub or GitLab; pass --forge github|gitlab`,
  );
}
