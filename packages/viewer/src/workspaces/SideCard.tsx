// A workspace's side card (V29d, V89, V93; proof 02): its changes, its facts, what its agent and
// shells do now, or Hive's run.
import type { Dispatch, SetStateAction } from 'react';
import type { WorkspaceHiveDetail, WorkspaceShell, WorkspaceSummary } from '@symbiote/core';
import { ChangesPanel, type useChanges } from './ChangesPanel.js';
import { RunFacts } from './RunFacts.js';
import type { View } from './WorkspaceTabs.js';
import { briefFirst } from './workspace-words.js';
import { Fragment } from 'react';
import { Since } from './HeadSteps.js';
import { barOf } from './terminal-bar.js';
import { AGENT_NAMES } from './workspaces.js';
import type { WorkspaceRow } from './workspace-groups.js';
import { runsOnWords } from './run-choices.js';
import { shellName } from './shells.js';

/**
 * The workspace's facts (V93, proof 02): its kind, agent, model and plan first. Its permissions
 * are not in the list's summary: not shown.
 */
export function FactsSection({ workspace }: { workspace: WorkspaceSummary }) {
  const { agent } = workspace;
  const runs = runsOnWords(agent);
  return (
    <section className="changes-section changes-now" aria-label="Workspace">
      <h2>Workspace</h2>
      <dl className="changes-facts">
        {workspace.kind && (
          <>
            <dt>Kind</dt>
            <dd>{workspace.kind.charAt(0).toUpperCase() + workspace.kind.slice(1)}</dd>
          </>
        )}
        {agent.kind && (
          <>
            <dt>Agent</dt>
            <dd>{AGENT_NAMES[agent.kind]}</dd>
          </>
        )}
        {runs && (
          <>
            <dt>Model</dt>
            <dd>{runs.text}</dd>
          </>
        )}
        <dt>Plan first</dt>
        <dd data-tone={workspace.planFirst && agent.state === 'plan-ready' ? 'you' : undefined}>
          {workspace.planFirst
            ? agent.state === 'plan-ready'
              ? 'on, waits for your OK'
              : 'on'
            : 'off'}
        </dd>
      </dl>
    </section>
  );
}

/**
 * The side card's first section (V89, decision 832): what the agent does now and since when, and
 * what runs in its shells; nothing while neither.
 */
export function NowSection({
  row: { workspace, next },
  bar,
  shells,
}: {
  row: WorkspaceRow;
  bar: ReturnType<typeof barOf>;
  shells: WorkspaceShell[];
}) {
  const { agent } = workspace;
  const live = ['working', 'needs-you', 'plan-ready'].includes(agent.state);
  if (!live && shells.length === 0) return null;
  const since = workspace.activity?.since;
  return (
    <section className="changes-section changes-now" aria-label="What its agent does">
      <h2>Now</h2>
      <dl className="changes-facts">
        {live && (
          <>
            <dt>{agent.kind ? AGENT_NAMES[agent.kind] : 'Agent'}</dt>
            <dd data-tone={bar.tone}>
              {agent.state === 'working' ? (next.doing ?? 'Working') : bar.text}
            </dd>
            {since && (
              <>
                <dt>{agent.state === 'working' ? 'Working' : 'Waiting'}</dt>
                <dd>
                  <Since since={since} />
                  {workspace.activity?.tools
                    ? ` · ${workspace.activity.tools} tool call${workspace.activity.tools === 1 ? '' : 's'}`
                    : ''}
                </dd>
              </>
            )}
          </>
        )}
        {shells.map((one) => (
          <Fragment key={one.id}>
            <dt>{shellName(one.number)}</dt>
            <dd className="mono">{one.running}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

/** The side card beside the sessions: the branch's changes, then the page's facts or Hive's run. */
export function SideCard({
  branch,
  version,
  changes,
  setPicks,
  showPipeline,
  view,
  row,
  hive,
  bar,
  shells,
  setSaid,
}: {
  branch: string;
  version: unknown;
  changes: ReturnType<typeof useChanges>;
  /** Bumped when a base is picked: the changes are read again. */
  setPicks: Dispatch<SetStateAction<number>>;
  showPipeline: boolean;
  view: View;
  row: WorkspaceRow;
  hive: { detail: WorkspaceHiveDetail | null };
  bar: ReturnType<typeof barOf>;
  shells: WorkspaceShell[] | null;
  setSaid: Dispatch<SetStateAction<string | null>>;
}) {
  const { workspace } = row;
  const shellsRunning = (shells ?? []).filter((one) => one.running);
  const doing = workspace.activity?.doing;
  const editing = doing && 'tool' in doing ? doing.subject : undefined;
  return (
    <ChangesPanel
      branch={branch}
      version={version}
      changes={changes}
      onPicked={() => setPicks((n) => n + 1)}
      editing={editing}
      // Outside the terminal view, the proof's facts and files (V93, proof 02).
      page={showPipeline && view !== 'run'}
      run={view === 'run'}
      facts={<FactsSection workspace={workspace} />}
      brief={briefFirst(workspace.brief)}
      now={
        view === 'run' ? (
          <RunFacts workspace={workspace} detail={hive.detail} />
        ) : (
          <NowSection row={row} bar={bar} shells={shellsRunning} />
        )
      }
      onSaid={setSaid}
    />
  );
}
