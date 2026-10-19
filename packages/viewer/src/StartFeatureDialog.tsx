import { useEffect, useRef, useState } from 'react';
import type {
  CheckGuess,
  FeatureOptions,
  FeatureRequest,
  PermissionMode,
  WorkKindSpec,
} from '@cpr/core';
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
import { branchProblem, PERMISSION_LABELS, proposeBranch } from './features.js';
import { getJson, postJson } from './http.js';
import { shortSha } from './commits.js';

/** How long typing pauses before the draft is saved. */
const SAVE_AFTER_MS = 400;

/**
 * "Start a workspace" (V18, V24c): the kind of work, its title and parts (what the server makes
 * the agent's brief of), the branch (named after the title until edited), where it starts, plan
 * first, the agent with its account and permission mode, and where its worktree goes. The form
 * is kept as a draft by `cpr view` until it starts. Ctrl+Enter starts, Escape cancels.
 */
export function StartFeatureDialog({
  options,
  base,
  taken,
  draft,
  running,
  error,
  onStart,
  onCancel,
}: {
  options: FeatureOptions;
  /** A picked row's commit; else the default branch's tip (`options.base`). */
  base: { sha: string; from?: string };
  /** Branch names in use, locally or on a remote. */
  taken: ReadonlySet<string>;
  /** The draft as `cpr view` keeps it; anything not one is a new form. */
  draft: unknown;
  running: boolean;
  error: string | null;
  onStart: (request: FeatureRequest) => void;
  onCancel: () => void;
}) {
  const { kinds } = options;
  const specOf = (kind: string): WorkKindSpec =>
    kinds.find((k) => k.kind === kind) ?? (kinds[0] as WorkKindSpec);
  const [form, setForm] = useState<BriefForm>(
    () => readDraft(draft, kinds, null) ?? newForm(specOf('feature'), null),
  );
  const [guess, setGuess] = useState<CheckGuess | null>(null);
  const [moreShown, setMoreShown] = useState(false);
  const [planFirst, setPlanFirst] = useState(true);
  const [mode, setMode] = useState<PermissionMode>(options.agent?.permissionMode ?? 'default');
  const spec = specOf(form.kind);

  // The check command, guessed at the commit it starts from (V24b); words until it comes.
  useEffect(() => {
    let current = true;
    getJson<Partial<CheckGuess>>(`/api/features/check?at=${base.sha}`)
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
    // The kinds and the commit do not change while the dialog is open.
  }, [base.sha]);

  // The draft: saved once typing pauses, at once on Start; after a start only the kind is kept.
  const saving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(form);
  latest.current = form;
  const started = useRef(false);
  const save = (value: object) => void postJson('/api/features/draft', value).catch(() => {});
  const edit = (next: BriefForm) => {
    setForm(next);
    if (saving.current) clearTimeout(saving.current);
    saving.current = setTimeout(() => {
      saving.current = null;
      save(next);
    }, SAVE_AFTER_MS);
  };
  useEffect(() => {
    // A start that failed leaves the dialog open: closing it keeps the draft.
    if (error) started.current = false;
  }, [error]);
  useEffect(
    () => () => {
      if (started.current) save({ kind: latest.current.kind });
      else if (saving.current) save(latest.current);
      if (saving.current) clearTimeout(saving.current);
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

  const start = () => {
    if (!ready) return;
    if (saving.current) clearTimeout(saving.current);
    saving.current = null;
    save(form);
    started.current = true;
    onStart({
      kind: form.kind,
      title: form.title,
      parts: formParts(form, spec),
      branch,
      planFirst,
      // The default branch's tip is the server's to find at the start; a row is that commit.
      ...(base.from ? {} : { base: base.sha }),
      ...(options.agent ? { permissionMode: mode } : {}),
    });
  };
  const pick = (kind: WorkKindSpec) => {
    if (kind.kind !== form.kind) edit(withKind(form, spec, kind, guess));
  };
  const { agent } = options;
  const folder = options.worktrees.replace('<branch>', branch.replaceAll('/', '-'));
  const at = kinds.indexOf(spec);
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog feature-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feature-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !running) onCancel();
          else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) start();
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <h2 id="feature-title">Start a workspace</h2>
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
            const radios = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
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
        <label className="feature-field">
          Title
          <input
            type="text"
            autoFocus
            value={form.title}
            placeholder="A short name: the workspace's and its branch's"
            onChange={(event) => edit({ ...form, title: event.target.value })}
          />
        </label>
        <label className="feature-field">
          {heading(main)}
          <textarea
            rows={5}
            value={form.main}
            placeholder={HINTS[main]}
            onChange={(event) => edit({ ...form, main: event.target.value })}
          />
        </label>
        <label className="feature-field">
          <span>
            Done when <span className="field-optional">optional</span>
          </span>
          <textarea
            rows={2}
            value={form.doneWhen}
            placeholder={`${HINTS.doneWhen} e.g. ${checkWords(guess)}, and …`}
            onChange={(event) => edit({ ...form, doneWhen: event.target.value })}
          />
        </label>
        {guess && (
          <p className="dialog-note feature-check-guess">
            Check: <code>{guess.command}</code>, from {guess.source}
          </p>
        )}
        <button
          type="button"
          className="link feature-more"
          aria-expanded={moreOpen}
          onClick={() => setMoreShown(!moreOpen)}
        >
          {moreOpen ? '▾' : '▸'} More: {more.map(heading).join(', ')}
        </button>
        {moreOpen &&
          more.map((part) => (
            <label key={part} className="feature-field">
              <span>
                {heading(part)} <span className="field-optional">optional</span>
              </span>
              <textarea
                rows={2}
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
        <label className="feature-field">
          Branch
          <input
            type="text"
            className="branch-input"
            value={branch}
            spellCheck={false}
            aria-invalid={form.title.trim() !== '' && problem !== null}
            onChange={(event) => edit({ ...form, branch: event.target.value })}
          />
        </label>
        <p className="dialog-note feature-from">
          From{' '}
          {base.from ? (
            <>
              <span className="ref ref-branch">{base.from}</span> at{' '}
            </>
          ) : (
            'the commit '
          )}
          <code>{shortSha(base.sha)}</code>, in <code title={folder}>{folder}</code>
        </p>
        {form.title.trim() !== '' && problem && <p className="error">{problem}</p>}
        <label className="feature-check">
          <input
            type="checkbox"
            checked={planFirst}
            onChange={(event) => setPlanFirst(event.target.checked)}
          />
          Plan first and wait for my OK
        </label>
        {agent ? (
          <p className="dialog-note feature-agent">
            <span title={agent.command}>Claude Code</span>
            {agent.account && <> · {agent.account}</>} ·{' '}
            <label>
              permission{' '}
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as PermissionMode)}
              >
                {(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((m) => (
                  <option key={m} value={m}>
                    {PERMISSION_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          </p>
        ) : (
          <p className="dialog-note">
            No agent found (Claude Code: <code>claude</code> on PATH, or <code>CPR_CLAUDE</code>):
            the branch and its worktree are made, and you get the prompt to give an agent.
          </p>
        )}
        {agent?.apiKey && (
          <p className="error">
            ANTHROPIC_API_KEY is set where cpr view runs: the agent may use that key instead of{' '}
            {agent.account ?? 'your account'}.
          </p>
        )}
        {error && <pre className="error">{error}</pre>}
        <div className="dialog-buttons">
          <button
            type="button"
            className="link feature-clear"
            disabled={running}
            title="Empty the form; the kind stays"
            onClick={() => edit(newForm(spec, guess))}
          >
            Clear
          </button>
          <button type="button" className="link" disabled={running} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button"
            disabled={!ready}
            title="Ctrl+Enter"
            onClick={start}
          >
            {running ? 'Starting…' : agent ? 'Start' : 'Make the branch'}
          </button>
        </div>
      </div>
    </div>
  );
}
