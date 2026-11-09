// What the Start page reads and keeps (V30): the start's options, the check a commit would run,
// the draft, a document uploaded.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isCommit, listRefs, type AgentOption, type CheckGuess } from '@symbiote/core';
import { guessCheck, treeAt } from './check.js';
import { levelsOn } from './agent-levels.js';
import { MAX_BRIEF, workKinds } from './workspace-brief.js';
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS,
  MAX_DOCUMENTS_BYTES,
  saveUpload,
} from './workspace-documents.js';
import { symbioteFolder, WorkspaceRefused } from './workspace-record.js';
import { FULL_SHA, startBranches, workspaceBase, worktreeFolder } from './workspace-start.js';
import { writeFileWhole } from './file-write.js';
import type { WorkspacesContext, Workspaces } from './workspace-context.js';
import { effortsOf } from './workspace-agent.js';

/** The Start page's reads and saves. */
export function workspaceOptions({
  cacheDir,
  claude,
  codex,
  config,
  env,
  mainRoot,
  now,
  place,
  repo,
  uploads,
}: Pick<
  WorkspacesContext,
  | 'cacheDir'
  | 'claude'
  | 'codex'
  | 'config'
  | 'env'
  | 'mainRoot'
  | 'now'
  | 'place'
  | 'repo'
  | 'uploads'
>) {
  const draftFile = join(cacheDir, 'state', repo.id, 'start-draft.json');

  /** Check commands by commit: a commit's files never change. */
  const checks = new Map<string, Promise<CheckGuess | null>>();

  const ops: Pick<Workspaces, 'options' | 'draft' | 'saveDraft' | 'saveDocument' | 'check'> = {
    async options() {
      const [refs, claudeCode, codexAgent] = await Promise.all([listRefs(repo), claude(), codex()]);
      const where = await place();
      const {
        branchPrefixes,
        worktrees,
        permissionMode,
        agent: first,
        model: projectModel,
      } = config();
      const apiKey = Boolean(env.ANTHROPIC_API_KEY);
      const agents: AgentOption[] = [];
      if (claudeCode) {
        const [account, levels, models] = await Promise.all([
          claudeCode.account(),
          effortsOf({ kind: 'claude', claude: claudeCode }),
          claudeCode.models(),
        ]);
        // Its levels on the model it starts on without a pick: the project's, else its own.
        const efforts = levelsOn(models, projectModel, levels);
        agents.push({
          kind: 'claude',
          command: claudeCode.command,
          ...(account ? { account } : {}),
          ...(apiKey ? { apiKey } : {}),
          permissionMode,
          ...(efforts ? { efforts } : {}),
          ...(models ? { models } : {}),
          ...(projectModel ? { defaultModel: { id: projectModel, by: 'project' as const } } : {}),
        });
      }
      if (codexAgent) {
        const [account, efforts, listed] = await Promise.all([
          codexAgent.account(),
          effortsOf({ kind: 'codex', codex: codexAgent }),
          codexAgent.models(),
        ]);
        agents.push({
          kind: 'codex',
          command: codexAgent.command,
          ...(account ? { account } : {}),
          ...(efforts ? { efforts } : {}),
          ...(listed ? { models: listed.models } : {}),
          ...(listed?.default
            ? { defaultModel: { id: listed.default, by: 'agent' as const } }
            : {}),
        });
      }
      // The default first: `agent.kind`, else Claude Code, else Codex (decision 132).
      agents.sort((a, b) => Number(b.kind === first) - Number(a.kind === first));
      return {
        base: await workspaceBase(repo, refs),
        branches: await startBranches(repo, refs),
        branchPrefixes,
        kinds: workKinds(),
        worktrees: join(dirname(worktreeFolder(mainRoot(where), 'x', worktrees)), '<branch>'),
        agents,
        maxBrief: MAX_BRIEF,
        documents: {
          folder: join(symbioteFolder(where), 'documents', '<branch>'),
          maxFiles: MAX_DOCUMENTS,
          maxBytes: MAX_DOCUMENT_BYTES,
          maxTotal: MAX_DOCUMENTS_BYTES,
        },
      };
    },

    async draft() {
      try {
        const value = JSON.parse(await readFile(draftFile, 'utf8')) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
      } catch {
        // none yet, or not JSON
      }
      return {};
    },

    async saveDraft(value) {
      await writeFileWhole(draftFile, `${JSON.stringify(value)}\n`);
    },

    saveDocument(name, bytes) {
      return saveUpload(uploads, name, bytes, now);
    },

    async check(at) {
      if (!FULL_SHA.test(at))
        throw new WorkspaceRefused(`the commit must be a full SHA: ${at}`, 400);
      if (!(await isCommit(repo, at))) throw new WorkspaceRefused(`not a commit: ${at}`, 400);
      let guess = checks.get(at);
      if (!guess) {
        guess = treeAt(repo, at).then(guessCheck);
        checks.set(at, guess);
      }
      return guess;
    },
  };
  return { ops };
}
