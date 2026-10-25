import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AgentKind, ScoutEfforts, ScoutState } from '@symbiote/core';
import { EffortStepper } from '../workspaces/EffortStepper.js';
import { Help } from '../ui/Help.js';
import { getJson, postJson } from '../ui/http.js';
import {
  readWorkspacesAgain,
  reloadWorkspaces,
  useWorkspaces,
} from '../workspaces/useWorkspaces.js';
import {
  AGENT_NAMES,
  ConversationTerminal,
  attachCommand,
  folderName,
  toneOf,
} from './Conversation.js';
import { headChoices, scoutStateText } from './scout.js';

const API = '/api/scout';

/** What the head's choices are before a conversation runs (no terminal here): `''` the default. */
interface Picked {
  agent?: AgentKind;
  model?: string;
  effort?: string;
}

/**
 * Scout (V35): an agent in the checkout; since MC1 it carries workspaces from a start to a merge
 * through Symbiote's tools, asking the person to confirm what changes a branch's fate. Since V50
 * the page is its terminal: opened with no question, which the terminal takes. Its head picks
 * the agent (a new conversation), the model and the level (the conversation moved to a copy on
 * them, decision 384), and starts a new conversation on the project's. Where no terminal runs,
 * the question box, the head's choices what its first question starts on.
 */
