import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LibraryState, Skill, SkillChange, SkillsState } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { PageHead } from '../ui/PageHead.js';
import { getJson, postJson } from '../ui/http.js';
import {
  BackIcon,
  DocumentsIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SkillsIcon,
  SparklesIcon,
} from '../ui/icons.js';
import { useShell } from '../shell/shell-context.js';
import { hrefOf, type Route } from '../shell/pages.js';
import { Conversation } from '../nucleus/Conversation.js';
import { pageAgentStateText } from '../nucleus/page-agent.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { isSkillEdited, skillGitNote, skillGroups, skillMatches, skillOfUrl } from './skills.js';
import { tip } from '../ui/tip.js';
import { libraryGitText, libraryName, librarySync, skillPlace, folderOf } from './library.js';
import { LibraryPane } from './LibraryPane.js';
import { Loading } from '../ui/Loading.js';
import { type Notice, SkillEditor } from './SkillEditor.js';
import { NewSkill } from './NewSkill.js';
import { scribeAgent } from './scribe-agent.js';

const API = '/api/skills';
/**
 * The form for a new skill, Scribe's conversation and the skill library's pane (SK1), in the list's
 * place of a skill's path.
 */
const NEW = 'new';
const SCRIBE = 'scribe';
const LIBRARY = 'library';
/** Settings' entry for the skill library (SK1, decision 427). */
const LIBRARY_SETTINGS: Route = { page: 'settings', prompt: 'skill-library' };
/** While Scribe works, how often the skills are read again: what it writes shows. */
const SCRIBE_POLL_MS = 5_000;

/** The drafts without `path`'s. */
const without = (drafts: Record<string, string>, path: string) =>
  Object.fromEntries(Object.entries(drafts).filter(([p]) => p !== path));

/** The address of what is open: a skill by its path, the form, Scribe, or the library. */
function addressOf(open: string): string {
  if (open === NEW || open === SCRIBE || open === LIBRARY) return `?${open}`;
  return `?skill=${encodeURIComponent(open)}`;
}

/** A conversation's state as a dot's tone, as the sidenav draws a workspace's. */
function toneOf(state: string): string {
  if (state === 'working') return 'tone-working';
  if (state === 'needs-you' || state === 'interrupted') return 'tone-waiting';
  if (state === 'failed' || state === 'gone') return 'tone-failed';
  return 'tone-done';
}

/**
 * Skills (V41a): the checkout's skills — `.claude/skills/` (Claude Code) and `.agents/skills/`
 * (Codex) — each opened as its `SKILL.md`, checked as one types, saved in place for the person to
 * commit; a new one from its name and description; Link for Codex when Codex does not read Claude
 * Code's. Scribe (V41b) first in the list: its conversation, which writes skills here. Drafts are
 * kept while another skill is open; leaving with one asks first.
 */
