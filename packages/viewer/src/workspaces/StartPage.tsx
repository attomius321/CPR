import { useEffect, useRef, useState, type DragEvent } from 'react';
import type {
  CheckGuess,
  PermissionMode,
  RefList,
  WorkKindSpec,
  WorkspaceDocument,
  WorkspaceOptions,
  WorkspaceRequest,
  WorkspaceStart,
} from '@symbiote/core';
import {
  briefLength,
  formParts,
  formReady,
  HINTS,
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
  branchProblem,
  effortChoices,
  keptEffort,
  keptModel,
  modelChoices,
  proposeBranch,
  readRun,
  type RunChoices,
} from './workspaces.js';
import { fileBase64, getJson, postJson } from '../ui/http.js';
import { shortSha } from '../history/commits.js';
import { ChevronIcon } from '../ui/icons.js';
import { Help } from '../ui/Help.js';
import { reloadWorkspaces } from './useWorkspaces.js';
import {
  addDocuments,
  documentsBlocking,
  keptDocuments,
  pastedFiles,
  readDocuments,
  type DocumentEntry,
} from './documents.js';
import { StartAgent } from './StartAgent.js';
import { StartDocuments } from './StartDocuments.js';
import { StartKinds } from './StartKinds.js';

/** How long typing pauses before the draft is saved. */
const SAVE_AFTER_MS = 400;

/** The draft's last save: the page shown again reads the draft after it, never before it. */
let saving: Promise<unknown> = Promise.resolve();
function saveDraft(value: object): void {
  saving = postJson('/api/workspaces/draft', value).catch(() => undefined);
}

interface Loaded {
  options: WorkspaceOptions;
  /** Branch names in use, locally or on a remote. */
  taken: ReadonlySet<string>;
  /** The draft as `symbiote view` keeps it (V24c); anything not one is a new form. */
  draft: unknown;
}

