import { useEffect, useRef, useState } from 'react';
import type {
  AgentKind,
  CheckGuess,
  PermissionMode,
  RefList,
  WorkKindSpec,
  WorkspaceOptions,
  WorkspaceRequest,
  WorkspaceStart,
} from '@cpr/core';
import {
  briefLength,
  formParts,
  formReady,
  HINTS,
  KIND_ABOUT,
  morePartsOf,
  newForm,
  readDraft,
  requiredPart,
  withCheck,
  withKind,
  checkWords,
  type BriefForm,
} from './brief.js';
import {
  AGENT_NAMES,
  branchProblem,
  effortChoices,
  keptEffort,
  PERMISSION_LABELS,
  proposeBranch,
  readRun,
  type RunChoices,
} from './workspaces.js';
import { getJson, postJson } from './http.js';
import { shortSha } from './commits.js';
import { ChevronIcon } from './icons.js';
import { reloadWorkspaces } from './useWorkspaces.js';

/** How long typing pauses before the draft is saved. */
const SAVE_AFTER_MS = 400;

/** The draft's last save: the page shown again reads the draft after it, never before it. */
let saving: Promise<unknown> = Promise.resolve();
function saveDraft(value: object): void {
  saving = postJson('/api/workspaces/draft', value).catch(() => undefined);
}

/** The run's choices at `level`, or at the agent's own level without one. */
function atLevel(run: RunChoices, level: string | undefined): RunChoices {
  const next = { ...run };
  delete next.effort;
  return level ? { ...next, effort: level } : next;
}

interface Loaded {
  options: WorkspaceOptions;
  /** Branch names in use, locally or on a remote. */
  taken: ReadonlySet<string>;
  /** The draft as `cpr view` keeps it (V24c); anything not one is a new form. */
  draft: unknown;
}

/**
 * "Start a workspace" (V18, V24c), a page of the shell since V30a: the kind of work, its title and
 * parts (what the server makes the agent's brief of) on the left; on the right the branch (named
 * after the title until edited), the agent — picked among those installed (V20a) — with its
 * account and Claude Code's permission mode, and plan first. Where it starts is the commit `at`,
 * else the default branch's tip. The form is kept as a draft by `cpr view` until it starts, so
 * leaving loses nothing. Ctrl+Enter starts; Escape and Cancel `leave`.
 */
export function StartPage({
  at,
  onStarted,
  onLeave,
}: {
  at?: string | undefined;
  onStarted: (start: WorkspaceStart) => void;
  onLeave: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([
      getJson<WorkspaceOptions>('/api/workspaces/options'),
      getJson<RefList>('/api/refs'),
      // No draft is no reason not to start.
      saving.then(() => getJson<unknown>('/api/workspaces/draft')).catch(() => null),
    ])
      .then(([options, refs, draft]) => {
        if (!current) return;
        const taken = new Set([
          ...refs.branches.map((b) => b.name),
          ...refs.remotes.map((r) => r.branch),
        ]);
        setLoaded({ options, taken, draft });
      })
      .catch((e: unknown) => {
        if (current) setFailed(`Could not read what a workspace needs: ${(e as Error).message}`);
      });
    return () => {
      current = false;
    };
  }, []);

  const base = at ? { sha: at } : loaded?.options.base;
  if (loaded && base) {
    return <StartForm {...loaded} base={base} onStarted={onStarted} onLeave={onLeave} />;
  }
  return (
    <section className="start-page" aria-labelledby="start-title">
      <header className="start-top">
        <h1 id="start-title">Start a workspace</h1>
        <div className="start-actions">
          <button type="button" className="link" onClick={onLeave}>
            Cancel
          </button>
        </div>
      </header>
      <div className="start-body">
        {failed ? (
          <p className="error">{failed}</p>
        ) : loaded ? (
          <p className="error">
            No default branch to start from: start the workspace from a commit (its menu in History:
            Start a workspace here).
          </p>
        ) : (
          <p className="hint">Reading what a workspace needs…</p>
        )}
      </div>
    </section>
  );
}

