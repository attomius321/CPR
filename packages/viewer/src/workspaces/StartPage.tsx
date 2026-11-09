import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type {
  CheckGuess,
  PermissionMode,
  RefList,
  WorkKindSpec,
  WorkspaceDocument,
  WorkspaceOptions,
  WorkspaceRequest,
  SuggestRequest,
  WorkspaceStart,
} from '@symbiote/core';
import {
  briefLength,
  formParts,
  formReady,
  newForm,
  readDraft,
  requiredPart,
  withCheck,
  withKind,
  type BriefForm,
} from './brief.js';
import { AGENT_NAMES } from './workspaces.js';
import { branchProblem, proposeBranch } from './start-branch.js';
import {
  effortChoices,
  keptEffort,
  keptModel,
  modelChoices,
  readRun,
  type RunChoices,
} from './run-choices.js';
import { fileBase64, getJson, postJson } from '../ui/http.js';
import { ArrowRightIcon, PlusIcon, HexagonIcon } from '../ui/icons.js';
import { PageHead } from '../ui/PageHead.js';
import { reloadWorkspaces } from './useWorkspaces.js';
import { beginStart, endStart } from './starting.js';
import {
  addDocuments,
  documentsBlocking,
  keptDocuments,
  pastedFiles,
  readDocuments,
  type DocumentEntry,
} from './documents.js';
import { StartAgent } from './StartAgent.js';
import { HiveHow, useHiveCheck } from './StartHive.js';
import { useHive } from '../shell/hive.js';
import { StartDocuments } from './StartDocuments.js';
import { StartKinds } from './StartKinds.js';
import { SuggestButton, SuggestionCard, useSuggestion } from './StartSuggest.js';
import { suggestBlocked } from './suggest.js';
import { tip } from '../ui/tip.js';
import { Loading } from '../ui/Loading.js';
import { StartBrief } from './StartBrief.js';
import { StartSource } from './StartSource.js';
import { NextSteps } from './NextSteps.js';

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

  const hive = useHive();
  if (loaded && (at || loaded.options.branches.length > 0)) {
    return <StartForm {...loaded} at={at} onStarted={onStarted} onLeave={onLeave} />;
  }
  return (
    <section className="start-page" aria-labelledby="start-title">
      <StartHead hive={hive}>
        <button type="button" className="button secondary" onClick={onLeave}>
          Cancel
        </button>
      </StartHead>
      <div className="start-body">
        {failed ? (
          <p className="error">{failed}</p>
        ) : loaded ? (
          <p className="error">
            No branch to start from: start the workspace from a commit (its menu in Git: Start a
            workspace here).
          </p>
        ) : (
          <Loading className="hint">Reading what a workspace needs…</Loading>
        )}
      </div>
    </section>
  );
}

/**
 * The page's head (V63; the page frame's since V72; V93's proof 06): its icon, the title and its
 * line, then `children`, the buttons, at the right.
 */
