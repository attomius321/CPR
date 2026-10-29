export { detectForge } from './detect.js';
export { GitHubForge, githubToken } from './github.js';
export { GitLabForge, gitlabHeaders } from './gitlab.js';
export { parseRemote, type RemoteLocation } from './remote.js';
export type {
  ChangeRequest,
  Env,
  Forge,
  ForgeKind,
  Review,
  ReviewComment,
  ReviewEvent,
} from './types.js';
