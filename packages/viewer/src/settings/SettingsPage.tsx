import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CheckSetting, PromptKey, PromptSetting, PromptSettings } from '@symbiote/core';
import { PageHead } from '../ui/PageHead.js';
import { getJson, postJson } from '../ui/http.js';
import { useShell } from '../shell/shell-context.js';
import { LibraryPage } from './LibraryPage.js';
import { HivePage } from './HivePage.js';
import { StartConfirm } from './StartConfirm.js';
import { useHive } from '../shell/hive.js';
import {
  APPEARANCE,
  CHECKS,
  HIVE,
  LIBRARY,
  filterNav,
  foldOpen,
  gitNote,
  isEdited,
  markOf,
  promptOfUrl,
  settingsNav,
  agentName,
  type EntryKey,
  type NavEntry,
  type NavFold,
} from './settings.js';
import { checksEdited } from './checks.js';
import { ChecksPage, type ChecksNotice } from './ChecksPage.js';
import { useAlphaCeph } from '../shell/names.js';
import {
  AdviceIcon,
  AgentsFileIcon,
  AppearanceIcon,
  ApprovedIcon,
  BugIcon,
  ChecksIcon,
  ChevronIcon,
  ChoreIcon,
  SparkIcon,
  CommentIcon,
  CommitIcon,
  DocumentsIcon,
  FixIcon,
  FlaskIcon,
  FolderIcon,
  HexagonIcon,
  IssuesIcon,
  MergeIcon,
  NucleusIcon,
  PlanIcon,
  PlanWithoutIcon,
  PlayIcon,
  PushIcon,
  RefactorIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SpikeIcon,
  WhereIcon,
} from '../ui/icons.js';
import { Loading } from '../ui/Loading.js';
import { agentSettings } from './agent-settings.js';
import { AdvisorPage, AgentPage } from './AgentPage.js';
import { AppearancePage } from './AppearancePage.js';
import { type Notice, PromptEditor } from './PromptEditor.js';

const API = '/api/settings/prompts';
const CHECKS_API = '/api/settings/checks';

/** The groups of prompts folded or opened by the person, kept in this browser. */
const FOLDS_KEY = 'symbiote.viewer.settings-folds';

