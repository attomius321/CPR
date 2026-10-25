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
  markOf,
  promptGroups,
  promptOfUrl,
  sizeOf,
  type PrebuiltAgent,
} from './settings.js';
import {
  AGENT_NAMES,
  effortChoices,
  keptEffort,
  keptModel,
  modelChoices,
} from '../workspaces/workspaces.js';

const API = '/api/settings/prompts';

/** A prebuilt agent's model in the project's config (V47), from its agent's own list. */
interface ModelSetting {
  key: 'scout.model' | 'scribe.model' | 'merge.model';
  /** What the model is for, before "from <agent>'s list". */
  about: string;
  /** What the next run does on `model` once saved. */
  saved: (model: string) => string;
  /** What happens with a configured model its agent does not list (decision 343). */
  unlisted: string;
}

/**
 * A prebuilt agent's effort in the project's config: Scout's (fix/scout-effort-level), the
 * merger's (V46d) and Scribe's (fix/scribe-effort-level).
 */
interface EffortSetting {
  key: 'scout.effort' | 'scribe.effort' | 'merge.effort';
  /** What the level is for, before "from <agent>'s levels". */
  about: string;
  /** Where else it changes, when it does. */
  also?: ReactNode;
  /** What happens without a level it can use. */
  atDefault: string;
  /** What the next run does at `level` once saved. */
  saved: (level: string) => string;
}

/** A prebuilt agent's settings beside its prompts, on its page (fix/scout-merger-scribe-settings). */
interface AgentSettings {
  /** Where its models and levels are read (`<api>/efforts`), and set (`<api>/model`, `/effort`). */
  api: string;
  /** Its name in a sentence, and whose settings they are. */
  who: string;
  whose: string;
  model: ModelSetting;
  effort: EffortSetting;
}

const AGENTS: Record<PrebuiltAgent, AgentSettings> = {
  Merger: {
    api: '/api/merges',
    who: 'The merger',
    whose: "the merger's",
    model: {
      key: 'merge.model',
      about: "The model each of the merger agent's runs is asked on",
      saved: (model) => `Saved. The merger agent's next run is asked on ${model}.`,
      unlisted: 'the merger asks on it as written',
    },
    effort: {
      key: 'merge.effort',
      about: "The level each of the merger agent's runs is asked at",
      also: (
        <>Its log says the level each run was asked at, or why it was not (the merge&apos;s Log).</>
      ),
      atDefault: 'the merger runs it at its default',
      saved: (level) => `Saved. The merger agent's next run is asked at ${level}.`,
    },
  },
  Scout: {
    api: '/api/scout',
    who: 'Scout',
    whose: "Scout's",
    model: {
      key: 'scout.model',
      about: 'The model Scout starts on when it opens with no conversation',
      saved: (model) => `Saved. Scout starts on ${model} when it next opens with no conversation.`,
      unlisted: 'Scout starts on the default',
    },
    effort: {
      key: 'scout.effort',
      about: 'The level Scout starts at when it opens with no conversation',
      also: (
        <>
          After that, the head of Scout&apos;s page says what New conversation starts on;{' '}
          <code>/effort</code> in its terminal changes a running one.
        </>
      ),
      atDefault: 'Scout starts it at its default',
      saved: (level) => `Saved. Scout starts at ${level} when it next opens with no conversation.`,
    },
  },
  Scribe: {
    api: '/api/scribe',
    who: 'Scribe',
    whose: "Scribe's",
    model: {
      key: 'scribe.model',
      about: "The model each of Scribe's conversations starts on",
      saved: (model) => `Saved. Scribe's next conversation starts on ${model}.`,
      unlisted: 'Scribe starts on the default',
    },
    effort: {
      key: 'scribe.effort',
      about: "The level each of Scribe's conversations starts at",
      also: (
        <>
          Scribe&apos;s box on the Skills page can start one conversation at another;{' '}
          <code>/effort</code> in its terminal changes it after.
        </>
      ),
      atDefault: 'Scribe starts it at its default',
      saved: (level) => `Saved. Scribe's next conversation starts at ${level}.`,
    },
  },
};

