import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PromptKey, PromptSetting, PromptSettings, AgentLevels } from '@symbiote/core';
import { EffortStepper } from '../workspaces/EffortStepper.js';
import { Help } from '../ui/Help.js';
import { PageHead } from '../ui/PageHead.js';
import { getJson, postJson } from '../ui/http.js';
import { useShell } from '../shell/shell-context.js';
import { setTheme, useTheme, type Theme } from '../shell/theme.js';
import { setDetailsPlace, useDetailsPlace, type DetailsPlace } from '../history/details.js';
import { startIntro } from '../intro/intro.js';
import { LibraryPage } from './LibraryPage.js';
import { HivePage } from './HivePage.js';
import { useHive } from '../shell/hive.js';
import {
  draftProblem,
  gitNote,
  insertAt,
  isEdited,
  markOf,
  promptGroups,
  promptOfUrl,
  sizeOf,
  PREBUILT_GROUP,
  agentName,
  type PrebuiltAgent,
} from './settings.js';
import { nucleusName } from '../shell/names.js';
import {
  AGENT_NAMES,
  effortChoices,
  keptEffort,
  keptModel,
  modelChoices,
} from '../workspaces/workspaces.js';
import { tip } from '../ui/tip.js';
import {
  AdviceIcon,
  AgentsFileIcon,
  AppearanceIcon,
  ApprovedIcon,
  BranchIcon,
  ChecksIcon,
  ChoreIcon,
  CommentIcon,
  CommitIcon,
  DocumentsIcon,
  FixIcon,
  FolderIcon,
  HexagonIcon,
  MergeIcon,
  NucleusIcon,
  PlanIcon,
  PlanWithoutIcon,
  PlayIcon,
  PushIcon,
  RefactorIcon,
  ResetIcon,
  SettingsIcon,
  SparklesIcon,
  SpikeIcon,
  WhereIcon,
} from '../ui/icons.js';
import { SettingsCard } from './SettingsCard.js';

const API = '/api/settings/prompts';

/** The agents the advisor runs on (V75c), each its model and level on Suggest settings' page. */
const ADVISING = ['claude', 'codex'] as const;
type Advising = (typeof ADVISING)[number];

/**
 * A prebuilt agent's model in the project's config (V47), from its agent's own list; the advisor's
 * on an agent (V75c).
 */
interface ModelSetting {
  key: 'nucleus.model' | 'scribe.model' | 'merge.model' | `advisor.${Advising}.model`;
  /** What the model is for, before "from <agent>'s list". */
  about: string;
  /** What Default does, when not "passes none of Settings'". */
  byDefault?: string;
  /** What the next run does on `model` once saved. */
  saved: (model: string) => string;
  /** What happens with a configured model its agent does not list (decision 343). */
  unlisted: string;
}

/**
 * A prebuilt agent's effort in the project's config: Nucleus's (fix/scout-effort-level), the
 * merger's (V46d) and Scribe's (fix/scribe-effort-level).
 */
interface EffortSetting {
  key: 'nucleus.effort' | 'scribe.effort' | 'merge.effort' | `advisor.${Advising}.effort`;
  /** What the level is for, before "from <agent>'s levels". */
  about: string;
  /** What Default does, when not "passes none: the agent's own setting decides". */
  byDefault?: string;
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
  /** What the page says without its agent, when not that it needs Claude Code or Codex. */
  missing?: string;
  model: ModelSetting;
  effort: EffortSetting;
}

const AGENTS: Record<Exclude<PrebuiltAgent, 'Nucleus'>, AgentSettings> = {
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
          A running conversation keeps its own: New conversation in Scribe&apos;s pane starts the
          next on this level, and <code>/effort</code> in its terminal changes a running one.
        </>
      ),
      atDefault: 'Scribe starts it at its default',
      saved: (level) => `Saved. Scribe's next conversation starts at ${level}.`,
    },
  },
};

