import { useEffect, useState } from 'react';
import { NeedsYouIcon } from '../ui/icons.js';
import { askedBy, askLeft } from './asks.js';
import { answerAsk, useAsks } from './useAsks.js';

/**
 * What an agent asks the person to confirm through Symbiote's MCP (MC1, decision 361): Scout's
 * start of a workspace, a verdict, a merge, a clean-up; on every page, above the status bar. The
 * oldest first; Confirm does it, Decline does not, and after 10 minutes the agent is told nothing
 * was done.
 */
export function Asks() {
  const asks = useAsks();
  const [now, setNow] = useState(Date.now);
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ask = asks[0];
  useEffect(() => {
    if (!ask) return;
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, [ask]);
  if (!ask) return null;
  const answer = (yes: boolean) => {
    setAnswering(ask.id);
    setError(null);
    answerAsk(ask.id, yes)
      .catch((failure: unknown) => setError((failure as Error).message))
      .finally(() => setAnswering(null));
  };
  const more = asks.length - 1;
  return (
    <section className="ask-card" aria-label={`${askedBy(ask)} asks`} aria-live="polite">
      <p className="ask-who">
        <NeedsYouIcon />
        <span>{askedBy(ask)} asks</span>
        <span className="ask-left">{askLeft(ask, now)}</span>
      </p>
      <p className="ask-words">{ask.words}</p>
      {error && <p className="ask-error error">{error}</p>}
      <div className="ask-actions">
        {more > 0 && <span className="ask-more">{more} more after it</span>}
        <button
          type="button"
          className="button ghost"
          disabled={answering !== null}
          onClick={() => answer(false)}
        >
          Decline
        </button>
        <button
          type="button"
          className="button"
          disabled={answering !== null}
          onClick={() => answer(true)}
        >
          Confirm
        </button>
      </div>
    </section>
  );
}
