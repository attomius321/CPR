// The Activity tab's live strip (V73, decision 516): what the agent does now — the phase on its
// tile in its colour (V74), its words for the call running, the command — and for how long, from
// the call's recorded start. A spinner while it works; still while it waits. No progress: none is
// recorded.
import { useSeconds } from '../clock.js';
import type { LiveActivity } from './live.js';
import { elapsedText } from './words.js';
import { tip } from '../../ui/tip.js';
import { PhaseTile } from './GroupRow.js';

/** How long since `since`, as a clock; its own component, so a tick renders it alone. */
function Elapsed({ since }: { since: string }) {
  const now = useSeconds();
  return (
    <time className="activity-live-elapsed" dateTime={since} {...tip('Since it started')}>
      {elapsedText(now - Date.parse(since))}
    </time>
  );
}

export function LiveStrip({ live }: { live: LiveActivity }) {
  const waiting = live.state === 'waiting';
  const head = live.phase ?? (waiting ? 'Waiting' : live.state === 'thinking' ? null : 'Working');
  return (
    <section className={`activity-live ${live.state}`} aria-label="Now">
      <span
        className={`state-dot ${waiting ? 'tone-waiting' : 'tone-working'}`}
        aria-hidden="true"
      />
      {live.kind && <PhaseTile kind={live.kind} />}
      <span className="activity-live-words">
        {head && <span className="activity-live-phase">{head}</span>}
        <span className="activity-live-text" {...tip(live.text)}>
          {live.text}
        </span>
        {live.command && live.command !== live.text && (
          <code className="activity-live-command" {...tip(live.command, { code: true })}>
            {live.command}
          </code>
        )}
      </span>
      {live.since && <Elapsed since={live.since} />}
    </section>
  );
}
