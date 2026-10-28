import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AgentKind, ScoutEfforts, ScoutState } from '@symbiote/core';
import { EffortStepper } from '../workspaces/EffortStepper.js';
import { Help } from '../ui/Help.js';
import { PageHead } from '../ui/PageHead.js';
import { ScoutIcon } from '../ui/icons.js';
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
import { headChoices, newConversation, scoutStateText } from './scout.js';
import { tip } from '../ui/tip.js';

const API = '/api/scout';

/**
 * The head's choices the person changed (V52): what New conversation starts on, and before a
 * conversation what it starts on; absent, as the head shows them. `''` is the agent's own.
 */
interface Picked {
  agent?: AgentKind;
  model?: string;
  effort?: string;
}

/**
 * Scout (V35): an agent in the checkout; since MC1 it carries workspaces from a start to a merge
 * through Symbiote's tools, asking the person to confirm what changes a branch's fate. Since V50
 * the page is its terminal: opened with no question, which the terminal takes. Its head shows the
 * conversation's agent, model and level; a change there starts nothing (V52, decision 391): New
 * conversation starts the next on what the head shows (392). Where no terminal runs, the question
 * box, the head's choices what its first question starts on.
 */
export function ScoutPage() {
  const { scout: read } = useWorkspaces();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An open was asked for while there is no conversation: asked once, until one runs or Try again.
  const [opening, setOpening] = useState(false);
  const [picked, setPicked] = useState<Picked>({});
  const [efforts, setEfforts] = useState<ScoutEfforts | null>(null);
  const [text, setText] = useState('');

  const conversation = read?.conversation ?? null;
  const agents = read?.agents ?? [];
  const live = conversation !== null && conversation.state !== 'gone';
  const terminals = read?.terminal?.available === true;
  const none = read !== null && agents.length === 0;
  const kind = picked.agent ?? conversation?.kind ?? agents[0]?.kind;
  // Another agent picked: its choices are the project's, the conversation's being of its own.
  const own = live && conversation.kind === kind ? conversation : null;
  const head = headChoices(
    efforts?.agents.find((a) => a.kind === kind),
    own,
    { model: efforts?.model, effort: efforts?.effort },
    picked,
  );
  const renewal = live && kind ? newConversation({ kind, ...head }, conversation) : null;
  /** What a start is told: what the head shows (null: the agent's own), the lists it has. */
  const shown = {
    ...(kind ? { agent: kind } : {}),
    ...(head.models.length > 0 ? { model: head.model || null } : {}),
    ...(head.efforts.length > 0 ? { effort: head.effort || null } : {}),
  };

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

  // A conversation runs: the head shows its own, which are the choices it started on.
  useEffect(() => {
    if (live) setPicked({});
  }, [id, live]);

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
      .finally(() => setBusy(false));
  };

  // With terminals and no conversation, one is opened at once, with no question: on the
  // project's, or after New conversation (or a pick) on what the head shows.
  const open = read !== null && terminals && !none && !live && !busy && !opening && !error;
  const anyPicked = Object.keys(picked).length > 0;
  useEffect(() => {
    if (!open) return;
    setOpening(true);
    void act(() => postJson<ScoutState>(`${API}/open`, anyPicked ? shown : {}));
  }, [open]);

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

  return (
    <section className="scout-page" aria-labelledby="scout-title">
      {/* The page frame's head (V72): what it reads its line; its state and New conversation at
          the right. The agent, model and effort are the terminal card's head (decision 510). */}
      <PageHead
        className="scout-head"
        icon={<ScoutIcon />}
        title="Scout"
        titleId="scout-title"
        beside={
          <Help label="About Scout">
            <p>
              Where something is decided, why it works this way, what touches it; and your
              workspaces from a start to a merge: what waits for you, a plan to answer, a
              branch&apos;s review, its merge. Scout reads this checkout&apos;s files and history
              and changes no file; it acts through Symbiote, and asks you to confirm a start, a
              verdict, a merge or a clean-up first.
            </p>
            <p>
              Ask in its terminal. The agent, model and effort here are this conversation&apos;s;
              one changed here starts nothing: New conversation starts the next on them. Settings
              sets the ones Scout opens on when no conversation runs.
            </p>
          </Help>
        }
        line={
          read ? (
            <span className="scout-about" {...tip(read.checkout, { code: true })}>
              In {folderName(read.checkout)}
              {/* With two agents, the Agent beside it names it. */}
              {kind && agents.length < 2 ? `, with ${AGENT_NAMES[kind]}` : ''}
            </span>
          ) : undefined
        }
        actions={
          conversation ? (
            <>
              <span className="scout-state" role="status">
                <span className={`state-dot ${toneOf(conversation)}`} aria-hidden="true" />
                {scoutStateText(conversation)}
              </span>
              <button
                type="button"
                className={renewal?.differs ? 'button' : 'button secondary'}
                disabled={busy}
                {...tip(
                  renewal?.title ??
                    "Ends this conversation and starts another on the head's agent, model and effort",
                )}
                onClick={() => {
                  // The next on what the head shows (decision 392), kept until it runs.
                  setPicked({
                    ...(kind ? { agent: kind } : {}),
                    ...(head.models.length > 0 ? { model: head.model } : {}),
                    ...(head.efforts.length > 0 ? { effort: head.effort } : {}),
                  });
                  void act(() => postJson<ScoutState>(`${API}/new`, {}));
                }}
              >
                New conversation
              </button>
            </>
          ) : undefined
        }
      />
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
      {/* The page's card (V61), in the page frame since V72: the choices its head, then the
          terminal, or the question where no terminal runs. */}
      <div className="scout-card">
        {!none && read && (
          <div className="card-head scout-choices">
            {agents.length > 1 && (
              <select
                aria-label="Agent"
                {...tip('The agent New conversation starts')}
                value={kind}
                disabled={busy}
                onChange={(event) => {
                  // A model and a level are one agent's: the other's are the project's.
                  setPicked({ agent: event.target.value as AgentKind });
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
                {...tip('The model New conversation starts on')}
                value={head.model}
                disabled={busy}
                onChange={(event) => {
                  const model = event.target.value;
                  setPicked((was) => ({ ...was, model }));
                }}
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
                  value={head.effort}
                  title="The effort New conversation starts at"
                  disabled={busy}
                  onChange={(effort) => setPicked((was) => ({ ...was, effort }))}
                />
              </div>
            )}
          </div>
        )}
        {none ? (
          <div className="scout-body">
            <p className="scout-note">
              Scout needs Claude Code or Codex: neither is installed here.
            </p>
          </div>
        ) : live && terminals ? (
          <ConversationTerminal key={conversation.id} api={API} />
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
                  No terminal runs here: a question starts Scout on the head&apos;s model and
                  effort. <kbd>Enter</kbd> asks; <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new
                  line.
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
                  Scout&apos;s answers are in its session,{' '}
                  <code>{attachCommand(conversation)}</code> in a terminal of yours. A question here
                  continues it.
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
      </div>
    </section>
  );
}
