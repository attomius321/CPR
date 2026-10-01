import { CprError } from '@cpr/core';
import { GitHubForge } from './github.js';
import { GitLabForge } from './gitlab.js';
import { parseRemote } from './remote.js';
import type { Env, Forge, ForgeKind } from './types.js';

/**
 * The forge serving a remote: from `kind` when given (self-hosted hosts), else from the host
 * name (`github…`, `gitlab…`), else from `CPR_FORGE`.
 */
export function detectForge(remoteUrl: string, env: Env, kind?: ForgeKind): Forge {
  const { host, path } = parseRemote(remoteUrl);
  const forge =
    kind ??
    (host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : undefined) ??
    (env.CPR_FORGE === 'github' || env.CPR_FORGE === 'gitlab' ? env.CPR_FORGE : undefined);
  if (forge === 'github') return new GitHubForge(host, path, env);
  if (forge === 'gitlab') return new GitLabForge(host, path, env);
  throw new CprError(`cannot tell whether ${host} is GitHub or GitLab; pass --forge github|gitlab`);
}