export function ScoutPage() {
  const { scout: read } = useWorkspaces();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An open was asked for while there is no conversation: asked once, until one runs or Try again.
  const [opening, setOpening] = useState(false);
  const [moving, setMoving] = useState(false);
  const [picked, setPicked] = useState<Picked>({});
  // The model and level shown while the stepper is dragged and the conversation moves to them.
  const [pending, setPending] = useState<{ model?: string; effort?: string } | null>(null);
  const [efforts, setEfforts] = useState<ScoutEfforts | null>(null);
  const [text, setText] = useState('');

  const conversation = read?.conversation ?? null;
  const agents = read?.agents ?? [];
  const live = conversation !== null && conversation.state !== 'gone';
  const terminals = read?.terminal?.available === true;
  const none = read !== null && agents.length === 0;
  const kind = conversation?.kind ?? picked.agent ?? agents[0]?.kind;
  const answering = conversation?.state === 'working' || conversation?.state === 'needs-you';
  const head = headChoices(
    efforts?.agents.find((a) => a.kind === kind),
    live ? conversation : null,
    {
      model: picked.model ?? efforts?.model,
      effort: picked.effort ?? efforts?.effort,
    },
  );
  const model = pending?.model ?? head.model;
  const effort = pending?.effort ?? head.effort;

  // The models and levels: read once there are agents, and again for each conversation, since
  // Settings may have changed the project's.
  const reading = read !== null && !none;
  const id = conversation?.id;
  useEffect(() => {
    if (!reading) return;
    let current = true;
    getJson<ScoutEfforts>(`${API}/efforts`)
      .then((answer) => {
        if (current) setEfforts(answer);
      })
      .catch(() => {
        // None read: no Model, no Effort; a conversation starts on the project's.
        if (current) setEfforts(null);
      });
    return () => {
      current = false;
    };
  }, [reading, id]);

  useEffect(() => {
    if (live) {
      setOpening(false);
      setError(null);
    }
  }, [live]);

  /** Runs a write, then reads Scout's state again before the page goes on. */
  const act = (task: () => Promise<ScoutState>, after?: () => void) => {
    setBusy(true);
    setError(null);
    return task()
      .then(async () => {
        after?.();
        await readWorkspacesAgain();
      })
      .catch((e: unknown) => {
        setError((e as Error).message);
        void reloadWorkspaces();
      })
      .finally(() => {
        setBusy(false);
        setMoving(false);
        setPending(null);
      });
  };

  // With terminals and no conversation, one is opened at once, with no question.
  const open = read !== null && terminals && !none && !live && !busy && !opening && !error;
  useEffect(() => {
    if (!open) return;
    setOpening(true);
    void act(() =>
      postJson<ScoutState>(`${API}/open`, picked.agent ? { agent: picked.agent } : {}),
    );
  }, [open]);

  /** A model or a level picked: the conversation moves to it; before one, the next starts on it. */
  const choose = (next: { model: string; effort: string }) => {
    if (!live) {
      setPending(null);
      setPicked((was) => ({ ...was, model: next.model, effort: next.effort }));
      return;
    }
    if (next.model === head.model && next.effort === head.effort) {
      setPending(null);
      return;
    }
    setPending(next);
    setMoving(true);
    void act(() =>
      postJson<ScoutState>(`${API}/switch`, {
        model: next.model || null,
        effort: next.effort || null,
      }),
    );
  };
  /** The level a new model takes too stays; else its own. */
  const onModel = (model: string) => {
    const levels = efforts?.agents.find((a) => a.kind === kind);
    const takes = levels
      ? headChoices(levels, { model }, {}).efforts.some((c) => c.value === head.effort)
      : false;
    choose({ model, effort: takes ? head.effort : '' });
  };

  const ask = (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() === '' || busy) return;
    void act(
      () =>
        postJson<ScoutState>(`${API}/ask`, {
          text,
          ...(picked.agent && !live ? { agent: picked.agent } : {}),
          ...(!live && head.models.length > 0 ? { model: head.model || null } : {}),
          ...(!live && head.efforts.length > 0 ? { effort: head.effort || null } : {}),
        }),
      () => setText(''),
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    ask();
  };

  const locked = busy || answering;
  const why = answering ? 'Scout is answering: change it after its answer' : undefined;
  return (
    <section className="scout-page" aria-labelledby="scout-title">
      <header className="scout-top">
        <span className="scout-title">
          <h1 id="scout-title">Scout</h1>
          <Help label="About Scout">
            <p>
              Where something is decided, why it works this way, what touches it; and your
              workspaces from a start to a merge: what waits for you, a plan to answer, a
              branch&apos;s review, its merge. Scout reads this checkout&apos;s files and history
              and changes no file; it acts through Symbiote, and asks you to confirm a start, a
              verdict, a merge or a clean-up first.
            </p>
            <p>
              Ask in its terminal. A model or an effort picked here moves this conversation to it,
              what was said kept (a line you were typing is not); Settings sets the ones each new
              conversation starts on.
            </p>
          </Help>
        </span>
        {read && (
          <p className="scout-about" title={read.checkout}>
            In {folderName(read.checkout)}
            {/* With two agents, the Agent beside it names it. */}
            {kind && agents.length < 2 ? `, with ${AGENT_NAMES[kind]}` : ''}
          </p>
        )}
        {!none && read && (
          <div className="scout-choices">
            {agents.length > 1 && (
              <select
                aria-label="Agent"
                title="Another agent starts a new conversation"
                value={kind}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value as AgentKind;
                  // A model and a level are one agent's: the other starts on the project's.
                  setPicked({ agent: next });
                  if (live) void act(() => postJson<ScoutState>(`${API}/new`, {}));
                }}
              >
                {agents.map((a) => (
                  <option key={a.kind} value={a.kind}>
                    {AGENT_NAMES[a.kind]}
                  </option>
                ))}
              </select>
            )}
            {head.models.length > 0 && (
              <select
                aria-label="Model"
                title={why ?? "This conversation's model"}
                value={model}
                disabled={locked}
                onChange={(event) => onModel(event.target.value)}
              >
                {head.models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            {head.efforts.length > 0 && (
              <div className="scout-effort">
                <span className="scout-effort-label" aria-hidden="true">
                  Effort
                </span>
                <EffortStepper
                  label="Effort"
                  choices={head.efforts}
                  value={effort}
                  title={why}
                  disabled={locked}
                  onChange={(level) => setPending({ model, effort: level })}
                  onCommit={(level) => choose({ model: head.model, effort: level })}
                />
              </div>
            )}
          </div>
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
              title="Ends this conversation (its session is stopped and removed) and starts another, on Settings' model and effort"
              onClick={() => {
                // The next on this agent, at the project's model and level (decision 385).
                setPicked({ agent: conversation.kind });
                void act(() => postJson<ScoutState>(`${API}/new`, {}));
              }}
            >
              New conversation
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="error scout-error" role="alert">
          {error}{' '}
          {terminals && !live && (
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setError(null);
                setOpening(false);
              }}
            >
              Try again
            </button>
          )}
        </p>
      )}
      {none ? (
        <div className="scout-body">
          <p className="scout-note">Scout needs Claude Code or Codex: neither is installed here.</p>
        </div>
      ) : live && terminals ? (
        <ConversationTerminal key={conversation.id} api={API} quiet={moving} />
      ) : terminals || read === null ? (
        <div className="scout-body">
          {!error && read !== null && <p className="scout-starting">Starting Scout…</p>}
        </div>
      ) : (
        <div className="scout-body">
          <form className="scout-ask" onSubmit={ask}>
            <span className="field-label">
              <label htmlFor="scout-question">Ask Scout</label>
              <Help label="About the question">
                No terminal runs here: a question starts Scout on the head&apos;s model and effort.{' '}
                <kbd>Enter</kbd> asks; <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line.
              </Help>
            </span>
            {conversation?.state === 'gone' && (
              <p className="scout-note">
                Its last session is gone (removed outside Symbiote): a question starts a new
                conversation.
              </p>
            )}
            {live && (
              <p className="scout-note">
                No terminal here
                {read?.terminal && !read.terminal.available ? ` (${read.terminal.reason})` : ''}:
                Scout&apos;s answers are in its session, <code>{attachCommand(conversation)}</code>{' '}
                in a terminal of yours. A question here continues it.
              </p>
            )}
            <textarea
              id="scout-question"
              rows={4}
              value={text}
              placeholder="What waits for me? Start a fix for the discount, plan first."
              autoFocus
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="scout-ask-row">
              <button type="submit" className="button" disabled={busy || text.trim() === ''}>
                Ask
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
