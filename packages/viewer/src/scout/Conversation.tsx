import { useEffect, useState, type ReactNode } from 'react';
import type { ScoutConversation, ScoutEfforts, ScoutState } from '@symbiote/core';
import { AgentTerminal, type OpenedTerminal } from '../workspaces/AgentTerminal.js';
import { Help } from '../ui/Help.js';
import { getJson, postJson } from '../ui/http.js';
import { runsOn, scoutStateText } from './scout.js';
import { readWorkspacesAgain, reloadWorkspaces } from '../workspaces/useWorkspaces.js';
import { tip } from '../ui/tip.js';

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

/** A page agent's conversation as its page draws it (`usePageAgent`). */
export interface PageAgent {
  read: ScoutState | null;
  conversation: ScoutConversation | null;
  /** A conversation that is not gone. */
  live: boolean;
  terminals: boolean;
  /** Read, and neither Claude Code nor Codex installed. */
  none: boolean;
  busy: boolean;
  error: string | null;
  /** What it runs on, in words: "with Claude Code on Sonnet 5.5 at high effort". */
  on: string;
  /** New conversation: this one ends, the next opens. */
  renew: () => void;
  /** After a failed open: open again. */
  retry: () => void;
}

/**
 * A page agent's conversation, Scout's page and Scribe's pane alike (V78, decision 569): with
 * terminals and no conversation (or a gone one), one is opened at once with nothing asked, on
 * Settings' model and level; New conversation ends it, and the next opens the same way. A failed
 * open says why, and is tried again only on Try again. Nothing on the page picks the agent, the
 * model or the level: Settings does.
 */
export function usePageAgent(api: string, read: ScoutState | null): PageAgent {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An open was asked for while there is no conversation: asked once, until one runs or Try again.
  const [opening, setOpening] = useState(false);
  // The agents' models, read for the name of the conversation's.
  const [efforts, setEfforts] = useState<ScoutEfforts | null>(null);

  const conversation = read?.conversation ?? null;
  const agents = read?.agents ?? [];
  const live = conversation !== null && conversation.state !== 'gone';
  const terminals = read?.terminal?.available === true;
  const none = read !== null && agents.length === 0;
  const kind = conversation?.kind ?? agents[0]?.kind;

  // Read once a conversation runs on a model: its list names it.
  const model = live ? conversation.model : undefined;
  useEffect(() => {
    if (!model) return;
    let current = true;
    getJson<ScoutEfforts>(`${api}/efforts`)
      .then((answer) => {
        if (current) setEfforts(answer);
      })
      .catch(() => {
        // None read: the model said by its ID.
        if (current) setEfforts(null);
      });
    return () => {
      current = false;
    };
  }, [api, model]);

  useEffect(() => {
    if (live) {
      setOpening(false);
      setError(null);
    }
  }, [live]);

  /** Runs a write, then reads the agent's state again before the page goes on. */
  const act = (task: () => Promise<ScoutState>) => {
    setBusy(true);
    setError(null);
    return task()
      .then(() => readWorkspacesAgain())
      .catch((e: unknown) => {
        setError((e as Error).message);
        void reloadWorkspaces();
      })
      .finally(() => setBusy(false));
  };

  // With terminals and no conversation, one is opened at once, with no question.
  const open = read !== null && terminals && !none && !live && !busy && !opening && !error;
  useEffect(() => {
    if (!open) return;
    setOpening(true);
    void act(() => postJson<ScoutState>(`${api}/open`, {}));
  }, [open]);

  const models = efforts?.agents.find((a) => a.kind === kind)?.models;
  return {
    read,
    conversation,
    live,
    terminals,
    none,
    busy,
    error,
    on: kind ? runsOn(kind, live ? conversation : null, models) : '',
    renew: () => void act(() => postJson<ScoutState>(`${api}/new`, {})),
    retry: () => {
      setError(null);
      setOpening(false);
    },
  };
}

/** A failed open or New conversation, in words; Try again where a terminal would open. */
export function PageAgentError({ agent }: { agent: PageAgent }) {
  if (!agent.error) return null;
  return (
    <p className="error scout-error" role="alert">
      {agent.error}{' '}
      {agent.terminals && !agent.live && (
        <button type="button" className="button ghost" onClick={agent.retry}>
          Try again
        </button>
      )}
    </p>
  );
}

/** Its state, and New conversation: the next opens at once on Settings' (V78). */
export function PageAgentActions({ agent }: { agent: PageAgent }) {
  const { conversation } = agent;
  if (!conversation) return null;
  return (
    <>
      <span className="scout-state" role="status">
        <span className={`state-dot ${toneOf(conversation)}`} aria-hidden="true" />
        {scoutStateText(conversation)}
      </span>
      <button
        type="button"
        className="button secondary"
        disabled={agent.busy}
        {...tip(
          "Ends this conversation and starts another on Settings' model and effort\nIts session is stopped and removed",
        )}
        onClick={agent.renew}
      >
        New conversation
      </button>
    </>
  );
}

