import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AgentKind, ScoutConversation, ScoutEfforts, ScoutState } from '@symbiote/core';
import { AgentTerminal } from '../workspaces/AgentTerminal.js';
import { scoutLevel } from '../workspaces/effort.js';
import { EffortStepper } from '../workspaces/EffortStepper.js';
import { Help } from '../ui/Help.js';
import { getJson, postJson } from '../ui/http.js';
import { scoutStateText } from './scout.js';
import {
  readWorkspacesAgain,
  reloadWorkspaces,
  useWorkspaces,
} from '../workspaces/useWorkspaces.js';
import { effortChoices } from '../workspaces/workspaces.js';

const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' };

/** The last part of a folder's path: the checkout's name. */
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** The state's tone, as the workspaces' dots draw it. */
function toneOf(conversation: ScoutConversation): string {
  switch (conversation.state) {
    case 'working':
      return 'tone-working';
    case 'needs-you':
    case 'interrupted':
      return 'tone-waiting';
    case 'answered':
      return 'tone-done';
    case 'failed':
    case 'gone':
      return 'tone-failed';
    default:
      return '';
  }
}

/** How to reach the conversation from a terminal of one's own, where Symbiote runs none. */
const attachCommand = (conversation: ScoutConversation) =>
  conversation.kind === 'claude'
    ? `claude attach ${conversation.id ?? ''}`
    : `codex resume ${conversation.id ?? ''}`;

/**
 * Scout (V35): a read-only agent in the checkout, asked from here. With no conversation, the
 * question box; with one, the agent's own terminal, where its answer is and the person asks more
 * (the box where no terminal runs). New conversation starts over.
 */
export function ScoutPage() {
  const { scout } = useWorkspaces();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<AgentKind | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The levels and the project's, read for a new conversation; the level picked for it (null: none
  // picked, the project's).
  const [efforts, setEfforts] = useState<ScoutEfforts | null>(null);
  const [level, setLevel] = useState<string | null>(null);

  const conversation = scout?.conversation ?? null;
  const agents = scout?.agents ?? [];
  const live = conversation !== null && conversation.state !== 'gone';
  const terminal = live && scout?.terminal?.available === true;
  const agent = conversation?.kind ?? (picked || agents[0]?.kind);
  // Known only once read: until then a question can be asked, and the server answers.
  const none = scout !== null && agents.length === 0;
  const levels = efforts?.agents.find((a) => a.kind === agent);
  const choices = !live && levels ? effortChoices(levels) : [];
  const effort = levels ? scoutLevel(level, efforts?.effort, levels) : '';

  // Read where the stepper shows, for each new conversation: the project's level may have changed.
  const asking = scout !== null && !live && !none;
  useEffect(() => {
    if (!asking) return;
    let current = true;
    getJson<ScoutEfforts>('/api/scout/efforts')
      .then((read) => {
        if (current) setEfforts(read);
      })
      .catch(() => {
        // No levels: no stepper, and the question starts at the project's level or the agent's.
        if (current) setEfforts(null);
      });
    return () => {
      current = false;
    };
  }, [asking]);

  /** Runs a write, then reads Scout's state again before the page goes on. */
  const act = (task: () => Promise<ScoutState>, after?: () => void) => {
    setBusy(true);
    setError(null);
    task()
      .then(async () => {
        after?.();
        setEnded(null);
        await readWorkspacesAgain();
      })
      .catch((e: unknown) => {
        setError((e as Error).message);
        void reloadWorkspaces();
      })
      .finally(() => setBusy(false));
  };

  const ask = (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() === '' || busy) return;
    act(
      () =>
        postJson<ScoutState>('/api/scout/ask', {
          text,
          ...(picked && !live ? { agent: picked } : {}),
          // Null: the agent's own, even where the project names a level.
          ...(choices.length > 0 ? { effort: effort || null } : {}),
        }),
      () => {
        setText('');
        setLevel(null);
      },
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    ask();
  };

  return (
    <section className="scout-page" aria-labelledby="scout-title">
      <header className="scout-top">
        <h1 id="scout-title">Scout</h1>
        {scout && (
          <p className="scout-about" title={scout.checkout}>
            Read-only in {folderName(scout.checkout)} as it is now
            {agent ? `, with ${AGENT_NAMES[agent]}` : ''}
            {conversation?.effort ? ` at ${conversation.effort} effort` : ''}
          </p>
        )}
        <div className="scout-actions">
          {conversation && (
            <span className="scout-state" role="status">
              <span className={`state-dot ${toneOf(conversation)}`} aria-hidden="true" />
              {scoutStateText(conversation)}
            </span>
          )}
          {conversation && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              title="Ends this conversation: its session is stopped and removed"
              onClick={() => act(() => postJson<ScoutState>('/api/scout/new', {}))}
            >
              New conversation
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="error scout-error" role="alert">
          {error}
        </p>
      )}
      {terminal ? (
        <div className="scout-terminal workspace-terminal">
          <AgentTerminal
            key={attempt}
            url="/api/scout/terminal"
            onOpened={() => {}}
            onEnded={setEnded}
          />
          {ended && (
            <p className="workspace-confirm">
              The terminal {ended === 'exited' ? 'ended' : 'lost its session'}.{' '}
              <button
                type="button"
                className="button"
                onClick={() => {
                  setEnded(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Open again
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="scout-body">
          <form className="scout-ask" onSubmit={ask}>
            <span className="field-label">
              <label htmlFor="scout-question">Ask Scout</label>
              <Help label="About Scout">
                <p>
                  Where something is decided, why it works this way, what touches it. Scout reads
                  the files and git&apos;s history of this checkout and changes nothing; work it
                  finds goes through a workspace.
                </p>
                <p>
                  <kbd>Enter</kbd> asks; <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line.
                </p>
              </Help>
            </span>
            {none && (
              <p className="scout-note">
                Scout needs Claude Code or Codex: neither is installed here.
              </p>
            )}
            {conversation?.state === 'gone' && (
              <p className="scout-note">
                Its last session is gone (removed outside Symbiote): a question starts a new
                conversation.
              </p>
            )}
            {live && !terminal && (
              <p className="scout-note">
                No terminal here
                {scout?.terminal && !scout.terminal.available ? ` (${scout.terminal.reason})` : ''}:
                Scout's answers are in its session, <code>{attachCommand(conversation)}</code> in a
                terminal of yours. A question here continues it.
              </p>
            )}
            <textarea
              id="scout-question"
              rows={4}
              value={text}
              placeholder="Where is the merger's prompt defined?"
              disabled={none}
              autoFocus
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {choices.length > 0 && (
              <div className="scout-effort">
                <span className="scout-effort-label field-label">
                  Effort
                  <Help label="About the effort">
                    The level this conversation starts at; Settings sets the one each starts at.
                  </Help>
                </span>
                <EffortStepper
                  label="Effort"
                  choices={choices}
                  value={effort}
                  onChange={setLevel}
                />
              </div>
            )}
            <div className="scout-ask-row">
              {agents.length > 1 && !live && (
                <select
                  aria-label="Agent"
                  value={picked || agents[0]?.kind}
                  onChange={(event) => setPicked(event.target.value as AgentKind)}
                >
                  {agents.map((a) => (
                    <option key={a.kind} value={a.kind}>
                      {AGENT_NAMES[a.kind]}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="submit"
                className="button"
                disabled={busy || none || text.trim() === ''}
              >
                Ask
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
