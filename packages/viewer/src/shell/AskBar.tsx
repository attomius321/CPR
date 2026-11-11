import { useEffect, useState } from 'react';
import type { McpAskItem } from '@symbiote/core';
import { ClockIcon, WaitingIcon } from '../ui/icons.js';
import { Loading } from '../ui/Loading.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import {
  askedAt,
  askedBy,
  askLeft,
  askTally,
  confirmWords,
  itemState,
  lapsedWords,
  shownAsk,
} from './asks.js';
import { useNucleusName } from './names.js';
import { answerAsk, useAsks } from './useAsks.js';

/**
 * What an agent asks the person to confirm through Symbiote's MCP (MC1, decision 361): Nucleus's
 * start of a workspace, a verdict, a merge, a clean-up; a bar over every page. Confirm does it,
 * Decline does not. A batch (MC3, decisions 987, 988) lists its items, each ticked, and shows each
 * one's state as it is done; one that failed keeps the bar until Close. Unanswered after 10
 * minutes it lapses (decision 994): kept, muted, to Confirm late or Dismiss.
 */
export function AskBar() {
  const asks = useAsks();
  const nucleus = useNucleusName();
  const [now, setNow] = useState(Date.now);
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The rows the person unticked, for the ask shown; another ask starts all ticked.
  const [unticked, setUnticked] = useState<{ ask: string; items: ReadonlySet<string> }>({
    ask: '',
    items: new Set(),
  });
  const ask = shownAsk(asks);
  useEffect(() => {
    if (!ask) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, [ask]);
  if (!ask) return null;
  const out = unticked.ask === ask.id ? unticked.items : new Set<string>();
  const ticked = (ask.items ?? []).filter((item) => !item.cant && !out.has(item.id));
  const answer = (yes: boolean) => {
    setAnswering(ask.id);
    setError(null);
    answerAsk(ask.id, yes, ask.items && yes ? ticked.map((item) => item.id) : undefined)
      .catch((failure: unknown) => setError((failure as Error).message))
      .finally(() => setAnswering(null));
  };
  const toggle = (item: McpAskItem) => {
    const next = new Set(out);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    setUnticked({ ask: ask.id, items: next });
  };
  const more = asks.length - 1;
  const who = askedBy(ask, nucleus);
  const busy = answering !== null;
  const lapsed = ask.stage === 'lapsed';
  const icon = lapsed ? <ClockIcon /> : <WaitingIcon />;
  const said = !ask.stage
    ? `${who} asks:`
    : lapsed
      ? `${who} asked at ${askedAt(ask)}:`
      : `${who} asked:`;
  const left = lapsed ? (
    <span className="ask-left ask-lapsed">{lapsedWords(ask)}</span>
  ) : ask.stage ? (
    askTally(ask) && <span className="ask-left ask-tally">{askTally(ask)}</span>
  ) : (
    <span className="ask-left">{askLeft(ask, now)}</span>
  );
  const actions =
    ask.stage === 'done' ? (
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => answer(false)}
      >
        Close
      </button>
    ) : ask.stage === 'doing' && !ask.items ? null : (
      <>
        <button
          type="button"
          className="button ghost"
          disabled={busy || ask.stage === 'doing'}
          onClick={() => answer(false)}
        >
          {lapsed ? 'Dismiss' : ask.items ? 'Decline all' : 'Decline'}
        </button>
        <button
          type="button"
          className="button"
          disabled={
            busy || ask.stage === 'doing' || (ask.items !== undefined && ticked.length === 0)
          }
          onClick={() => answer(true)}
        >
          {confirmWords(ask, ticked.length)}
        </button>
      </>
    );
  const label = `${who} ${ask.stage ? 'asked' : 'asks'}`;

  if (!ask.items) {
    // One action: one line, as since MC1.
    return (
      <section
        className={`ask-bar${lapsed ? ' lapsed' : ''}`}
        aria-label={label}
        aria-live="polite"
      >
        {icon}
        <p className="ask-words">
          <span className="ask-who">{said}</span> {ask.words}
        </p>
        {ask.stage === 'doing' ? <Loading inline>Doing it</Loading> : left}
        {more > 0 && <span className="ask-more">{more} more after it</span>}
        {actions && <div className="ask-actions">{actions}</div>}
        {ask.failed && <p className="ask-error error">Failed: {ask.failed}</p>}
        {error && <p className="ask-error error">{error}</p>}
      </section>
    );
  }

  const answered = ask.stage === 'doing' || ask.stage === 'done';
  return (
    <section
      className={`ask-bar ask-batch${lapsed ? ' lapsed' : ''}`}
      aria-label={label}
      aria-live="polite"
    >
      <div className="ask-head">
        {icon}
        <p className="ask-words">
          <span className="ask-who">{said}</span> {ask.words}
        </p>
        {left}
        {more > 0 && <span className="ask-more">{more} more after it</span>}
        {actions && <div className="ask-actions">{actions}</div>}
      </div>
      <ul className="ask-items">
        {ask.items.map((item) => {
          const state = answered ? itemState(ask.tool, item) : null;
          const off = !answered && (item.cant !== undefined || out.has(item.id));
          const why = item.error ?? (answered && item.outcome !== 'cant' ? undefined : item.cant);
          return (
            <li
              key={item.id}
              className={`ask-item${off && !item.cant ? ' out' : ''}${item.cant && !answered ? ' cant' : ''}`}
            >
              <label>
                {state ? (
                  <StatusLabel tone={state.tone} className="ask-item-state">
                    {state.word}
                  </StatusLabel>
                ) : answered ? (
                  <span className="ask-item-state" />
                ) : (
                  <input
                    type="checkbox"
                    checked={!off}
                    disabled={busy || item.cant !== undefined}
                    onChange={() => toggle(item)}
                  />
                )}
                <span className="ask-item-branch">{item.name}</span>
                <span className="ask-item-words">{item.words}</span>
                {why && (
                  <span className="ask-item-why">
                    {item.outcome === 'failed' ? why : `Can’t: ${why}`}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {!answered && ticked.length < ask.items.filter((i) => !i.cant).length && (
        <p className="ask-note">Unticked ones are declined when you confirm.</p>
      )}
      {lapsed && (
        <p className="ask-note">Confirm now and Symbiote checks each one again, then does it.</p>
      )}
      {error && <p className="ask-error error">{error}</p>}
    </section>
  );
}