/** This browser's settings (V51, decision 388): an entry of their own at the list's end. */
const APPEARANCE = 'appearance';
const BROWSER_GROUP = 'This browser';
type EntryKey = PromptKey | typeof APPEARANCE;

/** The list's mark for an entry, by `markOf`. */
const MARKS = { unsaved: 'not saved', warning: 'not used', changed: 'changed' } as const;

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
 * open, and leaving the page with one asks first. A prebuilt agent is one entry, whose page holds
 * its model, its effort and its prompt (fix/scout-merger-scribe-settings). This browser's
 * Appearance is the last entry (V51), listed even when the prompts cannot be read.
 */
export function SettingsPage() {
  const [settings, setSettings] = useState<PromptSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<EntryKey | null>(null);
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
      const keys = read
        ? promptGroups(read.prompts).flatMap((g) => g.entries.map((e) => e.key))
        : [];
      setOpen(promptOfUrl<EntryKey>(window.location.search, [...keys, APPEARANCE]));
    });
  }, [load]);

  const groups = useMemo(() => (settings ? promptGroups(settings.prompts) : []), [settings]);
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

  const show = (key: EntryKey) => {
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

  const editor = (prompt: PromptSetting, part?: boolean) => (
    <PromptEditor
      key={prompt.key}
      prompt={prompt}
      part={part}
      draft={drafts[prompt.key]}
      busy={busy}
      notice={notice?.key === prompt.key ? notice : null}
      onDraft={(text) => setDrafts((all) => ({ ...all, [prompt.key]: text }))}
      onDiscard={() => setDrafts((all) => without(all, prompt.key))}
      onSave={(text) => void save(prompt, text)}
      onLoad={() => void load().then(() => setNotice(null))}
      onBack={back}
    />
  );
  const current = groups.flatMap((g) => g.entries).find((e) => e.key === open);
  return (
    <div className="settings">
      <div className="commits-title settings-bar">
        <h1>Settings</h1>
        <Help label="About Settings">
          What Symbiote tells each agent · Symbiote&apos;s text until you change it · saved in{' '}
          {settings?.file ?? 'symbiote/config.json'}, for everyone once committed
        </Help>
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
      {!settings && !error ? (
        <p className="hint">Reading the prompts…</p>
      ) : (
        <div className={`settings-body${picked ? ' picked' : ''}`}>
          <nav className="settings-list" aria-label="Settings">
            {groups.map(({ group, entries }) => (
              <section key={group} aria-label={group}>
                <h2>{group}</h2>
                <ul>
                  {entries.map((entry) => {
                    const mark = markOf(entry.prompts, edited);
                    return (
                      <li key={entry.key}>
                        <button
                          type="button"
                          aria-current={entry.key === open ? 'true' : undefined}
                          onClick={() => show(entry.key)}
                        >
                          <span className="settings-name">{entry.name}</span>
                          {mark && <span className={`settings-mark ${mark}`}>{MARKS[mark]}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <section aria-label={BROWSER_GROUP}>
              <h2>{BROWSER_GROUP}</h2>
              <ul>
                <li>
                  <button
                    type="button"
                    aria-current={open === APPEARANCE ? 'true' : undefined}
                    onClick={() => show(APPEARANCE)}
                  >
                    <span className="settings-name">Appearance</span>
                  </button>
                </li>
              </ul>
            </section>
          </nav>
          {open === APPEARANCE ? (
            <AppearancePage onBack={back} />
          ) : current?.agent ? (
            // A save changes the file: the prompts' version is read again, or their next save
            // would be refused as changed since.
            <AgentPage
              key={current.key}
              name={current.agent}
              settings={AGENTS[current.agent]}
              onSaved={() => void load()}
              onBack={back}
            >
              {current.prompts.map((prompt) => editor(prompt, true))}
            </AgentPage>
          ) : (
            current?.prompts[0] && editor(current.prompts[0])
          )}
        </div>
      )}
    </div>
  );
}

/** The way back to the list, when a page takes a narrow screen. */
function BackToList({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="button ghost settings-back" onClick={onBack}>
      <BackIcon /> All settings
    </button>
  );
}

/**
 * A prebuilt agent's page (fix/scout-merger-scribe-settings): its Model and its Effort, rows of
 * one card (V51), then its prompts (`children`), a card each. The agent's models and levels are
 * read once for both: a model saved answers with its own levels, and the Effort follows it.
 */
function AgentPage({
  name,
  settings,
  onSaved,
  onBack,
  children,
}: {
  name: PrebuiltAgent;
  settings: AgentSettings;
  onSaved: () => void;
  onBack: () => void;
  children: ReactNode;
}) {
  const [read, setRead] = useState<ScoutEfforts | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getJson<ScoutEfforts>(`${settings.api}/efforts`)
      .then((answer) => {
        if (current) setRead(answer);
      })
      .catch((failed: unknown) => {
        if (current) {
          setError(
            `${settings.whose} models and levels could not be read: ${(failed as Error).message}`,
          );
        }
      });
    return () => {
      current = false;
    };
  }, [settings]);
  const saved = (answer: ScoutEfforts) => {
    setRead(answer);
    onSaved();
  };

  // Its agent: Scout's and Scribe's default (Scout's box may pick another), the merger's.
  const agent = read?.agents[0];
  return (
    <section className="settings-editor" aria-label={name}>
      <BackToList onBack={onBack} />
      <h2>{name}</h2>
      {error && (
        <p className="settings-warning" role="alert">
          {error}
        </p>
      )}
      {read && !agent && (
        <p className="settings-warning" role="alert">
          {settings.who} needs Claude Code or Codex: neither is installed here.
        </p>
      )}
      <div className="settings-card settings-rows">
        <AgentModel settings={settings} read={read} onSaved={saved} />
        <AgentEffort
          // Drawn again on another model: its levels, and the level kept on them, are that model's.
          key={read ? `on ${read.model ?? ''}` : 'reading'}
          settings={settings}
          read={read}
          onSaved={saved}
        />
      </div>
      {children}
    </section>
  );
}

/**
 * A prebuilt agent's effort in the project's config, on a stepper of its agent's levels, saved
 * when the handle is let go: `scout.effort` and `scribe.effort`, the level each of their
 * conversations starts at (fix/scout-effort-level, fix/scribe-effort-level); `merge.effort`, the
 * level each merger agent's run is asked at (V46d).
 */
function AgentEffort({
  settings,
  read,
  onSaved,
}: {
  settings: AgentSettings;
  /** The agent's models and levels, null while they are read. */
  read: ScoutEfforts | null;
  onSaved: (answer: ScoutEfforts) => void;
}) {
  const { effort: setting } = settings;
  const agent = read?.agents[0];
  const [level, setLevel] = useState(() =>
    read && agent ? (keptEffort(read.effort, agent) ?? '') : '',
  );
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  // One save after another, in the order they were made.
  const saving = useRef<Promise<void>>(Promise.resolve());

  const name = agent ? AGENT_NAMES[agent.kind] : '';
  const choices = agent ? effortChoices(agent) : [];
  const unlisted =
    read?.effort && agent?.efforts && !agent.efforts.levels.includes(read.effort)
      ? read.effort
      : undefined;
  const commit = (next: string) => {
    saving.current = saving.current.then(async () => {
      try {
        onSaved(await postJson<ScoutEfforts>(`${settings.api}/effort`, { effort: next || null }));
        setNotice({ text: setting.saved(next ? next : `${name}'s default`) });
      } catch (failed) {
        setNotice({ text: (failed as Error).message, error: true });
      }
    });
  };

  return (
    <section className="settings-part settings-effort" aria-label="Effort">
      <h3>
        Effort
        <Help label={`About ${settings.whose} effort`}>
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
      </h3>
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
 * A prebuilt agent's model in the project's config (V47), a select of its agent's own list, saved
 * when picked: `scout.model`, `scribe.model`, `merge.model`.
 */
function AgentModel({
  settings,
  read,
  onSaved,
}: {
  settings: AgentSettings;
  /** The agent's models and levels, null while they are read. */
  read: ScoutEfforts | null;
  onSaved: (answer: ScoutEfforts) => void;
}) {
  const { model: setting } = settings;
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const agent = read?.agents[0];
  const name = agent ? AGENT_NAMES[agent.kind] : '';
  const choices = agent ? modelChoices(agent) : [];
  const value = agent ? (keptModel(read?.model, agent) ?? '') : '';
  const unlisted = read?.model && agent?.models && value === '' ? read.model : undefined;
  const picked = choices.find((c) => c.value === value);
  const pick = async (next: string) => {
    setSaving(true);
    try {
      const answer = await postJson<ScoutEfforts>(`${settings.api}/model`, {
        model: next || null,
      });
      onSaved(answer);
      const label = choices.find((c) => c.value === next)?.label ?? next;
      setNotice({ text: setting.saved(label) });
    } catch (failed) {
      setNotice({ text: (failed as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-part" aria-label="Model">
      <h3>
        Model
        <Help label={`About ${settings.whose} model`}>
          <p>
            {setting.about}
            {name ? `, from ${name}'s own list` : ''}. Default passes none of Settings&apos;: the
            first entry says which it is.
          </p>
          <p>
            The Effort below follows it: its levels are this model&apos;s. Saved in{' '}
            {read?.file ?? 'symbiote/config.json'} (<code>{setting.key}</code>) when you pick one.
          </p>
        </Help>
      </h3>
      {/* A row (V51): the select beside the name, what it says under it. */}
      {choices.length > 0 && (
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
      )}
      {picked?.description && <p className="settings-row-note">{picked.description}</p>}
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

/**
 * This browser's Appearance (V51, decision 388; in the head before): the page's theme (V29b,
 * decision 179), dark unless chosen, and the first-time intro again (V39), as often as one likes.
 */
function AppearancePage({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  return (
    <section className="settings-editor" aria-label="Appearance">
      <BackToList onBack={onBack} />
      <h2>Appearance</h2>
      <div className="settings-card settings-rows">
        <section className="settings-part" aria-label="Theme">
          <h3 id="settings-theme">Theme</h3>
          <span className="scopes" role="group" aria-labelledby="settings-theme">
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
          <p className="settings-row-note">Kept in this browser.</p>
        </section>
        <section className="settings-part" aria-label="Intro">
          <h3>Intro</h3>
          <button
            type="button"
            className="button secondary"
            onClick={() => startIntro({ record: false })}
          >
            Play the intro
          </button>
          <p className="settings-row-note">The first-time intro again; nothing is recorded.</p>
        </section>
      </div>
    </section>
  );
}

/**
 * One prompt: its text to change, its placeholders, Save and Reset. Its own page, its heading over
 * a card, or a part of its agent's (`part`), a card under its title alone (V51).
 */
function PromptEditor({
  prompt,
  part,
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
  part?: boolean;
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

  const Heading = part ? 'h3' : 'h2';
  const heading = (
    <Heading>
      {part ? prompt.title : `${prompt.group}: ${prompt.title}`}
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
    </Heading>
  );
  const body = (
    <>
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
    </>
  );
  return part ? (
    <section className="settings-part settings-card" aria-label={prompt.title}>
      {heading}
      {body}
    </section>
  ) : (
    <section className="settings-editor" aria-label={`${prompt.group}: ${prompt.title}`}>
      <BackToList onBack={onBack} />
      {heading}
      <div className="settings-card">{body}</div>
    </section>
  );
}