function StartForm({
  options,
  taken,
  draft,
  base,
  onStarted,
  onLeave,
}: Loaded & {
  /** A picked row's commit; else the default branch's tip (`options.base`). */
  base: { sha: string; from?: string };
  onStarted: (start: WorkspaceStart) => void;
  onLeave: () => void;
}) {
  const { kinds } = options;
  const specOf = (kind: string): WorkKindSpec =>
    kinds.find((k) => k.kind === kind) ?? (kinds[0] as WorkKindSpec);
  const [form, setForm] = useState<BriefForm>(
    () => readDraft(draft, kinds, null) ?? newForm(specOf('feature'), null),
  );
  const [guess, setGuess] = useState<CheckGuess | null>(null);
  const [moreShown, setMoreShown] = useState(false);
  // The kinds' info: while hovered or focused, or once tapped.
  const [about, setAbout] = useState(false);
  // The run's choices as the draft kept them (V30b); else the agents installed, the default first
  // (V20a), at its own effort, Claude Code in its configured mode, plan first.
  const [run, setRun] = useState<RunChoices>(() =>
    readRun(
      draft && typeof draft === 'object' ? (draft as { run?: unknown }).run : null,
      options.agents,
    ),
  );
  const agent =
    options.agents.find((a) => a.kind === (run.agent ?? options.agents[0]?.kind)) ?? null;
  const mode: PermissionMode =
    run.permissionMode ??
    options.agents.find((a) => a.kind === 'claude')?.permissionMode ??
    'default';
  const planFirst = run.planFirst ?? true;
  const effort = agent ? keptEffort(run.effort, agent) : undefined;
  const efforts = agent ? effortChoices(agent) : [];
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = specOf(form.kind);

  // The check command, guessed at the commit it starts from (V24b); words until it comes.
  useEffect(() => {
    let current = true;
    getJson<Partial<CheckGuess>>(`/api/workspaces/check?at=${base.sha}`)
      .then((found) => {
        if (!current || !found.command || !found.source) return;
        const next = { command: found.command, source: found.source };
        setGuess(next);
        setForm((f) => withCheck(f, specOf(f.kind), null, next));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
    // The kinds do not change while the page is shown.
  }, [base.sha]);

  // The draft, the run's choices with it: saved once typing pauses, and when the page is left;
  // after a start only the kind (a level is for that session, V30b).
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ form, run });
  latest.current = { form, run };
  const started = useRef(false);
  const draftNow = () => ({ ...latest.current.form, run: latest.current.run });
  const later = () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      saveDraft(draftNow());
    }, SAVE_AFTER_MS);
  };
  const edit = (next: BriefForm) => {
    setForm(next);
    latest.current = { ...latest.current, form: next };
    later();
  };
  const choose = (next: RunChoices) => {
    setRun(next);
    latest.current = { ...latest.current, run: next };
    later();
  };
  useEffect(
    () => () => {
      if (started.current) saveDraft({ kind: latest.current.form.kind });
      else if (pending.current) saveDraft(draftNow());
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const branch = form.branch ?? proposeBranch(form.title, options.branchPrefixes[form.kind], taken);
  const problem = branchProblem(branch, taken);
  const length = briefLength(form, spec);
  const tooLong = length > options.maxBrief;
  const ready = formReady(form) && !problem && !tooLong && !running;
  const more = morePartsOf(spec);
  const moreText = more.some((part) => (form.more[part] ?? '').trim() !== '');
  const moreOpen = moreShown || moreText;
  const main = requiredPart(spec);
  const heading = (part: string) => spec.parts.find((p) => p.part === part)?.heading ?? part;

  const start = async () => {
    if (!ready) return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    saveDraft(draftNow());
    const request: WorkspaceRequest = {
      kind: form.kind,
      title: form.title,
      parts: formParts(form, spec),
      branch,
      planFirst,
      // The default branch's tip is the server's to find at the start; a row is that commit.
      ...(base.from ? {} : { base: base.sha }),
      ...(agent ? { agent: agent.kind } : {}),
      ...(agent?.kind === 'claude' ? { permissionMode: mode } : {}),
      ...(effort ? { effort } : {}),
    };
    setRunning(true);
    setError(null);
    try {
      const result = await postJson<WorkspaceStart>('/api/workspaces', request);
      started.current = true;
      void reloadWorkspaces();
      onStarted(result);
    } catch (e) {
      // A start that failed stays on the page: leaving it keeps the draft.
      setError((e as Error).message);
      setRunning(false);
    }
  };
  const pick = (kind: WorkKindSpec) => {
    if (kind.kind !== form.kind) edit(withKind(form, spec, kind, guess));
  };
  const folder = options.worktrees.replace('<branch>', branch.replaceAll('/', '-'));
  const at = kinds.indexOf(spec);
  return (
    <section
      className="start-page"
      aria-labelledby="start-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !running) onLeave();
        else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void start();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <header className="start-top">
        <h1 id="start-title">Start a workspace</h1>
        <p className="start-from">
          From{' '}
          {base.from ? (
            <>
              <span className="ref ref-branch">{base.from}</span> at{' '}
            </>
          ) : (
            'the commit '
          )}
          <code>{shortSha(base.sha)}</code>
        </p>
        <div className="start-actions">
          <button type="button" className="link" disabled={running} onClick={onLeave}>
            Cancel
          </button>
          <button
            type="button"
            className="link"
            disabled={running}
            title="Empty the form; the kind stays"
            onClick={() => edit(newForm(spec, guess))}
          >
            Clear
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!ready}
            title="Ctrl+Enter"
            onClick={() => void start()}
          >
            {running ? 'Starting…' : agent ? 'Start' : 'Make the branch'}
          </button>
        </div>
      </header>
      {error && (
        <pre className="error start-error" role="alert">
          {error}
        </pre>
      )}
      <div className="start-body">
        <div className="start-columns">
          <div className="start-brief">
            <div className="kind-row">
              <div
                className="kind-picker"
                role="radiogroup"
                aria-label="Kind of work"
                onKeyDown={(event) => {
                  const n = Number(event.key);
                  const to =
                    n >= 1 && n <= kinds.length
                      ? kinds[n - 1]
                      : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                        ? kinds[(at + 1) % kinds.length]
                        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                          ? kinds[(at - 1 + kinds.length) % kinds.length]
                          : undefined;
                  if (!to) return;
                  event.preventDefault();
                  pick(to);
                  const radios =
                    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
                  radios[kinds.indexOf(to)]?.focus();
                }}
              >
                {kinds.map((kind, i) => (
                  <button
                    key={kind.kind}
                    type="button"
                    role="radio"
                    aria-checked={kind.kind === form.kind}
                    tabIndex={kind.kind === form.kind ? 0 : -1}
                    className={kind.kind === form.kind ? 'kind active' : 'kind'}
                    title={`${kind.name} (${i + 1})`}
                    onClick={() => pick(kind)}
                  >
                    {kind.name}
                  </button>
                ))}
              </div>
              <span
                className="kind-info"
                onMouseEnter={() => setAbout(true)}
                onMouseLeave={() => setAbout(false)}
              >
                <button
                  type="button"
                  className="kind-info-button"
                  aria-label="About the kinds of work"
                  aria-expanded={about}
                  {...(about ? { 'aria-describedby': 'kind-about' } : {})}
                  onFocus={() => setAbout(true)}
                  onBlur={() => setAbout(false)}
                  // A tap shows it where there is no hover; focus has already shown it on a click.
                  onClick={() => setAbout(true)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape' || !about) return;
                    // Hides the info, and stays on the page.
                    event.preventDefault();
                    event.stopPropagation();
                    setAbout(false);
                  }}
                >
                  ⓘ
                </button>
              </span>
              {about && (
                <div id="kind-about" role="tooltip" className="kind-about">
                  <dl>
                    {kinds.map((kind) => (
                      <div
                        key={kind.kind}
                        className={kind.kind === form.kind ? 'current' : undefined}
                      >
                        <dt>{kind.name}</dt>
                        <dd>{KIND_ABOUT[kind.kind]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
            <label className="workspace-field">
              Title
              <input
                type="text"
                name="title"
                autoFocus
                autoComplete="off"
                value={form.title}
                placeholder="A short name: the workspace's and its branch's"
                onChange={(event) => edit({ ...form, title: event.target.value })}
              />
            </label>
            <label className="workspace-field">
              {heading(main)}
              <textarea
                rows={7}
                value={form.main}
                placeholder={HINTS[main]}
                onChange={(event) => edit({ ...form, main: event.target.value })}
              />
            </label>
            <label className="workspace-field">
              <span>
                Done when <span className="field-optional">optional</span>
              </span>
              <textarea
                rows={3}
                value={form.doneWhen}
                placeholder={`${HINTS.doneWhen} e.g. ${checkWords(guess)}, and …`}
                onChange={(event) => edit({ ...form, doneWhen: event.target.value })}
              />
            </label>
            {guess && (
              <p className="dialog-note workspace-check-guess">
                Check: <code>{guess.command}</code>, from {guess.source}
              </p>
            )}
            <button
              type="button"
              className="link workspace-more"
              aria-expanded={moreOpen}
              onClick={() => setMoreShown(!moreOpen)}
            >
              <ChevronIcon open={moreOpen} />
              More: {more.map(heading).join(', ')}
            </button>
            {moreOpen &&
              more.map((part) => (
                <label key={part} className="workspace-field">
                  <span>
                    {heading(part)} <span className="field-optional">optional</span>
                  </span>
                  <textarea
                    rows={3}
                    value={form.more[part] ?? ''}
                    placeholder={HINTS[part]}
                    onChange={(event) =>
                      edit({ ...form, more: { ...form.more, [part]: event.target.value } })
                    }
                  />
                </label>
              ))}
            {length > options.maxBrief * 0.9 && (
              <p className={tooLong ? 'error' : 'dialog-note'}>
                The brief is {length.toLocaleString('en')} characters; at most{' '}
                {options.maxBrief.toLocaleString('en')}.
              </p>
            )}
          </div>
          <div className="start-run">
            <label className="workspace-field">
              Branch
              <input
                type="text"
                className="branch-input"
                autoComplete="off"
                value={branch}
                spellCheck={false}
                aria-invalid={form.title.trim() !== '' && problem !== null}
                onChange={(event) => edit({ ...form, branch: event.target.value })}
              />
            </label>
            {form.title.trim() !== '' && problem && <p className="error">{problem}</p>}
            <p className="dialog-note start-folder">
              in <code title={folder}>{folder}</code>
            </p>
            {agent ? (
              <>
                {options.agents.length > 1 ? (
                  <label className="workspace-field">
                    Agent
                    <select
                      value={agent.kind}
                      title={agent.command}
                      onChange={(event) => {
                        const kind = event.target.value as AgentKind;
                        const next = options.agents.find((a) => a.kind === kind);
                        // A level the other agent takes stays; else its default.
                        const kept = next ? keptEffort(run.effort, next) : undefined;
                        choose(atLevel({ ...run, agent: kind }, kept));
                      }}
                    >
                      {options.agents.map((a) => (
                        <option key={a.kind} value={a.kind}>
                          {AGENT_NAMES[a.kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="workspace-field">
                    Agent
                    <span className="start-value" title={agent.command}>
                      {AGENT_NAMES[agent.kind]}
                    </span>
                  </div>
                )}
                {agent.account && <p className="dialog-note start-account">{agent.account}</p>}
                {efforts.length > 0 && (
                  <label className="workspace-field">
                    Effort
                    <select
                      value={effort ?? ''}
                      title="The level its session starts at; change it later in its terminal"
                      onChange={(event) => choose(atLevel(run, event.target.value || undefined))}
                    >
                      {efforts.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {agent.kind === 'claude' ? (
                  <label className="workspace-field">
                    Permission
                    <select
                      value={mode}
                      onChange={(event) =>
                        choose({ ...run, permissionMode: event.target.value as PermissionMode })
                      }
                    >
                      {(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((m) => (
                        <option key={m} value={m}>
                          {PERMISSION_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div
                    className="workspace-field"
                    title="Codex's workspace-write sandbox: it writes in its worktree and may commit on its branch; nothing else in git. Codex then marks this repository trusted in your Codex configuration, as it does for any writable sandbox."
                  >
                    Sandbox
                    <span className="start-value">Its worktree and branch</span>
                  </div>
                )}
              </>
            ) : (
              <p className="dialog-note">
                No agent found (Claude Code: <code>claude</code> on PATH, or <code>CPR_CLAUDE</code>
                ; Codex: <code>codex</code> on PATH, or <code>CPR_CODEX</code>): the branch and its
                worktree are made, and you get the prompt to give an agent.
              </p>
            )}
            <label className="workspace-check">
              <input
                type="checkbox"
                checked={planFirst}
                onChange={(event) => choose({ ...run, planFirst: event.target.checked })}
              />
              Plan first and wait for my OK
            </label>
            {agent?.apiKey && (
              <p className="error">
                ANTHROPIC_API_KEY is set where cpr view runs: the agent may use that key instead of{' '}
                {agent.account ?? 'your account'}.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