/** Nucleus's settings in its name: Alpha Ceph's while Hive mode is on (decision 674). */
const nucleusSettings = (name: string): AgentSettings => ({
  api: '/api/nucleus',
  who: name,
  whose: `${name}'s`,
  model: {
    key: 'nucleus.model',
    about: `The model each of ${name}'s conversations starts on`,
    saved: (model) => `Saved. ${name}'s next conversation starts on ${model}.`,
    unlisted: `${name} starts on the default`,
  },
  effort: {
    key: 'nucleus.effort',
    about: `The level each of ${name}'s conversations starts at`,
    also: (
      <>
        A running conversation keeps its own: New conversation on {name}&apos;s page starts the next
        on this level, and <code>/effort</code> in its terminal changes a running one.
      </>
    ),
    atDefault: `${name} starts it at its default`,
    saved: (level) => `Saved. ${name}'s next conversation starts at ${level}.`,
  },
});

/** A prebuilt agent's settings, Nucleus's in the name Hive mode gives it. */
const agentSettings = (agent: PrebuiltAgent, hive: boolean): AgentSettings =>
  agent === 'Nucleus' ? nucleusSettings(nucleusName(hive)) : AGENTS[agent];

/**
 * The advisor's model and level on `kind` (V75c, decision 556): read and set where Nucleus's are,
 * per agent, since the advisor runs on the agent picked on the Start page.
 */
function advisorSettings(kind: Advising): AgentSettings {
  const name = AGENT_NAMES[kind];
  return {
    api: `/api/workspaces/advisor/${kind}`,
    who: name,
    whose: `${name}'s`,
    missing: `${name} is not installed here.`,
    model: {
      key: `advisor.${kind}.model`,
      about: `The model that reads the brief when you press Suggest settings with ${name} picked`,
      byDefault:
        "Default is Symbiote's pick, the agent's small model, when the agent lists it: the first entry says which it is.",
      saved: (model) => `Saved. With ${name} picked, Suggest settings asks ${model}.`,
      unlisted: 'Suggest settings asks on the default',
    },
    effort: {
      key: `advisor.${kind}.effort`,
      about: 'The level that model reads it at',
      byDefault: "Default is Symbiote's low when the model takes it, else the agent's own.",
      atDefault: 'Suggest settings asks at the default',
      saved: (level) => `Saved. With ${name} picked, Suggest settings asks at ${level}.`,
    },
  };
}
const ADVISOR: Record<Advising, AgentSettings> = {
  claude: advisorSettings('claude'),
  codex: advisorSettings('codex'),
};

/** This browser's settings (V51, decision 388): an entry of their own at the list's end. */
const APPEARANCE = 'appearance';
/** The skill library (SK1): this machine's, for every repository, not the project's. */
const LIBRARY = 'skill-library';
/** Hive mode (V82): this repository's, kept out of git (decision 623), a danger to press. */
const HIVE = 'hive-mode';
const REPOSITORY_GROUP = 'This repository';
const MACHINE_GROUP = 'This machine';
const BROWSER_GROUP = 'This browser';
type EntryKey = PromptKey | typeof LIBRARY | typeof APPEARANCE | typeof HIVE;

/**
 * An entry's icon in the list (V81, decision 600), by its key (an agent's: its first prompt's);
 * every entry has one, Scribe's `library` prompt is not an entry.
 */
const ICONS: Partial<Record<EntryKey, () => ReactNode>> = {
  'start.feature': BranchIcon,
  'start.fix': FixIcon,
  'start.refactor': RefactorIcon,
  'start.chore': ChoreIcon,
  'start.spike': SpikeIcon,
  'plan.first': PlanIcon,
  'plan.direct': PlanWithoutIcon,
  documents: DocumentsIcon,
  advisor: AdviceIcon,
  'verdict.approve': ApprovedIcon,
  'verdict.push': PushIcon,
  'verdict.address': CommentIcon,
  'verdict.where': WhereIcon,
  reviews: AgentsFileIcon,
  merger: MergeIcon,
  nucleus: NucleusIcon,
  scribe: SparklesIcon,
  'hive.start': HexagonIcon,
  'hive.check': ChecksIcon,
  'hive.commit': CommitIcon,
  'hive.resume': PlayIcon,
  [LIBRARY]: FolderIcon,
  [HIVE]: HexagonIcon,
  [APPEARANCE]: AppearanceIcon,
} satisfies Record<Exclude<EntryKey, 'library'>, () => ReactNode>;

