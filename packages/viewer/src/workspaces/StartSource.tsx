// Start's Source card (V33; V93, proof 06): where the workspace starts from and its branch; in
// Hive mode its agent's rows too ("Where and who").
import type { AgentOption, WorkspaceOptions } from '@symbiote/core';
import { ShuffleIcon } from '../ui/icons.js';
import { shortSha } from '../history/commits.js';
import { tip } from '../ui/tip.js';
import type { BriefForm } from './brief.js';
import type { effortChoices, modelChoices, RunChoices } from './run-choices.js';
import { StartAgentRows } from './StartAgent.js';
import { StartFrom } from './StartFrom.js';

/**
 * Where it starts (V33): a branch at its tip, or the row's commit `at`; the branch, named after
 * the title until edited, and where its worktree goes.
 */
export function StartSource({
  hive,
  options,
  at,
  base,
  run,
  choose,
  setOnCommit,
  form,
  edit,
  branch,
  problem,
  agent,
  model,
  models,
  effort,
  efforts,
}: {
  hive: boolean;
  options: Pick<WorkspaceOptions, 'branches' | 'worktrees'>;
  at: string | undefined;
  base: { sha: string; from?: string };
  run: RunChoices;
  choose: (next: RunChoices) => void;
  /** The row's commit picked (no branch), or a branch. */
  setOnCommit: (onCommit: boolean) => void;
  form: BriefForm;
  edit: (next: BriefForm) => void;
  branch: string;
  problem: string | null;
  agent: AgentOption | null;
  model: string | undefined;
  models: ReturnType<typeof modelChoices>;
  effort: string | undefined;
  efforts: ReturnType<typeof effortChoices>;
}) {
  const folder = options.worktrees.replace('<branch>', branch.replaceAll('/', '-'));
  return (
    <section
      className={hive ? 'start-card start-hive-who' : 'start-card start-source'}
      aria-labelledby="start-source-title"
    >
      <div className="card-head">
        <h2 id="start-source-title">{hive ? 'Where and who' : 'Source'}</h2>
      </div>
      <div className="start-rows">
        <label id="start-from-label" htmlFor="start-from">
          Starts from
        </label>
        <StartFrom
          id="start-from"
          labelId="start-from-label"
          branches={options.branches}
          at={at}
          value={base.from ?? ''}
          onPick={(name) => {
            setOnCommit(name === '');
            if (name !== '') choose({ ...run, from: name });
          }}
        />
        <label htmlFor="start-branch">Branch</label>
        <div className="start-branch workspace-field">
          <input
            id="start-branch"
            type="text"
            aria-label="Branch name"
            autoComplete="off"
            value={branch}
            spellCheck={false}
            aria-invalid={form.title.trim() !== '' && problem !== null}
            {...tip(
              `Will be created from ${base.from ? `${base.from} at` : 'the commit'} ${shortSha(base.sha)} as ${branch}\nIts worktree: ${folder}`,
              { code: true },
            )}
            onChange={(event) => edit({ ...form, branch: event.target.value })}
          />
          {form.branch !== null && (
            <button
              type="button"
              className="icon-button start-rename"
              aria-label="Name it after the title"
              {...tip('Name it after the title')}
              onClick={() => edit({ ...form, branch: null })}
            >
              <ShuffleIcon />
            </button>
          )}
        </div>
        {form.title.trim() !== '' && problem && <p className="error start-row-note">{problem}</p>}
        {hive && agent && (
          <StartAgentRows
            agent={agent}
            run={run}
            model={model}
            models={models}
            effort={effort}
            efforts={efforts}
            onChoose={choose}
          />
        )}
      </div>
      {/* Where it starts, for screen readers: the branch's tip says it to the pointer. */}
      <p className="start-base">
        Will be created from{' '}
        {base.from ? (
          <>
            <strong>{base.from}</strong> at
          </>
        ) : (
          'the commit'
        )}{' '}
        <code>{shortSha(base.sha)}</code> as <strong>{branch}</strong>
      </p>
    </section>
  );
}
