// Start's "What happens next" (V93, decision 883; proof 06-start): the steps a workspace goes
// through from the choices on the page, the person's in violet. Pure: `test/start-next.test.ts`.
import type { WorkKind } from '@symbiote/core';

export interface NextStep {
  icon: 'pencil' | 'bell' | 'eye' | 'merge';
  words: string;
  /** The state it shows as in the sidenav, after the words. */
  turn?: string;
  /** The person's step: its icon violet. */
  you?: true;
}

/** What happens once the workspace starts: planned or not, a spike or not, with an agent or not. */
export function whatHappensNext({
  planFirst,
  into,
  kind,
  agent,
}: {
  planFirst: boolean;
  /** The branch it merges into: the one it starts from. */
  into: string;
  kind: WorkKind;
  /** An agent is found: without one, the person gives the prompt. */
  agent: boolean;
}): NextStep[] {
  if (!agent) {
    return [
      { icon: 'pencil', words: 'Symbiote makes its branch and worktree' },
      { icon: 'bell', words: 'You give an agent its prompt', you: true },
    ];
  }
  if (kind === 'spike') {
    return [
      { icon: 'pencil', words: 'The agent looks into it in its own worktree' },
      { icon: 'eye', words: 'You read its report:', turn: 'To review', you: true },
      { icon: 'merge', words: 'Nothing merges: a spike answers' },
    ];
  }
  return [
    planFirst
      ? { icon: 'pencil', words: 'The agent writes its plan in its own worktree' }
      : { icon: 'pencil', words: 'The agent works and commits in its own worktree' },
    ...(planFirst
      ? [
          {
            icon: 'bell' as const,
            words: 'You read it and answer:',
            turn: 'Waiting for you',
            you: true as const,
          },
        ]
      : []),
    { icon: 'eye', words: 'You review its commits on their graph', you: true },
    { icon: 'merge', words: `Your Approve merges it into ${into}` },
  ];
}
