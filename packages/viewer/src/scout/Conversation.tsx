import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentKind, ScoutConversation, ScoutEfforts, ScoutState } from '@symbiote/core';
import { AgentTerminal } from '../workspaces/AgentTerminal.js';
import { scoutLevel } from '../workspaces/effort.js';
import { EffortStepper } from '../workspaces/EffortStepper.js';
import { Help } from '../ui/Help.js';
import { getJson, postJson } from '../ui/http.js';
import { scoutStateText } from './scout.js';
import { readWorkspacesAgain, reloadWorkspaces } from '../workspaces/useWorkspaces.js';
import { effortChoices } from '../workspaces/workspaces.js';

export const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' };

/** The last part of a folder's path: the checkout's name. */
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** The state's tone, as the workspaces' dots draw it. */
export function toneOf(conversation: ScoutConversation): string {
  switch (conversation.state) {
    case 'working':
      return 'tone-working';
    case 'needs-you':
    case 'interrupted':
      return 'tone-waiting';
    case 'answered':
    case 'ready':
      return 'tone-done';
    case 'failed':
    case 'gone':
      return 'tone-failed';
    default:
      return '';
  }
}

/** How to reach the conversation from a terminal of one's own, where Symbiote runs none. */
export const attachCommand = (conversation: ScoutConversation) =>
  conversation.kind === 'claude'
    ? `claude attach ${conversation.id ?? ''}`
    : `codex resume ${conversation.id ?? ''}`;

/** A page's agent as its conversation shows it: Scout's page (V35), Scribe's pane (V41). */
export interface ConversationAgent {
  name: string;
  /** Its API: `/api/scout`, `/api/scribe`. */
  api: string;
  /** Its state, read with the workspaces. */
  state: ScoutState | null;
  /** The root's class (`scout-page`: the shell's `a` looks for its box) and its heading's level. */
  className: string;
  heading: 'h1' | 'h2';
  /** What it does where, before the checkout's name: "Read-only in", "Writes skills in". */
  doing: string;
  /** The box's label, help, placeholder and button. */
  label: string;
  help: ReactNode;
  placeholder: string;
  submit: string;
  /** What the person sends it ("question", "request"), and what its effort's help says. */
  noun: string;
  effortHelp: string;
  /** Text put in the box from outside (Improve with Scribe), new each time `at` changes. */
  draft?: { text: string; at: number };
}

/**
 * A page's agent: with no conversation, the box (the agent, its effort); with one, the agent's own
 * terminal, where its answer is and the person goes on (the box where no terminal runs). New
 * conversation starts over.
 */
export function Conversation({ agent: own }: { agent: ConversationAgent }) {
  const { name, api, state: read } = own;
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<AgentKind | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The levels and the project's, read for a new conversation; the level picked for it (null: none
  // picked, the project's).
  const [efforts, setEfforts] = useState<ScoutEfforts | null>(null);
  const [level, setLevel] = useState<string | null>(null);

  const draft = own.draft;
  useEffect(() => {
    if (draft) setText(draft.text);
  }, [draft]);

  const conversation = read?.conversation ?? null;
  const agents = read?.agents ?? [];
  const live = conversation !== null && conversation.state !== 'gone';
  const terminal = live && read?.terminal?.available === true;
  const agent = conversation?.kind ?? (picked || agents[0]?.kind);
  // Known only once read: until then a request can be made, and the server answers.
  const none = read !== null && agents.length === 0;
  const levels = efforts?.agents.find((a) => a.kind === agent);
  const choices = !live && levels ? effortChoices(levels) : [];
  const effort = levels ? scoutLevel(level, efforts?.effort, levels) : '';

  // Read where the stepper shows, for each new conversation: the project's level may have changed.
  const asking = read !== null && !live && !none;
  useEffect(() => {
    if (!asking) return;
    let current = true;
    getJson<ScoutEfforts>(`${api}/efforts`)
      .then((answer) => {
        if (current) setEfforts(answer);
      })
      .catch(() => {
        // No levels: no stepper, and the request starts at the project's level or the agent's.
        if (current) setEfforts(null);
      });
    return () => {
      current = false;
    };
  }, [asking, api]);

  /** Runs a write, then reads the agent's state again before the page goes on. */
  const act = (task: () => Promise<ScoutState>, after?: () => void) => {
    setBusy(true);
    setError(null);
    task()
      .then(async () => {
        after?.();
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
        postJson<ScoutState>(`${api}/ask`, {
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

  const Heading = own.heading;
  const id = `${own.className}-title`;
  const field = `${own.className}-question`;
  return (
    <section className={own.className} aria-labelledby={id}>
      <header className="scout-top">
        <Heading id={id}>{name}</Heading>
        {read && (
          <p className="scout-about" title={read.checkout}>
            {own.doing} {folderName(read.checkout)}
            {agent ? `, with ${AGENT_NAMES[agent]}` : ''}
            {conversation?.model ? ` on ${conversation.model}` : ''}
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
              onClick={() => act(() => postJson<ScoutState>(`${api}/new`, {}))}
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
        <ConversationTerminal api={api} />
      ) : (
        <div className="scout-body">
          <form className="scout-ask" onSubmit={ask}>
            <span className="field-label">
              <label htmlFor={field}>{own.label}</label>
              <Help label={`About ${name}`}>{own.help}</Help>
            </span>
            {none && (
              <p className="scout-note">
                {name} needs Claude Code or Codex: neither is installed here.
              </p>
            )}
            {conversation?.state === 'gone' && (
              <p className="scout-note">
                Its last session is gone (removed outside Symbiote): a {own.noun} starts a new
                conversation.
              </p>
            )}
            {live && !terminal && (
              <p className="scout-note">
                No terminal here
                {read?.terminal && !read.terminal.available
                  ? ` (${read.terminal.reason})`
                  : ''}: {name}&apos;s answers are in its session,{' '}
                <code>{attachCommand(conversation)}</code> in a terminal of yours. A {own.noun} here
                continues it.
              </p>
            )}
            <textarea
              id={field}
              rows={4}
              value={text}
              placeholder={own.placeholder}
              disabled={none}
              autoFocus
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {choices.length > 0 && (
              <div className="scout-effort">
                <span className="scout-effort-label field-label">
                  Effort
                  <Help label="About the effort">{own.effortHelp}</Help>
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
                {own.submit}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

/**
 * A page agent's terminal edge to edge (V35), opened on its session; "Open again" when it ends.
 * `quiet`: an end not said, while the page itself ends the session (Scout's move, V50).
 */
export function ConversationTerminal({ api, quiet = false }: { api: string; quiet?: boolean }) {
  const [ended, setEnded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="scout-terminal workspace-terminal">
      <AgentTerminal key={attempt} url={`${api}/terminal`} onOpened={() => {}} onEnded={setEnded} />
      {ended && !quiet && (
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
  );
}