export function SkillsPage() {
  const [state, setState] = useState<SkillsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** On a narrow screen, a skill picked takes the page. */
  const [picked, setPicked] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('skill') || params.has(NEW) || params.has(SCRIBE) || params.has(LIBRARY);
  });
  const shell = useShell();
  const { scribe } = useWorkspaces();
  /** What Improve with Scribe types in Scribe's terminal, until it is handed over (V78). */
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** The list's search (V64): the skills whose name or description holds it. */
  const [query, setQuery] = useState('');
  /** The open skill's card over the main area (V64), until Esc. */
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const read = await getJson<SkillsState>(API);
      setState(read);
      setError(null);
      return read;
    } catch (failed) {
      setError(`The skills could not be read: ${(failed as Error).message}`);
      return null;
    }
  }, []);
  useEffect(() => {
    void load().then((read) => {
      if (!read) return;
      const search = window.location.search;
      const paths = read.skills.map((s) => s.path);
      const params = new URLSearchParams(search);
      // No skill yet: the form for the first one.
      setOpen(
        params.has(SCRIBE)
          ? SCRIBE
          : params.has(NEW)
            ? NEW
            : params.has(LIBRARY) && read.library
              ? LIBRARY
              : (skillOfUrl(search, paths) ?? NEW),
      );
    });
  }, [load]);
  // A skill written elsewhere (an editor, an agent) shows when the page is back in view.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // While Scribe works, the skills are read again: what it writes shows in the list; once more when
  // it stops.
  const writing = scribe?.conversation?.state === 'working';
  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(() => void load(), SCRIBE_POLL_MS);
    return () => {
      clearInterval(timer);
      void load();
    };
  }, [writing, load]);

  const edited = useMemo(
    () => state?.skills.filter((s) => isSkillEdited(s, drafts[s.path])).map((s) => s.path) ?? [],
    [state, drafts],
  );
  // Leaving with an unsaved change asks first, as Settings does (V28b).
  const setLeaveGuard = shell?.setLeaveGuard;
  useEffect(() => {
    if (edited.length === 0) return;
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    setLeaveGuard?.({
      question: 'Leave Skills?',
      detail: `${edited.length === 1 ? 'A skill is' : `${edited.length} skills are`} changed and not saved.`,
    });
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      setLeaveGuard?.(null);
    };
  }, [edited.length, setLeaveGuard]);

  // Esc gives the list and the checks back; an Esc a menu took (`defaultPrevented`) does not.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const show = (at: string) => {
    setOpen(at);
    if (at === NEW || at === SCRIBE || at === LIBRARY) setExpanded(false);
    // An Improve not yet typed is not kept for a later visit to Scribe.
    if (at !== SCRIBE) setAsking(undefined);
    setPicked(true);
    setNotice((current) => (current?.at === at ? current : null));
    window.history.replaceState(null, '', addressOf(at));
  };
  const back = () => {
    setPicked(false);
    window.history.replaceState(null, '', window.location.pathname);
  };

  /** Makes a change; `done` says what it did, under `at`. */
  const change = async (at: string, request: SkillChange, done: (next: SkillsState) => string) => {
    setBusy(true);
    try {
      const next = await postJson<SkillsState>(API, request);
      setState(next);
      setNotice({ at, text: done(next) });
      return next;
    } catch (failed) {
      const message = (failed as Error).message;
      setNotice({
        at,
        text: message,
        error: true,
        ...(message.includes('since you opened it') ? { stale: true } : {}),
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async (skill: Skill, text: string) => {
    const next = await change(
      skill.path,
      { action: 'save', path: skill.path, text, version: skill.version },
      (after) => {
        const saved = after.skills.find((s) => s.path === skill.path);
        return `Saved. ${saved ? skillGitNote(saved.git) : ''}`.trim();
      },
    );
    if (next) setDrafts((all) => without(all, skill.path));
  };
  const remove = async (skill: Skill) => {
    const gone = `Deleted ${folderOf(skill, state?.library)}/${skill.name}.`;
    const next = await change(
      skill.path,
      { action: 'delete', path: skill.path, version: skill.version },
      () => gone,
    );
    if (!next) return;
    setDrafts((all) => without(all, skill.path));
    const first = next.skills[0]?.path ?? NEW;
    setOpen(first);
    setNotice({ at: first, text: gone });
    window.history.replaceState(null, '', addressOf(first));
  };
  const create = async (name: string, description: string, where: 'checkout' | 'library') => {
    const inLibrary = where === 'library';
    const next = await change(
      NEW,
      { action: 'new', name, description, ...(inLibrary ? { where: 'library' as const } : {}) },
      () => '',
    );
    const made = next?.skills.find(
      (s) => s.folder === (inLibrary ? 'library' : '.claude/skills') && s.name === name,
    );
    if (!made) return false;
    setOpen(made.path);
    setNotice({
      at: made.path,
      text: `Made ${skillPlace(made, next?.library)}. Write its instructions under the frontmatter, then save.`,
    });
    window.history.replaceState(null, '', addressOf(made.path));
    return true;
  };
  const improve = (skill: Skill) => {
    setAsking(`Improve ${skillPlace(skill, state?.library)}: `);
    show(SCRIBE);
  };
  /** A change to the library's git (SK1); read again after a refusal, which may follow a commit. */
  const libraryGit = async (request: SkillChange, done: string) => {
    if (!(await change(LIBRARY, request, () => done))) void load();
  };
  /** A skill in VS Code (V64): its window, at `line`; what it did under the skill. */
  const openInCode = async (skill: Skill, line: number, unsaved: boolean) => {
    const where = skillPlace(skill, state?.library);
    try {
      await postJson(`${API}/open`, { path: skill.path, line });
      setNotice({
        at: skill.path,
        text: `Opened ${where} in VS Code at line ${line}.${unsaved ? ' It shows the file as saved.' : ''}`,
      });
    } catch (failed) {
      setNotice({
        at: skill.path,
        text: `VS Code did not open ${where}: ${(failed as Error).message}`,
        error: true,
      });
    }
  };
  const toSettings = () => shell?.navigate(LIBRARY_SETTINGS);
  const link = () =>
    void change('codex', { action: 'link' }, (next) =>
      `Linked: Codex reads .agents/skills, now .claude/skills. ${next.codex.git === 'new' ? 'The link is not committed: commit it to share it.' : ''}`.trim(),
    );

  const current = state?.skills.find((s) => s.path === open);
  const groups = state ? skillGroups(state) : [];
  const codex = state?.codex;
  const library = state?.library;
  const librarySkills = state?.skills.filter((s) => s.folder === 'library') ?? [];
  const found = (skills: Skill[]) => skills.filter((skill) => skillMatches(skill, query));
  const shownGroups = groups
    .map((group) => ({ ...group, skills: found(group.skills) }))
    .filter((group) => group.skills.length > 0);
  const shownLibrary = found(librarySkills);
  const searching = query.trim() !== '';
  /** A skill's entry: its icon, its name, its mark. */
  const skillEntry = (skill: Skill) => (
    <li key={skill.path}>
      <button
        type="button"
        aria-current={skill.path === open ? 'true' : undefined}
        onClick={() => show(skill.path)}
      >
        <DocumentsIcon />
        <span className="skills-name">{skill.name}</span>
        {edited.includes(skill.path) ? (
          <span className="skills-mark unsaved">not saved</span>
        ) : skill.git === 'new' ? (
          <span className="skills-mark added">new</span>
        ) : (
          skill.git === 'changed' && <span className="skills-mark changed">changed</span>
        )}
      </button>
    </li>
  );
  return (
    <div className={`skills${expanded && current ? ' expanded' : ''}`}>
      {/* Settings' head (V64, decision 458): the page's icon, its title and a line under it. */}
      <PageHead
        className="skills-bar"
        icon={<SkillsIcon />}
        title="Skills"
        beside={
          <Help label="About Skills">
            <p>
              A skill is a folder with a SKILL.md: its name and description tell an agent when to
              load it, and the rest how to do the work. Claude Code reads .claude/skills, Codex
              .agents/skills.
            </p>
            <p>
              Saved in this checkout as files: commit them to share them with everyone who uses this
              repository.
            </p>
            <p>
              The skill library, set in Settings, keeps skills outside the repository, for every
              repository on this machine.
            </p>
          </Help>
        }
        line="What your agents load for a kind of work: this checkout's skills and your library's."
        actions={
          <button
            type="button"
            className="button skills-new-button"
            aria-current={open === NEW ? 'true' : undefined}
            onClick={() => show(NEW)}
          >
            <PlusIcon /> New skill
          </button>
        }
      />
      {error && (
        <p className="skills-note error" role="alert">
          {error}
        </p>
      )}
      {codex?.installed && codex.link === 'none' && (
        <p className="skills-note skills-codex">
          Codex reads .agents/skills, not .claude/skills: it sees none of these skills.{' '}
          {codex.canLink ? (
            <button type="button" className="link" disabled={busy} onClick={link}>
              Link for Codex
            </button>
          ) : (
            codex.reason
          )}
          <Help label="About Link for Codex">
            Makes .agents/skills a link to .claude/skills: one copy of each skill, read by both
            agents. The link is a file git shows as new; commit it to share it.
          </Help>
        </p>
      )}
      {notice?.at === 'codex' && (
        <p className={`skills-note${notice.error ? ' error' : ''}`} role="status">
          {notice.text}
        </p>
      )}
      {!state ? (
        !error && <Loading className="hint">Reading the skills…</Loading>
      ) : (
        <div className={`skills-body${picked ? ' picked' : ''}`}>
          <nav className="skills-list" aria-label="Skills">
            <label className="skills-search">
              <SearchIcon />
              <input
                type="search"
                aria-label="Search skills"
                placeholder="Search skills…"
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
            <section aria-label="Scribe">
              <h2>Agent</h2>
              <ul>
                <li>
                  <button
                    type="button"
                    aria-current={open === SCRIBE ? 'true' : undefined}
                    {...tip(
                      scribe?.conversation ? pageAgentStateText(scribe.conversation) : undefined,
                    )}
                    onClick={() => show(SCRIBE)}
                  >
                    <SparklesIcon />
                    <span className="skills-name">Scribe</span>
                    {scribe?.conversation && (
                      // A flex item, as in the sidenav: an inline dot has no size.
                      <span
                        className={`state-dot ${toneOf(scribe.conversation.state)}`}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              </ul>
            </section>
            {groups.length === 0 && (
              <p className="hint skills-none">No skills in this checkout yet.</p>
            )}
            {searching && shownGroups.length === 0 && shownLibrary.length === 0 && (
              <p className="hint skills-none">No skill matches “{query.trim()}”.</p>
            )}
            {shownGroups.map((group) => (
              <section key={group.folder} aria-label={group.title}>
                <h2>{group.title}</h2>
                <ul>{group.skills.map(skillEntry)}</ul>
              </section>
            ))}
            {library ? (
              <section aria-label="Library">
                <h2>Library</h2>
                <ul>
                  <li>
                    <button
                      type="button"
                      aria-current={open === LIBRARY ? 'true' : undefined}
                      {...tip(libraryTip(library))}
                      onClick={() => show(LIBRARY)}
                    >
                      <FolderIcon />
                      <span className="skills-name">{libraryName(library)}</span>
                      {libraryMark(library)}
                    </button>
                  </li>
                  {shownLibrary.map(skillEntry)}
                </ul>
              </section>
            ) : (
              <p className="hint skills-library-unset">
                Skills for every repository:{' '}
                <a
                  className="link"
                  href={hrefOf(LIBRARY_SETTINGS)}
                  onClick={(event) => {
                    if (!shell) return;
                    event.preventDefault();
                    toSettings();
                  }}
                >
                  Set a skill library in Settings
                </a>
                .
              </p>
            )}
          </nav>
          {open === SCRIBE && (
            <div className="skills-pane skills-scribe">
              <button type="button" className="button ghost skills-back" onClick={back}>
                <BackIcon /> All skills
              </button>
              <Conversation agent={scribeAgent(scribe, asking, () => setAsking(undefined))} />
            </div>
          )}
          {open === LIBRARY && library && (
            <LibraryPane
              library={library}
              skills={librarySkills.length}
              busy={busy}
              notice={notice?.at === LIBRARY ? notice : null}
              onCommit={(message) =>
                void libraryGit(
                  { action: 'commit', message },
                  library.commits === 'push' ? 'Committed and pushed.' : 'Committed.',
                )
              }
              onPush={() => void libraryGit({ action: 'push' }, 'Pushed.')}
              onPull={() => void libraryGit({ action: 'pull' }, 'Pulled.')}
              onSettings={toSettings}
              onBack={back}
            />
          )}
          {open === NEW && (
            <NewSkill
              busy={busy}
              notice={notice?.at === NEW ? notice : null}
              library={library?.exists && !library.checkout ? library.folder : undefined}
              taken={(name, where) =>
                state.skills.some(
                  (s) =>
                    s.folder === (where === 'library' ? 'library' : '.claude/skills') &&
                    s.name === name,
                )
              }
              onCreate={create}
              onScribe={() => show(SCRIBE)}
              onBack={back}
            />
          )}
          {current && (
            <SkillEditor
              key={current.path}
              skill={current}
              library={library}
              draft={drafts[current.path]}
              busy={busy}
              notice={notice?.at === current.path ? notice : null}
              expanded={expanded}
              onDraft={(text) => setDrafts((all) => ({ ...all, [current.path]: text }))}
              onDiscard={() => setDrafts((all) => without(all, current.path))}
              onSave={(text) => void save(current, text)}
              onDelete={() => void remove(current)}
              onImprove={() => improve(current)}
              onOpen={(line, unsaved) => void openInCode(current, line, unsaved)}
              onExpand={setExpanded}
              onLoad={() => void load().then(() => setNotice(null))}
              onBack={back}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The library's entry's tip: its git, and how far it is from its upstream. */
function libraryTip(library: LibraryState): string {
  const sync = library.git ? librarySync(library.git) : '';
  return `${libraryGitText(library)}${sync ? ` ${sync}.` : ''}`;
}

/** The library's entry's mark: its changes, else its commits to push, else that it is gone. */
function libraryMark(library: LibraryState) {
  if (!library.exists) return <span className="skills-mark changed">not there</span>;
  const changes = library.git?.changes.length ?? 0;
  if (changes > 0) return <span className="skills-mark changed">{changes} changed</span>;
  const ahead = library.git?.ahead ?? 0;
  if (ahead > 0) return <span className="skills-mark">{ahead} to push</span>;
  return null;
}
