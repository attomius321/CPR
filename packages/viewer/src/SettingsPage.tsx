import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PromptKey, PromptSetting, PromptSettings, ScoutEfforts } from '@symbiote/core';
import { EffortStepper } from './EffortStepper.js';
import { Help } from './Help.js';
import { getJson, postJson } from './http.js';
import { useShell } from './shell-context.js';
import { setTheme, useTheme, type Theme } from './theme.js';
import {
  draftProblem,
  gitNote,
  insertAt,
  isEdited,
  promptGroups,
  promptOfUrl,
  sizeOf,
} from './settings.js';
import { AGENT_NAMES, effortChoices, keptEffort } from './workspaces.js';

const API = '/api/settings/prompts';

/** Scout's effort (fix/scout-effort-level): listed in Scout's group, after its prompt. */
const SCOUT_EFFORT = 'scout.effort';
type SettingKey = PromptKey | typeof SCOUT_EFFORT;

/** The drafts without `key`'s. */
const without = (drafts: Partial<Record<PromptKey, string>>, key: PromptKey) =>
  Object.fromEntries(Object.entries(drafts).filter(([k]) => k !== key)) as typeof drafts;

/** What the page says after a save or a reset, under that prompt. */
interface Notice {
  key: PromptKey;
  text: string;
  error?: boolean;
  /** The file changed since it was read (409): load it again, the drafts kept. */
  stale?: boolean;
}

/**
 * Settings (V28b): every agent's prompts, Symbiote's until the project changes them. A change is
 * saved in `symbiote/config.json` (`prompts`); unsaved drafts are kept while another prompt is
 * open, and leaving the page with one asks first.
 */
