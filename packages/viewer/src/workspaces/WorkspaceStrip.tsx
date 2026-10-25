// The strip under a workspace's heading (V48), only when its state asks something of the person:
// a waiting agent's question and the way to answer it, or a failure and where to read it.
import { WaitingIcon } from '../ui/icons.js';
import { AGENT_NAMES, type WorkspaceRow } from './workspaces.js';

export function WorkspaceStrip({
  row: { workspace, next },
  waiting,
  onRespond,
  onThread,
  onNext,
}: {
  row: WorkspaceRow;
  /** The other workspaces whose agent waits, in the sidenav's order. */
  waiting: string[];
  onRespond: () => void;
  onThread: () => void;
  onNext: (branch: string) => void;
}) {
  const [after] = waiting;
  if (next.group === 'waiting') {
    return (
      <section className="workspace-strip strip-waiting" aria-label="Waiting for you">
        <WaitingIcon />
        <p className="workspace-strip-text" title={next.blocked ?? next.text}>
          {next.blocked ?? next.text}
        </p>
        {/* The page's one primary: Review's, when the branch has commits. */}
        <button
          type="button"
          className={workspace.ahead > 0 ? 'button secondary' : 'button primary'}
          onClick={onRespond}
        >
          Respond
        </button>
        {after && (
          <button
            type="button"
            className="button ghost"
            title={`${after}: ${waiting.length} other${waiting.length === 1 ? '' : 's'} waiting`}
            onClick={() => onNext(after)}
          >
            Next waiting ({waiting.length})
          </button>
        )}
      </section>
    );
  }
  if (next.chip.tone === 'failed' && next.group === 'stopped') {
    const agent = workspace.agent.kind ? AGENT_NAMES[workspace.agent.kind] : 'Its agent';
    // Its words when it gave any; else where to look: its thread ends with what it last did.
    const why =
      workspace.agent.error ??
      (workspace.tip === null
        ? next.text
        : `${agent} says its session failed. Its thread has its last report and how it ended.`);
    return (
      <section className="workspace-strip strip-failed" aria-label="Its agent failed">
        <p className="workspace-strip-text" title={why}>
          {why}
        </p>
        <button type="button" className="button ghost" onClick={onThread}>
          Read its thread
        </button>
      </section>
    );
  }
  return null;
}
