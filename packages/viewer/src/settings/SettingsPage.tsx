import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PromptKey, PromptSetting, PromptSettings, ScoutEfforts } from '@symbiote/core';
import { EffortStepper } from '../workspaces/EffortStepper.js';
import { Help } from '../ui/Help.js';
import { getJson, postJson } from '../ui/http.js';
import { BackIcon } from '../ui/icons.js';
import { useShell } from '../shell/shell-context.js';
import { setTheme, useTheme, type Theme } from '../shell/theme.js';
import { startIntro } from '../intro/intro.js';
import {
  draftProblem,
  gitNote,
  insertAt,
  isEdited,
  promptGroups,
  promptOfUrl,
  sizeOf,
} from './settings.js';
import {
  AGENT_NAMES,
  effortChoices,
  keptEffort,
  keptModel,
  modelChoices,
} from '../workspaces/workspaces.js';

const API = '/api/settings/prompts';

/**
 * An agent's effort in the project's config, listed in its group after its prompt: Scout's
 * (fix/scout-effort-level) and the merger's (V46d).
 */
interface EffortSetting {
  key: 'scout.effort' | 'merge.effort';
  group: 'Scout' | 'Merger';
  /** Where its levels are read and its level set: `<api>/efforts`, `<api>/effort`. */
  api: string;
  /** Its name in a sentence, and whose effort it is. */
  who: string;
  whose: string;
  /** What the level is for, before "from <agent>'s levels". */
  about: string;
  /** Where else it changes, when it does. */
  also?: ReactNode;
  /** What happens without a level it can use. */
  atDefault: string;
  /** What the next run does at `level` once saved. */
  saved: (level: string) => string;
}

const EFFORTS: readonly EffortSetting[] = [
  {
    key: 'scout.effort',
    group: 'Scout',
    api: '/api/scout',
    who: 'Scout',
    whose: "Scout's",
    about: "The level each of Scout's conversations starts at",
    also: (
      <>
        Scout&apos;s page can start one conversation at another; <code>/effort</code> in its
        terminal changes it after.
      </>
    ),
    atDefault: 'Scout starts it at its default',
    saved: (level) => `Saved. Scout's next conversation starts at ${level}.`,
  },
  {
    key: 'merge.effort',
    group: 'Merger',
    api: '/api/merges',
    who: 'The merger',
    whose: "the merger's",
    about: "The level each of the merger agent's runs is asked at",
    also: (
      <>Its log says the level each run was asked at, or why it was not (the merge&apos;s Log).</>
    ),
    atDefault: 'the merger runs it at its default',
    saved: (level) => `Saved. The merger agent's next run is asked at ${level}.`,
  },
];
type EffortKey = EffortSetting['key'];

/**
 * An agent's model in the project's config (V47), listed in its group before its Effort: Scout's,
 * Scribe's and the merger's, from their agent's own list.
 */
interface ModelSetting {
  key: 'scout.model' | 'scribe.model' | 'merge.model';
  group: 'Scout' | 'Scribe' | 'Merger';
  /** Where its models are read and its model set: `<api>/efforts`, `<api>/model`. */
  api: string;
  who: string;
  whose: string;
  /** What the model is for, before "from <agent>'s list". */
  about: string;
  /** What the next run does on `model` once saved. */
  saved: (model: string) => string;
  /** What happens with a configured model its agent does not list (decision 343). */
  unlisted: string;
}