function StartHead({
  hive,
  from,
  children,
}: {
  hive: boolean;
  from?: string;
  children: ReactNode;
}) {
  // Hive mode (V92, decision 871): a goal Hive drives to landed, no ground behind it (815).
  if (hive) {
    return (
      <PageHead
        className="start-top"
        icon={<HexagonIcon />}
        title="New goal"
        titleId="start-title"
        line={`Hive drives it from the brief to landed${from ? ` in ${from}` : ''}, and no step waits for you`}
        actions={children}
      />
    );
  }
  // Normal mode (V93, proof 06): the + in its tile, what a workspace is in a line.
  return (
    <PageHead
      className="start-top"
      icon={<PlusIcon />}
      title="Start a workspace"
      titleId="start-title"
      line="An agent works on a branch of its own; you review it before it merges"
      actions={children}
    />
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
  // The one file picker of the page: Documents' Add files, and the goal's 📎.
  const picker = useRef<HTMLInputElement>(null);
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
  // Hive drives Claude Code only (HV2, decision 658): while it is on, the one agent offered.
  const hive = useHive();
  // The check Hive will run (V92, decision 871).
  const hiveCheck = useHiveCheck(hive);
  const offered = hive ? options.agents.filter((a) => a.kind === 'claude') : options.agents;
  const agent = hive
    ? (offered[0] ?? null)
    : (options.agents.find((a) => a.kind === (run.agent ?? options.agents[0]?.kind)) ?? null);
  const mode: PermissionMode =
    run.permissionMode ??
    options.agents.find((a) => a.kind === 'claude')?.permissionMode ??
    'default';
  // Hive mode (HV4, decision 773): no plan first, and Claude Code's auto mode; nothing waits for you.
  const planFirst = hive ? false : (run.planFirst ?? true);
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
    // Its card in the sidenav while it is made (V48), until the list has it.
    beginStart({
      branch,
      name: form.title.trim() || branch,
      kind: form.kind,
      ...(agent ? { agent: AGENT_NAMES[agent.kind] } : {}),
    });
    try {
      const result = await postJson<WorkspaceStart>('/api/workspaces', request);
      started.current = true;
      void reloadWorkspaces().finally(() => endStart(branch));
      onStarted(result);
    } catch (e) {
      // A start that failed stays on the page: leaving it keeps the draft.
      endStart(branch);
      setError((e as Error).message);
      setRunning(false);
    }
  };
  // Suggested settings (V75): asked only on a press, for the agent picked.
  const suggestion = useSuggestion(agent?.kind);
  const suggestRequest = (): SuggestRequest => ({
    kind: form.kind,
    title: form.title,
    parts: formParts(form, spec),
    ...(agent ? { agent: agent.kind } : {}),
    ...(documents.length > 0 ? { documents: documents.map((d) => d.name) } : {}),
  });
  const pick = (kind: WorkKindSpec) => {
    if (kind.kind !== form.kind) edit(withKind(form, spec, kind, guess));
  };
  const mainHeading = heading(main);
  const startWords = agent ? (hive ? 'Start goal' : 'Start workspace') : 'Make the branch';
  // The documents: a row in the brief's card, as the proofs draw it (V92 in Hive mode; V93 both).
  const documentsCard = (
    <StartDocuments
      entries={documents}
      options={options.documents}
      folder={options.documents.folder.replace('<branch>', branch)}
      input={picker}
      onAdd={addFiles}
      onRemove={(key) => listDocuments(latest.current.documents.filter((d) => d.key !== key))}
    />
  );
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
      <StartHead hive={hive} {...(base.from ? { from: base.from } : {})}>
        <button type="button" className="button ghost" disabled={running} onClick={onLeave}>
          Cancel
        </button>
        <SuggestButton
          asking={suggestion.asked.state === 'asking'}
          blocked={suggestBlocked({ agent, main: form.main, heading: mainHeading, running })}
          onPress={() => void suggestion.ask(suggestRequest())}
        />
        <button
          type="button"
          className={hive ? 'button primary hive' : 'button primary'}
          disabled={!ready}
          {...tip(waiting ?? (running ? undefined : startWords), {
            keys: waiting ? undefined : 'Ctrl+Enter',
          })}
          onClick={() => void start()}
        >
          {agent && !running && (hive ? <HexagonIcon /> : <ArrowRightIcon />)}
          {running ? <Loading inline>Starting…</Loading> : startWords}
          {agent && !running && (
            <kbd className="start-keys" aria-hidden="true">
              Ctrl ↵
            </kbd>
          )}
        </button>
      </StartHead>
      {error && (
        <pre className="error start-error" role="alert">
          {error}
        </pre>
      )}
      <div className="start-body">
        <div className="start-columns">
          {/* The brief (V93, proof 06): the kinds as line tabs in its head, its fields under. */}
          <section className="start-brief" aria-label="The brief">
            <StartKinds kinds={kinds} current={spec} onPick={pick} />
            <StartBrief
              form={form}
              edit={edit}
              spec={spec}
              options={options}
              main={main}
              mainHeading={mainHeading}
              heading={heading}
              picker={picker}
              length={length}
              tooLong={tooLong}
              guess={guess}
              hive={hive}
              hiveCheck={hiveCheck}
              documentsCard={documentsCard}
            />
          </section>
          <div className="start-run">
            <StartSource
              hive={hive}
              options={options}
              at={at}
              base={base}
              run={run}
              choose={choose}
              setOnCommit={setOnCommit}
              form={form}
              edit={edit}
              branch={branch}
              problem={problem}
              agent={agent}
              model={model}
              models={models}
              effort={effort}
              efforts={efforts}
            />
            <SuggestionCard
              asked={suggestion.asked}
              agent={agent}
              run={run}
              current={{ model, effort, planFirst }}
              onChoose={choose}
              onClose={suggestion.close}
            />
            {hive && agent ? (
              <HiveHow check={hiveCheck} into={base.from ?? 'its branch'} />
            ) : (
              <StartAgent
                agents={offered}
                hive={hive}
                agent={agent}
                run={run}
                mode={mode}
                model={model}
                models={models}
                effort={effort}
                efforts={efforts}
                onChoose={choose}
                planFirst={
                  !hive && (
                    <div className="start-plan-first">
                      <div>
                        <label htmlFor="start-plan">Plan first and wait for my OK</label>
                        <p className="start-card-note">
                          The agent proposes a plan before it changes anything.
                        </p>
                      </div>
                      <input
                        id="start-plan"
                        type="checkbox"
                        role="switch"
                        checked={planFirst}
                        onChange={(event) => choose({ ...run, planFirst: event.target.checked })}
                      />
                    </div>
                  )
                }
              />
            )}
            {!hive && (
              <NextSteps
                planFirst={planFirst}
                into={base.from ?? 'its branch'}
                kind={form.kind}
                agent={agent !== null}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