function readFolds(): Record<string, boolean> {
  try {
    const kept = JSON.parse(window.localStorage.getItem(FOLDS_KEY) ?? '{}') as unknown;
    return kept && typeof kept === 'object' ? (kept as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function keepFolds(folds: Record<string, boolean>) {
  try {
    window.localStorage.setItem(FOLDS_KEY, JSON.stringify(folds));
  } catch {
    // Kept for this page only: the browser keeps nothing here.
  }
}

/**
 * An entry's icon in the list (V81, decision 600), by its key (an agent's: its first prompt's);
 * every entry has one, Scribe's `library` prompt is not an entry.
 */
const ICONS: Partial<Record<EntryKey, () => ReactNode>> = {
  'start.feature': SparkIcon,
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
  'merge.failed': ChecksIcon,
  nucleus: NucleusIcon,
  scribe: SparklesIcon,
  // HV9b: the classifier reads an issue, the Issues page's icon.
  'hive.classify': IssuesIcon,
  'hive.start': HexagonIcon,
  // HV10: a start from an issue, the Issues page's icon.
  'hive.issue': IssuesIcon,
  'hive.check': ChecksIcon,
  'hive.review': BugIcon,
  'hive.commit': CommitIcon,
  'hive.resume': PlayIcon,
  // HV4: a landing that failed, Hive's OK to a plan, no one to ask.
  'hive.land': MergeIcon,
  'hive.plan': ApprovedIcon,
  'hive.decide': WhereIcon,
  'hive.reviewer': FlaskIcon,
  // What Alpha Ceph is told of Hive (V86): its own icon, the Hive Mind.
  'hive.nucleus': NucleusIcon,
  [CHECKS]: ChecksIcon,
  [LIBRARY]: FolderIcon,
  [HIVE]: HexagonIcon,
  [APPEARANCE]: AppearanceIcon,
} satisfies Record<Exclude<EntryKey, 'library'>, () => ReactNode>;

/** An entry's icon before its name (V93: plain, no tile); decorative. */
function Tile({ entry }: { entry: EntryKey }) {
  const Drawn = ICONS[entry];
  return Drawn ? (
    <span className="settings-tile" aria-hidden="true">
      <Drawn />
    </span>
  ) : null;
}

/** The list's mark for an entry, by `markOf`. */
const MARKS = { unsaved: 'not saved', warning: 'not used', changed: 'changed' } as const;

/** The drafts without `key`'s. */
const without = (drafts: Partial<Record<PromptKey, string>>, key: PromptKey) =>
  Object.fromEntries(Object.entries(drafts).filter(([k]) => k !== key)) as typeof drafts;

/**
 * Settings (V28b): every agent's prompts, Symbiote's until the project changes them, and the
 * settings that are not prompts. A change is saved in `symbiote/config.json`; unsaved drafts are
 * kept while another entry is open, and leaving the page with one asks first. The list
 * (fix/settings-page) is by what is set, in both modes: This repository (the check, one for the
 * merger and Hive; Hive mode), Agents (each one page: its model, its effort, its prompts), Prompts
 * in groups that fold, This machine's Skill library (SK1), this browser's Appearance (V51); a
 * filter over it. The settings that are not prompts are listed even when the prompts cannot be read.
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
  // The check (fix/settings-page): read with the prompts, its draft kept as theirs.
  const [checks, setChecks] = useState<CheckSetting | null>(null);
  const [checksError, setChecksError] = useState<string | null>(null);
  const [checksDraft, setChecksDraft] = useState<string[] | undefined>(undefined);
  const [checksNotice, setChecksNotice] = useState<ChecksNotice | null>(null);
  const [query, setQuery] = useState('');
  const [folds, setFolds] = useState(readFolds);
  const hive = useHive();
  // Nucleus's name: Alpha Ceph's once the sidenav plays its change (V86, decision 731).
  const alpha = useAlphaCeph();

  const loadChecks = useCallback(async () => {
    try {
      setChecks(await getJson<CheckSetting>(CHECKS_API));
      setChecksError(null);
    } catch (failed) {
      setChecksError(`The check could not be read: ${(failed as Error).message}`);
    }
  }, []);
  // Every save changes the config file: both reads again, or the next save is refused as stale.
  const load = useCallback(async () => {
    void loadChecks();
    try {
      const read = await getJson<PromptSettings>(API);
      setSettings(read);
      setError(null);
      return read;
    } catch (failed) {
      setError(`The prompts could not be read: ${(failed as Error).message}`);
      return null;
    }
  }, [loadChecks]);
  // Read when the page opens: Hive mode's own state, not a dependency (its group follows below).
  const hiveAtOpen = useRef(hive);
  useEffect(() => {
    void load().then((read) => {
      const keys = settingsNav(read?.prompts ?? null, { hive: hiveAtOpen.current }).flatMap((s) => [
        ...s.entries.map((e) => e.key),
        ...s.folds.flatMap((f) => f.entries.map((e) => e.key)),
      ]);
      setOpen(promptOfUrl<EntryKey>(window.location.search, keys));
    });
  }, [load]);

  const sections = useMemo(
    () => settingsNav(settings?.prompts ?? null, { hive, alpha }),
    [settings, hive, alpha],
  );
  const shown = useMemo(() => filterNav(sections, query), [sections, query]);
  // The list scrolls on its own when it is taller than its card (V62): the entry open, from the
  // address, is scrolled to; one clicked is in view already.
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, sections]);
  const edited = useMemo(
    () => settings?.prompts.filter((p) => isEdited(p, drafts[p.key])).map((p) => p.key) ?? [],
    [settings, drafts],
  );
  const checksChanged = checksEdited(checks?.commands ?? checks?.found?.commands, checksDraft);
  const unsaved = edited.length + (checksChanged ? 1 : 0);
  // Leaving with an unsaved change asks first: closing or reloading the page (the browser asks),
  // and going elsewhere in the shell (V29a), which does not load another page.
  const setLeaveGuard = useShell()?.setLeaveGuard;
  useEffect(() => {
    if (unsaved === 0) return;
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    setLeaveGuard?.({
      question: 'Leave Settings?',
      detail: `${unsaved === 1 ? 'A change is' : `${unsaved} changes are`} not saved.`,
    });
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      setLeaveGuard?.(null);
    };
  }, [unsaved, setLeaveGuard]);

  const show = (key: EntryKey) => {
    setOpen(key);
    setPicked(true);
    setNotice((current) => (current?.key === key ? current : null));
    // The check is read again as it opens: another page's save changed the file's version.
    if (key === CHECKS) void loadChecks();
    window.history.replaceState(null, '', `?prompt=${encodeURIComponent(key)}`);
  };
  const back = () => {
    setPicked(false);
    window.history.replaceState(null, '', window.location.pathname);
  };
  const fold = (group: string, isOpen: boolean) =>
    setFolds((all) => {
      const next = { ...all, [group]: !isOpen };
      keepFolds(next);
      return next;
    });

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
      void loadChecks();
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

  const saveChecks = async (commands: string[] | null) => {
    if (!checks) return;
    setBusy(true);
    try {
      const next = await postJson<CheckSetting>(CHECKS_API, { commands, version: checks.version });
      setChecks(next);
      setChecksDraft(undefined);
      setChecksNotice({
        text:
          commands === null
            ? next.found
              ? `merge.checks removed: Symbiote runs the check it finds in ${next.found.source}.`
              : 'merge.checks removed: none is found, so a merge waits for you to land it.'
            : `Saved. The next merge${hive ? " and Hive's next check run" : ' runs'} ${
                commands.length === 1 ? 'it' : `these ${commands.length} commands`
              }.`,
      });
      // The prompts' version too: the file changed.
      void load();
    } catch (failed) {
      const message = (failed as Error).message;
      setChecksNotice({
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
  const current = sections
    .flatMap((s) => [...s.entries, ...s.folds.flatMap((f) => f.entries)])
    .find((e) => e.key === open && e.prompts.length > 0);

  /** An entry's row: its icon, its name, its mark (Hive mode's On or Off). */
  const entryRow = (entry: NavEntry) => {
    const mark =
      entry.key === CHECKS
        ? checksChanged
          ? 'unsaved'
          : checks && !checks.commands && !checks.found
            ? 'warning'
            : null
        : markOf(entry.prompts, edited);
    return (
      <li key={entry.key}>
        <button
          type="button"
          aria-current={entry.key === open ? 'true' : undefined}
          // Hive mode's name, and "on" while it is: Off, the default, is the pill alone.
          {...(entry.key === HIVE ? { 'aria-label': hive ? 'Hive mode, on' : 'Hive mode' } : {})}
          onClick={() => show(entry.key)}
        >
          <Tile entry={entry.key} />
          <span className="settings-name">{entry.name}</span>
          {entry.key === HIVE ? (
            <span className={`settings-mark ${hive ? 'hive-on' : 'hive-off'}`} aria-hidden="true">
              {hive ? 'On' : 'Off'}
            </span>
          ) : (
            mark && (
              <span className={`settings-mark ${mark}`}>
                {entry.key === CHECKS && mark === 'warning' ? 'none' : MARKS[mark]}
              </span>
            )
          )}
        </button>
      </li>
    );
  };
  /** A group of prompts: its name a button that folds it, its count and mark while folded. */
  const foldOf = (group: NavFold) => {
    const isOpen = foldOpen(group, { open, kept: folds, query });
    const mark = markOf(
      group.entries.flatMap((e) => e.prompts),
      edited,
    );
    const id = `settings-fold-${group.group.toLowerCase().replace(/\W+/g, '-')}`;
    return (
      <section key={group.group} className="settings-fold" aria-label={group.group}>
        <button
          type="button"
          className="settings-fold-head"
          aria-expanded={isOpen}
          aria-controls={id}
          onClick={() => fold(group.group, isOpen)}
        >
          <ChevronIcon open={isOpen} />
          <span className="settings-name">{group.group}</span>
          {!isOpen && mark && <span className={`settings-mark ${mark}`}>{MARKS[mark]}</span>}
          <span className="settings-count">{group.entries.length}</span>
        </button>
        {isOpen && <ul id={id}>{group.entries.map(entryRow)}</ul>}
      </section>
    );
  };

  return (
    <div className="settings">
      {/* The person's mockup (V62): the page's icon, its title and a line under it. */}
      <PageHead
        className="settings-bar"
        icon={<SettingsIcon />}
        title="Settings"
        // The proofs' line, by mode (V93, proofs 04 and 11).
        line={
          hive
            ? 'How Hive runs this repository, and what Symbiote tells its agents'
            : 'How this repository is checked, and what Symbiote tells its agents'
        }
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
        <Loading className="hint">Reading the prompts…</Loading>
      ) : (
        <div className={`settings-body${picked ? ' picked' : ''}`}>
          <nav ref={list} className="settings-list" aria-label="Settings">
            <label className="settings-find">
              <SearchIcon />
              <input
                type="search"
                aria-label="Find a setting"
                placeholder="Find a setting…"
                value={query}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape' || query === '') return;
                  event.preventDefault();
                  setQuery('');
                }}
              />
            </label>
            {shown.map((section) => (
              <section key={section.name} aria-label={section.name}>
                <h2>{section.name}</h2>
                {section.entries.length > 0 && <ul>{section.entries.map(entryRow)}</ul>}
                {section.folds.map(foldOf)}
              </section>
            ))}
            {shown.length === 0 && (
              <p className="settings-none" role="status">
                No setting matches “{query.trim()}”.
              </p>
            )}
          </nav>
          {open === CHECKS ? (
            <ChecksPage
              setting={checks}
              error={checksError}
              hive={hive}
              draft={checksDraft}
              busy={busy}
              notice={checksNotice}
              onDraft={(commands) => {
                setChecksDraft(commands);
                setChecksNotice(null);
              }}
              onDiscard={() => setChecksDraft(undefined)}
              onSave={(commands) => void saveChecks(commands)}
              onLoad={() => void loadChecks().then(() => setChecksNotice(null))}
              onBack={back}
            />
          ) : open === APPEARANCE ? (
            <AppearancePage onBack={back} />
          ) : open === HIVE ? (
            <HivePage onBack={back} onChecks={() => show(CHECKS)} />
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
              name={agentName(current.agent, alpha)}
              settings={agentSettings(current.agent, alpha)}
              onSaved={() => void load()}
              onBack={back}
              {...(current.agent === 'Nucleus'
                ? { rows: <StartConfirm name={agentName(current.agent, alpha)} /> }
                : {})}
              {...(current.agent === 'Reviewer'
                ? {
                    // Its model and effort are set with Hive's limits (V92, decision 870).
                    levels: (
                      <p className="settings-row-note settings-moved">
                        Its model and effort are on the{' '}
                        <a
                          href={`?prompt=${HIVE}`}
                          onClick={(event) => {
                            event.preventDefault();
                            show(HIVE);
                          }}
                        >
                          Hive mode
                        </a>{' '}
                        page, under Running reviewer.
                      </p>
                    ),
                  }
                : {})}
            >
              {current.prompts.map((prompt) =>
                editor(prompt, true, prompt.key === 'hive.reviewer' ? 'Instructions' : undefined),
              )}
            </AgentPage>
          ) : (
            current?.prompts[0] && editor(current.prompts[0])
          )}
        </div>
      )}
    </div>
  );
}