/**
 * What the card holds: the agent's terminal, "Starting…" while it opens, or why there is none.
 * A page agent runs in a terminal (V78, decision 572): where none can run, no box takes a
 * question; the page says why, and how to reach a running conversation from a terminal of one's
 * own. `typed` is put in the terminal's input, unsent, once it is open (Improve with Scribe).
 */
export function PageAgentBody({
  name,
  api,
  agent,
  typed,
  onTyped,
}: {
  name: string;
  api: string;
  agent: PageAgent;
  typed?: string;
  onTyped?: () => void;
}) {
  const { read, conversation } = agent;
  if (agent.none) {
    return (
      <div className="scout-body">
        <p className="scout-note">{name} needs Claude Code or Codex: neither is installed here.</p>
      </div>
    );
  }
  if (read && !agent.terminals) {
    const reason = read.terminal && !read.terminal.available ? `: ${read.terminal.reason}` : '';
    return (
      <div className="scout-body">
        <p className="scout-note">
          {name} runs in a terminal, and none runs here{reason}.
        </p>
        {agent.live && conversation && (
          <p className="scout-note">
            Its conversation is in its session: <code>{attachCommand(conversation)}</code> in a
            terminal of yours.
          </p>
        )}
      </div>
    );
  }
  if (agent.live && conversation) {
    return (
      <ConversationTerminal
        key={conversation.id ?? conversation.started}
        api={api}
        {...(typed === undefined ? {} : { typed })}
        {...(onTyped ? { onTyped } : {})}
      />
    );
  }
  return (
    <div className="scout-body">
      {!agent.error && read !== null && <p className="scout-starting">Starting {name}…</p>}
    </div>
  );
}

/** A page's agent besides Scout's own page: Scribe's pane (V41). */
export interface ConversationAgent {
  name: string;
  /** Its API: `/api/scribe`. */
  api: string;
  /** Its state, read with the workspaces. */
  state: ScoutState | null;
  /** The root's class (`scribe-pane`) and its heading's level. */
  className: string;
  heading: 'h1' | 'h2';
  /** What it does where, before the checkout's name: "Writes skills in .claude/skills of". */
  doing: string;
  /** What it is, behind the "?" by its name. */
  help: ReactNode;
  /** A text to put in its terminal's input, unsent (Improve with Scribe, V78); then `onTyped`. */
  typed?: string;
  onTyped?: () => void;
}

/**
 * A page's agent in a pane (Scribe's, V41): a head strip — its name, what it does where and on
 * what, its state, New conversation — over its terminal, opened at once (V78).
 */
export function Conversation({ agent: own }: { agent: ConversationAgent }) {
  const agent = usePageAgent(own.api, own.state);
  const { read } = agent;
  const Heading = own.heading;
  const id = `${own.className}-title`;
  return (
    <section className={own.className} aria-labelledby={id}>
      <header className="scout-top">
        <span className="scout-title">
          <Heading id={id}>{own.name}</Heading>
          <Help label={`About ${own.name}`}>{own.help}</Help>
        </span>
        {read && (
          <p className="scout-about" {...tip(read.checkout, { code: true })}>
            {own.doing} {folderName(read.checkout)}
            {agent.on ? `, ${agent.on}` : ''}
          </p>
        )}
        <div className="scout-actions">
          <PageAgentActions agent={agent} />
        </div>
      </header>
      <PageAgentError agent={agent} />
      <PageAgentBody
        name={own.name}
        api={own.api}
        agent={agent}
        {...(own.typed === undefined ? {} : { typed: own.typed })}
        {...(own.onTyped ? { onTyped: own.onTyped } : {})}
      />
    </section>
  );
}

/**
 * A page agent's terminal edge to edge (V35), opened on its session; "Open again" when it ends.
 * `typed` goes in its input once it is open, unsent; `onTyped` says it was handed over.
 */
export function ConversationTerminal({
  api,
  typed,
  onTyped,
}: {
  api: string;
  typed?: string;
  onTyped?: () => void;
}) {
  const [ended, setEnded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState<OpenedTerminal | null>(null);
  useEffect(() => {
    if (typed === undefined || !opened) return;
    opened.type(typed);
    onTyped?.();
  }, [typed, opened]);
  return (
    <div className="scout-terminal workspace-terminal">
      <AgentTerminal
        key={attempt}
        url={`${api}/terminal`}
        onOpened={setOpened}
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
  );
}