export function SettingsPage() {
  const [settings, setSettings] = useState<PromptSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SettingKey | null>(null);
  /** On a narrow screen, a prompt picked takes the page (`?prompt=` in the address). */
  const [picked, setPicked] = useState(() =>
    new URLSearchParams(window.location.search).has('prompt'),
  );
  const [drafts, setDrafts] = useState<Partial<Record<PromptKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      const read = await getJson<PromptSettings>(API);
      setSettings(read);
      setError(null);
      return read;
    } catch (failed) {
      setError(`The prompts could not be read: ${(failed as Error).message}`);
      return null;
    }
  }, []);
  useEffect(() => {
    void load().then((read) => {
      if (read)
        setOpen(
          promptOfUrl<SettingKey>(window.location.search, [
            ...read.prompts.map((p) => p.key),
            SCOUT_EFFORT,
          ]),
        );
    });
  }, [load]);

  const edited = useMemo(
    () => settings?.prompts.filter((p) => isEdited(p, drafts[p.key])).map((p) => p.key) ?? [],
    [settings, drafts],
  );
  // Leaving with an unsaved change asks first: closing or reloading the page (the browser asks),
  // and going elsewhere in the shell (V29a), which does not load another page.
  const setLeaveGuard = useShell()?.setLeaveGuard;
  useEffect(() => {
    if (edited.length === 0) return;
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    setLeaveGuard?.({
      question: 'Leave Settings?',
      detail: `${edited.length === 1 ? 'A prompt is' : `${edited.length} prompts are`} changed and not saved.`,
    });
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      setLeaveGuard?.(null);
    };
  }, [edited.length, setLeaveGuard]);

  const show = (key: SettingKey) => {
    setOpen(key);
    setPicked(true);
    setNotice((current) => (current?.key === key ? current : null));
    window.history.replaceState(null, '', `?prompt=${encodeURIComponent(key)}`);
  };
  const back = () => {
    setPicked(false);
    window.history.replaceState(null, '', window.location.pathname);
  };

  const save = async (prompt: PromptSetting, text: string | null) => {
    if (!settings) return;
    setBusy(true);
    try {
      const next = await postJson<PromptSettings>(API, {
        key: prompt.key,
        text,
        version: settings.version,
      });
      setSettings(next);
      setDrafts((all) => without(all, prompt.key));
      setNotice({
        key: prompt.key,
        text: `${text === null ? "Symbiote's text again." : 'Saved.'} ${gitNote(next)}`,
      });
    } catch (failed) {
      const message = (failed as Error).message;
      setNotice({
        key: prompt.key,
        text: message,
        error: true,
        ...(message.includes('changed since') ? { stale: true } : {}),
      });
    } finally {
      setBusy(false);
    }
  };

  const current = settings?.prompts.find((p) => p.key === open);
  return (
    <div className="settings">
      <div className="commits-title settings-bar">
        <h1>Settings</h1>
        <Help label="About Settings">
          What Symbiote tells each agent · Symbiote&apos;s text until you change it · saved in{' '}
          {settings?.file ?? 'symbiote/config.json'}, for everyone once committed
        </Help>
        <Appearance />
      </div>
      {error && (
        <p className="commits-error error" role="alert">
          {error}
        </p>
      )}
      {settings?.warning && (
        <p className="settings-warning" role="alert">
          {settings.warning}
        </p>
      )}
      {settings && <p className="settings-git">{gitNote(settings)}</p>}
      {!settings ? (
        !error && <p className="hint">Reading the prompts…</p>
      ) : (
        <div className={`settings-body${picked ? ' picked' : ''}`}>
          <nav className="settings-list" aria-label="Settings">
            {promptGroups(settings.prompts).map(({ group, prompts }) => (
              <section key={group} aria-label={group}>
                <h2>{group}</h2>
                <ul>
                  {prompts.map((p) => (
                    <li key={p.key}>
                      <button
                        type="button"
                        aria-current={p.key === open ? 'true' : undefined}
                        onClick={() => show(p.key)}
                      >
                        <span className="settings-name">{p.title}</span>
                        {edited.includes(p.key) ? (
                          <span className="settings-mark unsaved">not saved</span>
                        ) : p.warning ? (
                          <span className="settings-mark warning">not used</span>
                        ) : (
                          p.changed && <span className="settings-mark changed">changed</span>
                        )}
                      </button>
                    </li>
                  ))}
                  {group === 'Scout' && (
                    <li>
                      <button
                        type="button"
                        aria-current={open === SCOUT_EFFORT ? 'true' : undefined}
                        onClick={() => show(SCOUT_EFFORT)}
                      >
                        <span className="settings-name">Effort</span>
                      </button>
                    </li>
                  )}
                </ul>
              </section>
            ))}
          </nav>
          {current && (
            <PromptEditor
              key={current.key}
              prompt={current}
              draft={drafts[current.key]}
              busy={busy}
              notice={notice?.key === current.key ? notice : null}
              onDraft={(text) => setDrafts((all) => ({ ...all, [current.key]: text }))}
              onDiscard={() => setDrafts((all) => without(all, current.key))}
              onSave={(text) => void save(current, text)}
              onLoad={() => void load().then(() => setNotice(null))}
              onBack={back}
            />
          )}
          {open === SCOUT_EFFORT && (
            // A save changes the file: the prompts' version is read again, or their next save
            // would be refused as changed since.
            <ScoutEffort onSaved={() => void load()} onBack={back} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Scout's effort (fix/scout-effort-level): `scout.effort` in the project's config, the level each
 * conversation starts at, on a stepper of Scout's agent's levels; saved when the handle is let go.
 */
function ScoutEffort({ onSaved, onBack }: { onSaved: () => void; onBack: () => void }) {
  const [read, setRead] = useState<ScoutEfforts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  // One save after another, in the order they were made.
  const saving = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let current = true;
    getJson<ScoutEfforts>('/api/scout/efforts')
      .then((answer) => {
        if (!current) return;
        setRead(answer);
        setLevel(keptEffort(answer.effort, answer.agents[0] ?? {}) ?? '');
      })
      .catch((failed: unknown) => {
        if (current) setError(`Scout's levels could not be read: ${(failed as Error).message}`);
      });
    return () => {
      current = false;
    };
  }, []);

  // Scout's default agent: the one a conversation starts with unless another is picked.
  const agent = read?.agents[0];
  const name = agent ? AGENT_NAMES[agent.kind] : '';
  const choices = agent ? effortChoices(agent) : [];
  const unlisted =
    read?.effort && agent?.efforts && !agent.efforts.levels.includes(read.effort)
      ? read.effort
      : undefined;
  const commit = (next: string) => {
    saving.current = saving.current.then(async () => {
      try {
        setRead(await postJson<ScoutEfforts>('/api/scout/effort', { effort: next || null }));
        setNotice({
          text: `Saved. Scout's next conversation starts at ${next ? next : `${name}'s default`}.`,
        });
        onSaved();
      } catch (failed) {
        setNotice({ text: (failed as Error).message, error: true });
      }
    });
  };

  return (
    <section className="settings-editor" aria-label="Scout: Effort">
      <button type="button" className="link settings-back" onClick={onBack}>
        ← All prompts
      </button>
      <h2>Scout: Effort</h2>
      <p className="settings-about">
        The level each of Scout&apos;s conversations starts at
        {name ? `, from ${name}'s levels` : ''}. Default passes none: the agent&apos;s own setting
        decides. Scout&apos;s page can start one conversation at another; <code>/effort</code> in
        its terminal changes it after. Saved in {read?.file ?? 'symbiote/config.json'} (
        <code>scout.effort</code>) when you let go.
      </p>
      {error && (
        <p className="settings-warning" role="alert">
          {error}
        </p>
      )}
      {read && !agent && (
        <p className="settings-warning" role="alert">
          Scout needs Claude Code or Codex: neither is installed here.
        </p>
      )}
      {agent && !agent.efforts && (
        <p className="settings-warning" role="alert">
          Symbiote cannot read {name}&apos;s effort levels: Scout starts it at its default.
        </p>
      )}
      {unlisted && (
        <p className="settings-warning" role="alert">
          scout.effort is {unlisted}, which {name} does not list: Scout starts it at its default.
        </p>
      )}
      {choices.length > 0 && (
        <EffortStepper
          label="Effort"
          choices={choices}
          value={level}
          onChange={setLevel}
          onCommit={commit}
        />
      )}
      {notice && (
        <p className={`settings-notice${notice.error ? ' error' : ''}`} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}

const THEMES: { theme: Theme; label: string }[] = [
  { theme: 'dark', label: 'Dark' },
  { theme: 'light', label: 'Light' },
  { theme: 'system', label: 'System' },
];

/** The page's theme for this browser (V29b, decision 179): dark unless chosen. */
function Appearance() {
  const theme = useTheme();
  return (
    <span className="appearance">
      <span className="appearance-label" id="appearance-label">
        Appearance <span className="field-optional">(this browser)</span>
      </span>
      <span className="scopes" role="group" aria-labelledby="appearance-label">
        {THEMES.map((choice) => (
          <button
            key={choice.theme}
            type="button"
            className={theme === choice.theme ? 'scope active' : 'scope'}
            aria-pressed={theme === choice.theme}
            onClick={() => setTheme(choice.theme)}
          >
            {choice.label}
          </button>
        ))}
      </span>
    </span>
  );
}

/** One prompt: its text to change, its placeholders, Save and Reset. */
function PromptEditor({
  prompt,
  draft,
  busy,
  notice,
  onDraft,
  onDiscard,
  onSave,
  onLoad,
  onBack,
}: {
  prompt: PromptSetting;
  draft: string | undefined;
  busy: boolean;
  notice: Notice | null;
  onDraft: (text: string) => void;
  onDiscard: () => void;
  /** The text to save; null for Symbiote's. */
  onSave: (text: string | null) => void;
  onLoad: () => void;
  onBack: () => void;
}) {
  const text = draft ?? prompt.text;
  const edited = isEdited(prompt, draft);
  const problem = draftProblem(prompt, text);
  const [resetting, setResetting] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const canSave = edited && !problem && !busy;
  // As tall as its text, wrapped lines too, up to 70 % of the window (its CSS max-height).
  useLayoutEffect(() => {
    const field = area.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + 2}px`;
  }, [text]);

  const insert = (name: string) => {
    const field = area.current;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    const next = insertAt(text, start, end, `{${name}}`);
    onDraft(next.text);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  return (
    <section className="settings-editor" aria-label={`${prompt.group}: ${prompt.title}`}>
      <button type="button" className="link settings-back" onClick={onBack}>
        ← All prompts
      </button>
      <h2>
        {prompt.group}: {prompt.title}
        <span className={`settings-state${prompt.changed ? ' changed' : ''}`}>
          {prompt.changed ? "The project's" : "Symbiote's"}
        </span>
      </h2>
      <p className="settings-about">{prompt.about}</p>
      {prompt.warning && (
        <p className="settings-warning" role="alert">
          {prompt.warning}
        </p>
      )}
      <textarea
        ref={area}
        aria-label={`${prompt.title} prompt`}
        value={text}
        spellCheck={false}
        rows={4}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          const saving =
            (event.key === 's' && (event.ctrlKey || event.metaKey)) ||
            (event.key === 'Enter' && (event.ctrlKey || event.metaKey));
          if (!saving) return;
          event.preventDefault();
          if (canSave) onSave(text);
        }}
      />
      <p className={`settings-size${problem ? ' error' : ''}`}>{problem ?? sizeOf(prompt, text)}</p>
      {prompt.fixed && (
        <div className="settings-fixed">
          <p>Symbiote adds this after it, as the answer it reads; it cannot be changed:</p>
          <pre>{prompt.fixed}</pre>
        </div>
      )}
      {prompt.placeholders.length > 0 ? (
        <div className="settings-placeholders">
          <p>Filled in when it is used (click one to insert it at the cursor):</p>
          <ul>
            {prompt.placeholders.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  className="link"
                  title="Insert it at the cursor"
                  onClick={() => insert(p.name)}
                >
                  {`{${p.name}}`}
                </button>{' '}
                {p.about}
                {p.required && <strong> (required)</strong>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="settings-placeholders">No placeholders: the agent is given it as written.</p>
      )}
      <div className="settings-actions">
        {notice && (
          <span className={`settings-notice${notice.error ? ' error' : ''}`} role="status">
            {notice.text}
            {notice.stale && (
              <>
                {' '}
                <button type="button" className="link" onClick={onLoad}>
                  Read it again
                </button>
              </>
            )}
          </span>
        )}
        {edited && (
          <button type="button" className="link" disabled={busy} onClick={onDiscard}>
            Discard changes
          </button>
        )}
        {prompt.changed &&
          (resetting ? (
            <span className="workspace-confirm">
              The project&apos;s text leaves {`prompts.${prompt.key}`}.{' '}
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  setResetting(false);
                  onSave(null);
                }}
              >
                Reset
              </button>{' '}
              <button type="button" className="link" onClick={() => setResetting(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => setResetting(true)}
            >
              Reset to Symbiote&apos;s
            </button>
          ))}
        <button
          type="button"
          className="button"
          disabled={!canSave}
          title="Save it in the project's config (Ctrl+S)"
          onClick={() => onSave(text)}
        >
          Save
        </button>
      </div>
      {prompt.changed && (
        <details className="settings-default">
          <summary>Symbiote&apos;s text</summary>
          <pre>{prompt.default}</pre>
        </details>
      )}
    </section>
  );
}
