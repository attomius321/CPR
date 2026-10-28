// Suggested settings on the start page (V75): a press of the head's button asks the picked agent's
// small model to size the brief (decision 549); its proposal, a card of the run's while it is
// open, changes the Model, Effort and Plan first cards only when accepted (decision 548). At rest
// nothing is added to the run: its seven cards fill a 1,000 px window (V63), 9 px to spare.
import type { AgentKind, AgentOption, SuggestRequest, WorkspaceSuggestion } from '@symbiote/core';
import { useEffect, useRef, useState } from 'react';
import { Help } from '../ui/Help.js';
import { postJson } from '../ui/http.js';
import { SparklesIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';
import { StartCard } from './StartCard.js';
import { proposalWords, withProposal } from './suggest.js';
import type { RunChoices } from './workspaces.js';

/** Where a suggestion is: none asked, asked, proposed, or failed with the server's words. */
export type Asked =
  | { state: 'idle' }
  | { state: 'asking' }
  | { state: 'proposed'; suggestion: WorkspaceSuggestion }
  | { state: 'failed'; error: string };

/**
 * A suggestion for the agent of `kind`: asked on a press, closed by the person, and closed when
 * another agent is picked, since its models are the other's. An answer to an earlier press, or
 * for another agent, is dropped.
 */
export function useSuggestion(kind: AgentKind | undefined): {
  asked: Asked;
  ask: (request: SuggestRequest) => Promise<void>;
  close: () => void;
} {
  const [asked, setAsked] = useState<Asked>({ state: 'idle' });
  const press = useRef(0);
  useEffect(() => {
    press.current += 1;
    setAsked({ state: 'idle' });
  }, [kind]);
  return {
    asked,
    ask: async (request) => {
      const n = ++press.current;
      setAsked({ state: 'asking' });
      try {
        const suggestion = await postJson<WorkspaceSuggestion>('/api/workspaces/suggest', request);
        if (press.current === n) setAsked({ state: 'proposed', suggestion });
      } catch (failed) {
        if (press.current === n) setAsked({ state: 'failed', error: (failed as Error).message });
      }
    },
    close: () => {
      press.current += 1;
      setAsked({ state: 'idle' });
    },
  };
}

/** The head's Suggest settings: secondary, its spinner while the advisor runs. */
export function SuggestButton({
  asking,
  blocked,
  onPress,
}: {
  asking: boolean;
  /** Why it waits (`suggestBlocked`), or null. */
  blocked: string | null;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className="button secondary start-suggest"
      disabled={blocked !== null || asking}
      {...tip(
        blocked ?? 'Ask a small model to size the brief: a model, an effort level and plan first',
      )}
      onClick={onPress}
    >
      {asking ? <span className="state-dot tone-working" aria-hidden="true" /> : <SparklesIcon />}
      {asking ? 'Suggesting…' : 'Suggest settings'}
    </button>
  );
}

/** The proposal's card, while a suggestion is asked, proposed or failed; nothing otherwise. */
export function SuggestionCard({
  asked,
  agent,
  run,
  current,
  onChoose,
  onClose,
}: {
  asked: Asked;
  agent: AgentOption | null;
  run: RunChoices;
  /** What the Model, Effort and Plan first cards hold now. */
  current: { model?: string | undefined; effort?: string | undefined; planFirst: boolean };
  onChoose: (run: RunChoices) => void;
  onClose: () => void;
}) {
  if (asked.state === 'idle' || !agent) return null;
  const proposal =
    asked.state === 'proposed'
      ? { suggestion: asked.suggestion, ...proposalWords(asked.suggestion, agent, current) }
      : null;
  return (
    <StartCard
      icon={<SparklesIcon />}
      title="Suggested settings"
      help={
        <Help label="About suggested settings">
          <p>
            Your agent&apos;s small model read the brief: Haiku 5.5 for Claude Code, GPT-6 Luna for
            Codex. It proposes a model, an effort level and whether to plan first. Your cards change
            only if you press Use these settings.
          </p>
          <p>Its instructions are in Settings, under Prompts: Suggest settings.</p>
        </Help>
      }
    >
      <div className="start-proposal" aria-live="polite">
        {asked.state === 'asking' && <p className="start-proposal-why">Reading the brief…</p>}
        {proposal && (
          <>
            <p className="start-proposal-words">{proposal.words}</p>
            <p className="start-proposal-why">{proposal.suggestion.why}</p>
            {proposal.same && (
              <p className="start-proposal-why">The cards already hold these settings.</p>
            )}
          </>
        )}
        {asked.state === 'failed' && <p className="error">No suggestion: {asked.error}</p>}
        {asked.state !== 'asking' && (
          <div className="start-proposal-actions">
            {proposal && !proposal.same && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  onChoose(withProposal(run, proposal.suggestion, agent));
                  onClose();
                }}
              >
                Use these settings
              </button>
            )}
            <button type="button" className="button ghost" onClick={onClose}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </StartCard>
  );
}