/**
 * "Start a workspace" (V18, V24c), a page of the shell since V30a: the kind of work, its title and
 * parts (what the server makes the agent's brief of) on the left; on the right where it starts
 * from (V33), the branch (named after the title until edited), the agent — picked among those
 * installed (V20a) — with its account and Claude Code's permission mode, plan first, and the
 * documents given with the brief (V40; a drop or a paste anywhere on the page adds them). Where it
 * starts is the commit `at` until a branch is picked, else the default branch's tip. The form is
 * kept as a draft by `symbiote view` until it starts, so leaving loses nothing. Ctrl+Enter starts;
 * Escape and Cancel `leave`.
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

  if (loaded && (at || loaded.options.branches.length > 0)) {
    return <StartForm {...loaded} at={at} onStarted={onStarted} onLeave={onLeave} />;
  }
  return (
    <section className="start-page" aria-labelledby="start-title">
      <header className="start-top">
        <h1 id="start-title">Start a workspace</h1>
        <div className="start-actions">
          <button type="button" className="button ghost" onClick={onLeave}>
            Cancel
          </button>
        </div>
      </header>
      <div className="start-body">
        {failed ? (
          <p className="error">{failed}</p>
        ) : loaded ? (
          <p className="error">
            No branch to start from: start the workspace from a commit (its menu in History: Start a
            workspace here).
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
  at,
  onStarted,
  onLeave,
}: Loaded & {
  /** A picked row's commit, where it starts until a branch is picked. */
  at: string | undefined;
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
  // The run's choices as the draft kept them (V30b); else the agents installed, the default first
  // (V20a), at its own effort, Claude Code in its configured mode, plan first.
  const [run, setRun] = useState<RunChoices>(() =>
    readRun(
      draft && typeof draft === 'object' ? (draft as { run?: unknown }).run : null,
      options.agents,
      options.branches,
    ),
  );
  // Where it starts (V33): the row's commit until a branch is picked; else the branch picked, the
  // draft's or the default one, at its newest tip.
  const [onCommit, setOnCommit] = useState(at !== undefined);
  const picked =
    options.branches.find((b) => b.name === (run.from ?? options.base?.from)) ??
    options.branches[0];
  // Without a branch there is a row's commit: the page shows no form otherwise.
  const base: { sha: string; from?: string } =
    picked && !(onCommit && at) ? { sha: picked.sha, from: picked.name } : { sha: at ?? '' };
  const local = options.branches.filter((b) => !b.remote);
  const remote = options.branches.filter((b) => b.remote);
  const agent =
    options.agents.find((a) => a.kind === (run.agent ?? options.agents[0]?.kind)) ?? null;
  const mode: PermissionMode =
    run.permissionMode ??
    options.agents.find((a) => a.kind === 'claude')?.permissionMode ??
    'default';
  const planFirst = run.planFirst ?? true;
  // The model picked (V47), while the agent lists it; the level and its choices are that model's.
  const model = agent ? keptModel(run.model, agent) : undefined;
  const models = agent ? modelChoices(agent) : [];
  const effort = agent ? keptEffort(run.effort, agent, model) : undefined;
  const efforts = agent ? effortChoices(agent, model) : [];
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The files given with the brief (V40), kept by the draft once uploaded.
  const [documents, setDocuments] = useState<DocumentEntry[]>(() => readDocuments(draft));
  const [dropping, setDropping] = useState(false);
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
  const latest = useRef({ form, run, documents });
  latest.current = { form, run, documents };
  const started = useRef(false);
  const draftNow = () => ({
    ...latest.current.form,
    run: latest.current.run,
    documents: latest.current.documents.flatMap((d) =>
      d.state === 'kept' ? [{ id: d.id, name: d.name, size: d.size }] : [],
    ),
  });
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
  const listDocuments = (next: DocumentEntry[]) => {
    setDocuments(next);
    latest.current = { ...latest.current, documents: next };
    later();
  };
  // Each file uploaded as it is added, one after another (V40); one taken off meanwhile is not.
  const uploads = useRef<Promise<void>>(Promise.resolve());
  const changeDocument = (key: string, change: Partial<DocumentEntry>) =>
    listDocuments(latest.current.documents.map((d) => (d.key === key ? { ...d, ...change } : d)));
  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const before = latest.current.documents;
    const next = addDocuments(before, files, options.documents);
    listDocuments(next);
    next.slice(before.length).forEach((entry, i) => {
      const file = files[i];
      if (entry.state !== 'uploading' || !file) return;
      uploads.current = uploads.current.then(async () => {
        if (!latest.current.documents.some((d) => d.key === entry.key)) return;
        try {
          const kept = await postJson<WorkspaceDocument>('/api/workspaces/documents', {
            name: file.name,
            data: await fileBase64(file),
          });
          changeDocument(entry.key, { state: 'kept', id: kept.id, name: kept.name });
        } catch (failed) {
          changeDocument(entry.key, { state: 'failed', error: (failed as Error).message });
        }
      });
    });
  };
  // Files dragged over the page, counted: entering its own elements leaves the one before.
  const over = useRef(0);
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
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
  const waiting = documentsBlocking(documents);
  const ready = formReady(form) && !problem && !tooLong && !running && !waiting;
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
      // A branch's tip is the server's to find at the start; a row is that commit.
      ...(base.from ? { from: base.from } : { base: base.sha }),
      ...(agent ? { agent: agent.kind } : {}),
      ...(agent?.kind === 'claude' ? { permissionMode: mode } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(documents.length > 0 ? { documents: keptDocuments(documents) } : {}),
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
      // A file or a screenshot pasted anywhere is a document; text pastes as text (V40).
      onPaste={(event) => {
        const files = pastedFiles(event.clipboardData);
        if (files.length === 0) return;
        event.preventDefault();
        addFiles(files);
      }}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        over.current += 1;
        setDropping(true);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        over.current = Math.max(0, over.current - 1);
        if (over.current === 0) setDropping(false);
      }}
      // A drop the page does not take would open the file in the window.
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        over.current = 0;
        setDropping(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {dropping && <p className="start-drop">Drop to add them to the documents</p>}
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
          <button type="button" className="button ghost" disabled={running} onClick={onLeave}>
            Cancel
          </button>
          <button
            type="button"
            className="button ghost"
            disabled={running}
            title="Empty the form; the kind stays"
            onClick={() => {
              edit(newForm(spec, guess));
              listDocuments([]);
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!ready}
            title={waiting ?? 'Ctrl+Enter'}
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
            <StartKinds kinds={kinds} current={spec} onPick={pick} />
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
              Start from
              <select
                value={base.from ?? ''}
                onChange={(event) => {
                  const name = event.target.value;
                  setOnCommit(name === '');
                  if (name !== '') choose({ ...run, from: name });
                }}
              >
                {at && <option value="">The commit {shortSha(at)}</option>}
                {local.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
                {remote.length > 0 && (
                  <optgroup label="Only on a remote">
                    {remote.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <div className="workspace-field">
              <span className="field-label">
                <label htmlFor="start-branch">Branch</label>
                <Help label="Where its worktree goes">
                  <p>
                    Its worktree: <code>{folder}</code>
                  </p>
                </Help>
              </span>
              <input
                id="start-branch"
                type="text"
                autoComplete="off"
                value={branch}
                spellCheck={false}
                aria-invalid={form.title.trim() !== '' && problem !== null}
                onChange={(event) => edit({ ...form, branch: event.target.value })}
              />
            </div>
            {form.title.trim() !== '' && problem && <p className="error">{problem}</p>}
            <StartAgent
              agents={options.agents}
              agent={agent}
              run={run}
              mode={mode}
              model={model}
              models={models}
              effort={effort}
              efforts={efforts}
              onChoose={choose}
            />
            <label className="workspace-check">
              <input
                type="checkbox"
                checked={planFirst}
                onChange={(event) => choose({ ...run, planFirst: event.target.checked })}
              />
              Plan first and wait for my OK
            </label>
            <StartDocuments
              entries={documents}
              options={options.documents}
              folder={options.documents.folder.replace('<branch>', branch)}
              onAdd={addFiles}
              onRemove={(key) =>
                listDocuments(latest.current.documents.filter((d) => d.key !== key))
              }
            />
            {agent?.apiKey && (
              <p className="error">
                ANTHROPIC_API_KEY is set where symbiote view runs: the agent may use that key
                instead of {agent.account ?? 'your account'}.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
