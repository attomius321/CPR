import { useState } from 'react';
import type { FeatureOptions, FeatureRequest, PermissionMode } from '@cpr/core';
import { branchProblem, PERMISSION_LABELS, proposeBranch } from './features.js';
import { shortSha } from './commits.js';

/**
 * "Start a feature" (V18): what the agent should build, the branch (named after the brief until
 * edited), where it starts, plan first, the agent with its account and permission mode, and
 * where its worktree goes. Ctrl+Enter starts, Escape cancels.
 */
export function StartFeatureDialog({
  options,
  base,
  taken,
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
  running: boolean;
  error: string | null;
  onStart: (request: FeatureRequest) => void;
  onCancel: () => void;
}) {
  const [brief, setBrief] = useState('');
  // The name follows the brief until the person types one.
  const [typed, setTyped] = useState<string | null>(null);
  const [planFirst, setPlanFirst] = useState(true);
  const [mode, setMode] = useState<PermissionMode>(options.agent?.permissionMode ?? 'default');
  const branch = typed ?? proposeBranch(brief, options.branchPrefixes.feature, taken);
  const problem = branchProblem(branch, taken);
  const tooLong = brief.length > options.maxBrief;
  const ready = brief.trim() !== '' && !problem && !tooLong && !running;
  const start = () => {
    if (!ready) return;
    onStart({
      brief,
      branch,
      planFirst,
      // The default branch's tip is the server's to find at the start; a row is that commit.
      ...(base.from ? {} : { base: base.sha }),
      ...(options.agent ? { permissionMode: mode } : {}),
    });
  };
  const { agent } = options;
  const folder = options.worktrees.replace('<branch>', branch.replaceAll('/', '-'));
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
        <label className="feature-field">
          What should the agent build?
          <textarea
            autoFocus
            rows={7}
            value={brief}
            placeholder="The work, as you would brief a colleague: what, why, what done looks like."
            onChange={(event) => setBrief(event.target.value)}
          />
        </label>
        {tooLong && (
          <p className="error">
            The brief is {brief.length.toLocaleString('en')} characters; at most{' '}
            {options.maxBrief.toLocaleString('en')}.
          </p>
        )}
        <label className="feature-field">
          Branch
          <input
            type="text"
            value={branch}
            spellCheck={false}
            aria-invalid={brief.trim() !== '' && problem !== null}
            onChange={(event) => setTyped(event.target.value)}
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
        {brief.trim() !== '' && problem && <p className="error">{problem}</p>}
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