/** A group's tint in the list (decision 601): `SettingsPage.css` gives each its colour. */
const TINTS: Record<string, string> = {
  Workspaces: 'workspaces',
  Reviews: 'reviews',
  [PREBUILT_GROUP]: 'agents',
  [MACHINE_GROUP]: 'machine',
  [BROWSER_GROUP]: 'browser',
};

/** An entry's icon on its group's tile, before its name (Hive mode's red); decorative. */
function Tile({ entry }: { entry: EntryKey }) {
  const Drawn = ICONS[entry];
  return Drawn ? (
    <span
      className={entry === HIVE ? 'settings-tile hive-tile' : 'settings-tile'}
      aria-hidden="true"
    >
      <Drawn />
    </span>
  ) : null;
}

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
 * its model, its effort and its prompt (fix/scout-merger-scribe-settings). This repository's Hive
 * mode (V82), this machine's Skill library (SK1) and this browser's Appearance (V51) are the last
 * entries, listed even when the prompts cannot be read.
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
  const hive = useHive();

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
  // Read when the page opens: Hive mode's own state, not a dependency (its group follows below).
  const hiveAtOpen = useRef(hive);
  useEffect(() => {
    void load().then((read) => {
      const keys = read
        ? promptGroups(read.prompts, { hive: hiveAtOpen.current }).flatMap((g) =>
            g.entries.map((e) => e.key),
          )
        : [];
      // Without prompts, Appearance opens first, as before the Skill library (SK1).
      setOpen(promptOfUrl<EntryKey>(window.location.search, [...keys, APPEARANCE, LIBRARY, HIVE]));
    });
  }, [load]);

  const groups = useMemo(
    () => (settings ? promptGroups(settings.prompts, { hive }) : []),
    [settings, hive],
  );
  // The list scrolls on its own when it is taller than its card (V62): the entry open, from the
  // address or the last group's, is scrolled to; one clicked is in view already.
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, groups]);
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

  const editor = (prompt: PromptSetting, part?: boolean, name?: string) => (
    <PromptEditor
      key={prompt.key}
      prompt={prompt}
      part={part}
      name={name}
      draft={drafts[prompt.key]}
      busy={busy}
      notice={notice?.key === prompt.key ? notice : null}
      note={settings ? gitNote(settings) : null}
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
      {/* The person's mockup (V62): the page's icon, its title and a line under it. */}
      <PageHead
        className="settings-bar"
        icon={<SettingsIcon />}
        title="Settings"
        beside={
          <Help label="About Settings">
            What Symbiote tells each agent · Symbiote&apos;s text until you change it · saved in{' '}
            {settings?.file ?? 'symbiote/config.json'}, for everyone once committed
          </Help>
        }
        line="Configure Symbiote to match your workflow and preferences."
      />
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
      {!settings && !error ? (
        <p className="hint">Reading the prompts…</p>
      ) : (
        <div className={`settings-body${picked ? ' picked' : ''}`}>
          <nav ref={list} className="settings-list" aria-label="Settings">
            {groups.map(({ group, entries }) => (
              <section key={group} aria-label={group} data-tint={TINTS[group]}>
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
                          <Tile entry={entry.key} />
                          <span className="settings-name">{entry.name}</span>
                          {mark && <span className={`settings-mark ${mark}`}>{MARKS[mark]}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {/* Untinted: its one entry's tile is Hive mode's red. */}
            <section aria-label={REPOSITORY_GROUP}>
              <h2>{REPOSITORY_GROUP}</h2>
              <ul>
                <li>
                  <button
                    type="button"
                    aria-current={open === HIVE ? 'true' : undefined}
                    onClick={() => show(HIVE)}
                  >
                    <Tile entry={HIVE} />
                    <span className="settings-name">Hive mode</span>
                    {hive && <span className="settings-mark hive-on">on</span>}
                  </button>
                </li>
              </ul>
            </section>
            <section aria-label={MACHINE_GROUP} data-tint={TINTS[MACHINE_GROUP]}>
              <h2>{MACHINE_GROUP}</h2>
              <ul>
                <li>
                  <button
                    type="button"
                    aria-current={open === LIBRARY ? 'true' : undefined}
                    onClick={() => show(LIBRARY)}
                  >
                    <Tile entry={LIBRARY} />
                    <span className="settings-name">Skill library</span>
                  </button>
                </li>
              </ul>
            </section>
            <section aria-label={BROWSER_GROUP} data-tint={TINTS[BROWSER_GROUP]}>
              <h2>{BROWSER_GROUP}</h2>
              <ul>
                <li>
                  <button
                    type="button"
                    aria-current={open === APPEARANCE ? 'true' : undefined}
                    onClick={() => show(APPEARANCE)}
                  >
                    <Tile entry={APPEARANCE} />
                    <span className="settings-name">Appearance</span>
                  </button>
                </li>
              </ul>
            </section>
          </nav>
          {open === APPEARANCE ? (
            <AppearancePage onBack={back} />
          ) : open === HIVE ? (
            <HivePage onBack={back} />
          ) : open === LIBRARY ? (
            <LibraryPage onBack={back} />
          ) : current?.key === 'advisor' ? (
            <AdvisorPage onSaved={() => void load()} onBack={back}>
              {current.prompts.map((prompt) => editor(prompt, true, 'Instructions'))}
            </AdvisorPage>
          ) : current?.agent ? (
            // A save changes the file: the prompts' version is read again, or their next save
            // would be refused as changed since.
            <AgentPage
              key={current.key}
              name={current.agent}
              settings={agentSettings(current.agent, hive)}
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

/**
 * A prebuilt agent's page (fix/scout-merger-scribe-settings): its Model and its Effort as rows
 * (V51), then its prompts (`children`), a section each, in one card (V62).
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
  return (
    <SettingsCard label={name} title={name} onBack={onBack}>
      <AgentRows settings={settings} onSaved={onSaved} />
      {children}
    </SettingsCard>
  );
}

/**
 * Suggest settings' page (V75c, decision 556): the advisor's Model and Effort on Claude Code and
 * on Codex, a section each, since it runs on the agent picked on the Start page; then its
 * instructions (`children`).
 */
function AdvisorPage({
  onSaved,
  onBack,
  children,
}: {
  onSaved: () => void;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <SettingsCard
      label="Workspaces: Suggest settings"
      title="Workspaces: Suggest settings"
      onBack={onBack}
    >
      {ADVISING.map((kind) => (
        <section key={kind} className="settings-advisor" aria-label={AGENT_NAMES[kind]}>
          <h3>{AGENT_NAMES[kind]}</h3>
          <AgentRows settings={ADVISOR[kind]} heading="h4" onSaved={onSaved} />
        </section>
      ))}
      {children}
    </SettingsCard>
  );
}

/**
 * An agent's Model and Effort as rows (V51). Its models and levels are read once for both: a model
 * saved answers with its own levels, and the Effort follows it.
 */
function AgentRows({
  settings,
  heading = 'h3',
  onSaved,
}: {
  settings: AgentSettings;
  /** The rows' names: headings under the card's, or under an agent's on Suggest settings'. */
  heading?: 'h3' | 'h4';
  /** After a save: the config file changed. */
  onSaved: () => void;
}) {
  const [read, setRead] = useState<AgentLevels | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getJson<AgentLevels>(`${settings.api}/efforts`)
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
  const saved = (answer: AgentLevels) => {
    setRead(answer);
    onSaved();
  };

  // Its agent: Nucleus's and Scribe's (`agent.kind`'s, else Claude Code), the merger's, the
  // advisor's on that agent.
  const agent = read?.agents[0];
  return (
    <>
      {error && (
        <p className="settings-warning" role="alert">
          {error}
        </p>
      )}
      {read && !agent && (
        <p className="settings-warning" role="alert">
          {settings.missing ??
            `${settings.who} needs Claude Code or Codex: neither is installed here.`}
        </p>
      )}
      {(!read || agent) && (
        <div className="settings-rows">
          <AgentModel settings={settings} heading={heading} read={read} onSaved={saved} />
          <AgentEffort
            // Drawn again on another model: its levels, and the level kept on them, are that model's.
            key={read ? `on ${read.model ?? ''}` : 'reading'}
            settings={settings}
            heading={heading}
            read={read}
            onSaved={saved}
          />
        </div>
      )}
    </>
  );
}

/**
 * A prebuilt agent's effort in the project's config, on a stepper of its agent's levels, saved
 * when the handle is let go: `nucleus.effort` and `scribe.effort`, the level each of their
 * conversations starts at (fix/scout-effort-level, fix/scribe-effort-level); `merge.effort`, the
 * level each merger agent's run is asked at (V46d).
 */
function AgentEffort({
  settings,
  heading: Heading,
  read,
  onSaved,
}: {
  settings: AgentSettings;
  heading: 'h3' | 'h4';
  /** The agent's models and levels, null while they are read. */
  read: AgentLevels | null;
  onSaved: (answer: AgentLevels) => void;
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
        onSaved(await postJson<AgentLevels>(`${settings.api}/effort`, { effort: next || null }));
        setNotice({ text: setting.saved(next || (choices[0]?.label ?? `${name}'s default`)) });
      } catch (failed) {
        setNotice({ text: (failed as Error).message, error: true });
      }
    });
  };

  return (
    <section className="settings-part settings-effort" aria-label="Effort">
      <Heading>
        Effort
        <Help label={`About ${settings.whose} effort`}>
          <p>
            {setting.about}
            {name ? `, from ${name}'s levels` : ''}.{' '}
            {setting.byDefault ?? "Default passes none: the agent's own setting decides."}
          </p>
          <p>
            {setting.also} Saved in {read?.file ?? 'symbiote/config.json'} (
            <code>{setting.key}</code>) when you let go.
          </p>
        </Help>
      </Heading>
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
 * when picked: `nucleus.model`, `scribe.model`, `merge.model`.
 */
function AgentModel({
  settings,
  heading: Heading,
  read,
  onSaved,
}: {
  settings: AgentSettings;
  heading: 'h3' | 'h4';
  /** The agent's models and levels, null while they are read. */
  read: AgentLevels | null;
  onSaved: (answer: AgentLevels) => void;
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
      const answer = await postJson<AgentLevels>(`${settings.api}/model`, {
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
      <Heading>
        Model
        <Help label={`About ${settings.whose} model`}>
          <p>
            {setting.about}
            {name ? `, from ${name}'s own list` : ''}.{' '}
            {setting.byDefault ??
              "Default passes none of Settings': the first entry says which it is."}
          </p>
          <p>
            The Effort below follows it: its levels are this model&apos;s. Saved in{' '}
            {read?.file ?? 'symbiote/config.json'} (<code>{setting.key}</code>) when you pick one.
          </p>
        </Help>
      </Heading>
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

/** Where Git's details pane goes (V66b, decision 478). */
const PLACES: { place: DetailsPlace; label: string }[] = [
  { place: 'right', label: 'On the right' },
  { place: 'below', label: 'Below the commits' },
];

/**
 * This browser's Appearance (V51, decision 388; in the head before): the page's theme (V29b,
 * decision 179), dark unless chosen, where Git's commit details go (V66b), and the first-time
 * intro again (V39), as often as one likes.
 */
function AppearancePage({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  const place = useDetailsPlace();
  return (
    <SettingsCard label="Appearance" title="Appearance" onBack={onBack}>
      <div className="settings-rows">
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
        <section className="settings-part" aria-label="Commit details">
          <h3 id="settings-details">Commit details</h3>
          <span className="scopes" role="group" aria-labelledby="settings-details">
            {PLACES.map((choice) => (
              <button
                key={choice.place}
                type="button"
                className={place === choice.place ? 'scope active' : 'scope'}
                aria-pressed={place === choice.place}
                onClick={() => setDetailsPlace(choice.place)}
              >
                {choice.label}
              </button>
            ))}
          </span>
          <p className="settings-row-note">
            Where Git shows the selected commit: beside its rows or under them. Kept in this
            browser.
          </p>
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
    </SettingsCard>
  );
}

/**
 * One prompt: its text to change, its placeholders, Save and Reset. A page of its own, its name,
 * chip and Reset in the card's head; or a section of its agent's page (`part`), those on its first
 * line (V62, the person's mockup). What it is and what its placeholders are is said under their
 * headings.
 */
function PromptEditor({
  prompt,
  part,
  name = prompt.title,
  draft,
  busy,
  notice,
  note,
  onDraft,
  onDiscard,
  onSave,
  onLoad,
  onBack,
}: {
  prompt: PromptSetting;
  part?: boolean;
  /** Its section's name on an agent's page: the prompt's title, or the page's word for it. */
  name?: string | undefined;
  draft: string | undefined;
  busy: boolean;
  notice: Notice | null;
  /** Where a save goes and whether it is shared (`gitNote`), beside Save until one says more. */
  note: string | null;
  onDraft: (text: string) => void;
  onDiscard: () => void;
  /** The text to save; null for Symbiote's. */
  onSave: (text: string | null) => void;
  onLoad: () => void;
  onBack: () => void;
}) {
  // Nucleus's group by its name: Alpha Ceph's while Hive mode is on (decision 674).
  const group = agentName(prompt.group, useHive());
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

  const chip = (
    <span className={`settings-state${prompt.changed ? ' changed' : ''}`}>
      {prompt.changed ? "The project's" : "Symbiote's"}
    </span>
  );
  const reset =
    prompt.changed &&
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
        className="button secondary"
        disabled={busy}
        onClick={() => setResetting(true)}
      >
        <ResetIcon /> Reset to default
      </button>
    ));
  // On its own page the prompt's text is a section under "Prompt"; on its agent's, the section is
  // the prompt's own, and its placeholders' heading one level down.
  const Sub = part ? 'h4' : 'h3';
  const body = (
    <>
      {prompt.warning && (
        <p className="settings-warning" role="alert">
          {prompt.warning}
        </p>
      )}
      <div className="settings-section">
        {!part && <h3>Prompt</h3>}
        <p className="settings-about">{prompt.about}</p>
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
        <p className={`settings-size${problem ? ' error' : ''}`}>
          {problem ?? sizeOf(prompt, text)}
        </p>
        {prompt.fixed && (
          <div className="settings-fixed">
            <p>Symbiote adds this after it, as the answer it reads; it cannot be changed:</p>
            <pre>{prompt.fixed}</pre>
          </div>
        )}
      </div>
      {prompt.placeholders.length > 0 ? (
        <div className="settings-section settings-placeholders">
          <Sub>Placeholders</Sub>
          <p className="settings-about">
            Each is filled in when the prompt is used; click one to insert it at the cursor.
          </p>
          <ul>
            {prompt.placeholders.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  className="link"
                  {...tip('Insert it at the cursor')}
                  onClick={() => insert(p.name)}
                >
                  {`{${p.name}}`}
                </button>
                <span>
                  {p.about}
                  {p.required && <strong> (required)</strong>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="settings-section settings-about">
          No placeholders: the agent is given it as written.
        </p>
      )}
      <div className="settings-actions">
        {notice ? (
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
        ) : (
          note && <span className="settings-git">{note}</span>
        )}
        {edited && (
          <button type="button" className="button secondary" disabled={busy} onClick={onDiscard}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="button"
          disabled={!canSave}
          {...tip("Save it in the project's config", { keys: 'Ctrl+S' })}
          onClick={() => onSave(text)}
        >
          Save changes
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
    <section className="settings-part settings-prompt" aria-label={name}>
      <div className="settings-part-head">
        <h3>
          {name}
          {chip}
        </h3>
        {reset}
      </div>
      {body}
    </section>
  ) : (
    <SettingsCard
      label={`${group}: ${prompt.title}`}
      title={
        <>
          {`${group}: ${prompt.title}`}
          {chip}
        </>
      }
      actions={reset}
      onBack={onBack}
    >
      {body}
    </SettingsCard>
  );
}