const MODELS: readonly ModelSetting[] = [
  {
    key: 'scout.model',
    group: 'Scout',
    api: '/api/scout',
    who: 'Scout',
    whose: "Scout's",
    about: "The model each of Scout's conversations starts on",
    saved: (model) => `Saved. Scout's next conversation starts on ${model}.`,
    unlisted: 'Scout starts on the default',
  },
  {
    key: 'scribe.model',
    group: 'Scribe',
    api: '/api/scribe',
    who: 'Scribe',
    whose: "Scribe's",
    about: "The model each of Scribe's conversations starts on",
    saved: (model) => `Saved. Scribe's next conversation starts on ${model}.`,
    unlisted: 'Scribe starts on the default',
  },
  {
    key: 'merge.model',
    group: 'Merger',
    api: '/api/merges',
    who: 'The merger',
    whose: "the merger's",
    about: "The model each of the merger agent's runs is asked on",
    saved: (model) => `Saved. The merger agent's next run is asked on ${model}.`,
    unlisted: 'the merger asks on it as written',
  },
];
type ModelKey = ModelSetting['key'];
type SettingKey = PromptKey | EffortKey | ModelKey;

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
            ...MODELS.map((m) => m.key),
            ...EFFORTS.map((e) => e.key),
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
        {/* The first-time intro again (V39), as often as one likes: nothing is recorded. */}
        <button
          type="button"
          className="button secondary"
          onClick={() => startIntro({ record: false })}
        >
          Play the intro
        </button>
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
                  {MODELS.filter((m) => m.group === group).map((m) => (
                    <li key={m.key}>
                      <button
                        type="button"
                        aria-current={open === m.key ? 'true' : undefined}
                        onClick={() => show(m.key)}
                      >
                        <span className="settings-name">Model</span>
                      </button>
                    </li>
                  ))}
                  {EFFORTS.filter((e) => e.group === group).map((e) => (
                    <li key={e.key}>
                      <button
                        type="button"
                        aria-current={open === e.key ? 'true' : undefined}
                        onClick={() => show(e.key)}
                      >
                        <span className="settings-name">Effort</span>
                      </button>
                    </li>
                  ))}
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
          {MODELS.filter((m) => m.key === open).map((m) => (
            <AgentModelSetting key={m.key} setting={m} onSaved={() => void load()} onBack={back} />
          ))}
          {EFFORTS.filter((e) => e.key === open).map((e) => (
            // A save changes the file: the prompts' version is read again, or their next save
            // would be refused as changed since.
            <AgentEffort key={e.key} setting={e} onSaved={() => void load()} onBack={back} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * An agent's effort in the project's config, on a stepper of its agent's levels, saved when the
 * handle is let go: `scout.effort`, the level each Scout conversation starts at
 * (fix/scout-effort-level); `merge.effort`, the level each merger agent's run is asked at (V46d).
 */
function AgentEffort({
  setting,
  onSaved,
  onBack,
}: {
  setting: EffortSetting;
  onSaved: () => void;
  onBack: () => void;
}) {
  const [read, setRead] = useState<ScoutEfforts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  // One save after another, in the order they were made.
  const saving = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let current = true;
    getJson<ScoutEfforts>(`${setting.api}/efforts`)
      .then((answer) => {
        if (!current) return;
        setRead(answer);
        setLevel(keptEffort(answer.effort, answer.agents[0] ?? {}) ?? '');
      })
      .catch((failed: unknown) => {
        if (current) {
          setError(`${setting.whose} levels could not be read: ${(failed as Error).message}`);
        }
      });
    return () => {
      current = false;
    };
  }, [setting]);

  // Its agent: Scout's default (a conversation may pick another), the merger's (`merge.agent`).
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
        setRead(await postJson<ScoutEfforts>(`${setting.api}/effort`, { effort: next || null }));
        setNotice({ text: setting.saved(next ? next : `${name}'s default`) });
        onSaved();
      } catch (failed) {
        setNotice({ text: (failed as Error).message, error: true });
      }
    });
  };

  return (
    <section className="settings-editor" aria-label={`${setting.group}: Effort`}>
      <button type="button" className="button ghost settings-back" onClick={onBack}>
        <BackIcon /> All prompts
      </button>
      <h2>
        {setting.group}: Effort
        <Help label={`About ${setting.whose} effort`}>
          <p>
            {setting.about}
            {name ? `, from ${name}'s levels` : ''}. Default passes none: the agent&apos;s own
            setting decides.
          </p>
          <p>
            {setting.also} Saved in {read?.file ?? 'symbiote/config.json'} (
            <code>{setting.key}</code>) when you let go.
          </p>
        </Help>
      </h2>
      {error && (
        <p className="settings-warning" role="alert">
          {error}
        </p>
      )}
      {read && !agent && (
        <p className="settings-warning" role="alert">
          {setting.who} needs Claude Code or Codex: neither is installed here.
        </p>
      )}
      {agent && !agent.efforts && (
        <p className="settings-warning" role="alert">
          Symbiote cannot read {name}&apos;s effort levels: {setting.atDefault}.
        </p>
      )}
      {unlisted && (
        <p className="settings-warning" role="alert">
          {setting.key} is {unlisted}, which {name} does not list: {setting.atDefault}.
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

/**
 * An agent's model in the project's config (V47), a select of its agent's own list, saved when
 * picked: `scout.model`, `scribe.model`, `merge.model`.
 */
function AgentModelSetting({
  setting,
  onSaved,
  onBack,
}: {
  setting: ModelSetting;
  onSaved: () => void;
  onBack: () => void;
}) {
  const [read, setRead] = useState<ScoutEfforts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let current = true;
    getJson<ScoutEfforts>(`${setting.api}/efforts`)
      .then((answer) => {
        if (current) setRead(answer);
      })
      .catch((failed: unknown) => {
        if (current) {
          setError(`${setting.whose} models could not be read: ${(failed as Error).message}`);
        }
      });
    return () => {
      current = false;
    };
  }, [setting]);

  // Its agent: Scout's and Scribe's default (Scout's box may pick another), the merger's.
  const agent = read?.agents[0];
  const name = agent ? AGENT_NAMES[agent.kind] : '';
  const choices = agent ? modelChoices(agent) : [];
  const value = agent ? (keptModel(read?.model, agent) ?? '') : '';
  const unlisted = read?.model && agent?.models && value === '' ? read.model : undefined;
  const picked = choices.find((c) => c.value === value);
  const pick = async (next: string) => {
    setSaving(true);
    try {
      const answer = await postJson<ScoutEfforts>(`${setting.api}/model`, {
        model: next || null,
      });
      setRead(answer);
      const label = choices.find((c) => c.value === next)?.label ?? next;
      setNotice({ text: setting.saved(label) });
      onSaved();
    } catch (failed) {
      setNotice({ text: (failed as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-editor" aria-label={`${setting.group}: Model`}>
      <button type="button" className="button ghost settings-back" onClick={onBack}>
        <BackIcon /> All prompts
      </button>
      <h2>
        {setting.group}: Model
        <Help label={`About ${setting.whose} model`}>
          <p>
            {setting.about}
            {name ? `, from ${name}'s own list` : ''}. Default passes none of Settings&apos;: the
            first entry says which it is.
          </p>
          <p>
            Its Effort follows it: the levels shown are this model&apos;s. Saved in{' '}
            {read?.file ?? 'symbiote/config.json'} (<code>{setting.key}</code>) when you pick one.
          </p>
        </Help>
      </h2>
      {error && (
        <p className="settings-warning" role="alert">
          {error}
        </p>
      )}
      {read && !agent && (
        <p className="settings-warning" role="alert">
          {setting.who} needs Claude Code or Codex: neither is installed here.
        </p>
      )}
      {agent && !agent.models && (
        <p className="settings-warning" role="alert">
          Symbiote cannot read {name}&apos;s models: none can be picked here.
        </p>
      )}
      {unlisted && (
        <p className="settings-warning" role="alert">
          {setting.key} is {unlisted}, which {name} does not list: {setting.unlisted}.
        </p>
      )}
      {choices.length > 0 && (
        <div className="settings-model">
          <select
            aria-label="Model"
            value={value}
            disabled={saving}
            onChange={(event) => void pick(event.target.value)}
          >
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {picked?.description && <p className="settings-model-note">{picked.description}</p>}
        </div>
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
      <button type="button" className="button ghost settings-back" onClick={onBack}>
        <BackIcon /> All prompts
      </button>
      <h2>
        {prompt.group}: {prompt.title}
        <span className={`settings-state${prompt.changed ? ' changed' : ''}`}>
          {prompt.changed ? "The project's" : "Symbiote's"}
        </span>
        <Help label={`About ${prompt.group}: ${prompt.title}`}>
          <p>{prompt.about}</p>
          {prompt.placeholders.length > 0 && (
            <p>
              Its placeholders are filled in when it is used; click one to insert it at the cursor.
            </p>
          )}
        </Help>
      </h2>
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
          <p>Placeholders</p>
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
          <button type="button" className="button ghost" disabled={busy} onClick={onDiscard}>
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
              <button type="button" className="button ghost" onClick={() => setResetting(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="button ghost"
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
