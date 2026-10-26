import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LibraryState, Skill, SkillChange, SkillsState } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { getJson, postJson } from '../ui/http.js';
import { BackIcon, PlusIcon } from '../ui/icons.js';
import { useShell } from '../shell/shell-context.js';
import { hrefOf, type Route } from '../shell/pages.js';
import { Conversation, type ConversationAgent } from '../scout/Conversation.js';
import { scoutStateText } from '../scout/scout.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import {
  isSkillEdited,
  newSkillProblem,
  skillChecks,
  skillGitNote,
  skillGroups,
  skillOfUrl,
  skillSize,
} from './skills.js';
import { tip } from '../ui/tip.js';
import { libraryGitText, libraryName, librarySync, skillPlace } from './library.js';
import { LibraryPane } from './LibraryPane.js';

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

/** What the page says after a change, under the skill (or the form) it was made from. */
interface Notice {
  at: string;
  text: string;
  error?: boolean;
  /** The file changed since it was read (409): read it again, the drafts kept. */
  stale?: boolean;
}

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

/** Scribe (V41b) as its conversation shows it, `draft` put in its box by Improve with Scribe. */
const scribeAgent = (
  state: ConversationAgent['state'],
  draft: ConversationAgent['draft'],
): ConversationAgent => ({
  name: 'Scribe',
  api: '/api/scribe',
  state,
  className: 'scribe-pane',
  heading: 'h2',
  doing: 'Writes skills in .claude/skills of',
  label: 'Ask Scribe for a skill',
  help: (
    <>
      <p>
        Scribe writes a new skill, or changes one, in .claude/skills, from what you ask. It reads
        this checkout&apos;s files and git&apos;s history, and writes nothing else.
      </p>
      <p>
        Claude Code asks you before each write into .claude, in its terminal here. Scribe never
        commits: read the skill here, change it, and commit it.
      </p>
    </>
  ),
  placeholder:
    'A skill for adding a prompt to Settings: where the texts live, the tests to write first, how the page lists it.',
  submit: 'Write',
  noun: 'request',
  effortHelp: 'The level this conversation starts at; Settings sets the one each starts at.',
  ...(draft ? { draft } : {}),
});

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
  /** What Improve with Scribe puts in Scribe's box. */
  const [asking, setAsking] = useState<{ text: string; at: number } | undefined>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

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

  const show = (at: string) => {
    setOpen(at);
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
    setAsking({ text: `Improve ${skillPlace(skill, state?.library)}: `, at: Date.now() });
    show(SCRIBE);
  };
  /** A change to the library's git (SK1); read again after a refusal, which may follow a commit. */
  const libraryGit = async (request: SkillChange, done: string) => {
    if (!(await change(LIBRARY, request, () => done))) void load();
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
  return (
    <div className="skills">
      <div className="commits-title skills-bar">
        <h1>Skills</h1>
        <Help label="About Skills">
          <p>
            A skill is a folder with a SKILL.md: its name and description tell an agent when to load
            it, and the rest how to do the work. Claude Code reads .claude/skills, Codex
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
        <button
          type="button"
          className="button secondary skills-new-button"
          aria-current={open === NEW ? 'true' : undefined}
          onClick={() => show(NEW)}
        >
          <PlusIcon /> New skill
        </button>
      </div>
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
        !error && <p className="hint">Reading the skills…</p>
      ) : (
        <div className={`skills-body${picked ? ' picked' : ''}`}>
          <nav className="skills-list" aria-label="Skills">
            <section aria-label="Scribe">
              <h2>Agent</h2>
              <ul>
                <li>
                  <button
                    type="button"
                    aria-current={open === SCRIBE ? 'true' : undefined}
                    {...tip(scribe?.conversation ? scoutStateText(scribe.conversation) : undefined)}
                    onClick={() => show(SCRIBE)}
                  >
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
            {groups.map((group) => (
              <section key={group.folder} aria-label={group.title}>
                <h2>{group.title}</h2>
                <ul>
                  {group.skills.map((skill) => (
                    <li key={skill.path}>
                      <button
                        type="button"
                        aria-current={skill.path === open ? 'true' : undefined}
                        onClick={() => show(skill.path)}
                      >
                        <span className="skills-name">{skill.name}</span>
                        {edited.includes(skill.path) ? (
                          <span className="skills-mark unsaved">not saved</span>
                        ) : skill.git === 'new' ? (
                          <span className="skills-mark added">new</span>
                        ) : (
                          skill.git === 'changed' && (
                            <span className="skills-mark changed">changed</span>
                          )
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
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
                      <span className="skills-name">{libraryName(library)}</span>
                      {libraryMark(library)}
                    </button>
                  </li>
                  {librarySkills.map((skill) => (
                    <li key={skill.path}>
                      <button
                        type="button"
                        aria-current={skill.path === open ? 'true' : undefined}
                        onClick={() => show(skill.path)}
                      >
                        <span className="skills-name">{skill.name}</span>
                        {edited.includes(skill.path) ? (
                          <span className="skills-mark unsaved">not saved</span>
                        ) : skill.git === 'new' ? (
                          <span className="skills-mark added">new</span>
                        ) : (
                          skill.git === 'changed' && (
                            <span className="skills-mark changed">changed</span>
                          )
                        )}
                      </button>
                    </li>
                  ))}
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
              {asking && scribe?.conversation && scribe.conversation.state !== 'gone' && (
                <p className="skills-scribe-note">
                  Its conversation goes on: tell it in its terminal, or start a new one, which takes
                  &ldquo;{asking.text.trim()}&rdquo;.
                </p>
              )}
              <Conversation agent={scribeAgent(scribe, asking)} />
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
              onDraft={(text) => setDrafts((all) => ({ ...all, [current.path]: text }))}
              onDiscard={() => setDrafts((all) => without(all, current.path))}
              onSave={(text) => void save(current, text)}
              onDelete={() => void remove(current)}
              onImprove={() => improve(current)}
              onLoad={() => void load().then(() => setNotice(null))}
              onBack={back}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Who reads a skill, in words. */
const readers = (skill: Skill) =>
  skill.agents.map((a) => (a === 'claude' ? 'Claude Code' : 'Codex')).join(' and ');

/** The folder a skill's folder is in, as shown: the checkout's, or the library's in full (SK1). */
const folderOf = (skill: Skill, library: LibraryState | undefined) =>
  skill.folder === 'library' && library ? library.folder : skill.folder;

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

/**
 * One skill: its name and where it is, its `SKILL.md` as tall as the pane, its checks and other
 * files beside it (under it in a narrow pane), then Save and Delete (V56).
 */
function SkillEditor({
  skill,
  library,
  draft,
  busy,
  notice,
  onDraft,
  onDiscard,
  onSave,
  onDelete,
  onImprove,
  onLoad,
  onBack,
}: {
  skill: Skill;
  /** The skill library (SK1): where a skill of it is. */
  library: LibraryState | undefined;
  draft: string | undefined;
  busy: boolean;
  notice: Notice | null;
  onDraft: (text: string) => void;
  onDiscard: () => void;
  onSave: (text: string) => void;
  onDelete: () => void;
  onImprove: () => void;
  onLoad: () => void;
  onBack: () => void;
}) {
  const text = draft ?? skill.text ?? '';
  const edited = isSkillEdited(skill, draft);
  const checks = useMemo(() => skillChecks(skill, text), [skill, text]);
  const [deleting, setDeleting] = useState(false);
  const canSave = edited && !busy && !skill.tooLarge;
  const inLibrary = skill.folder === 'library';

  return (
    <section className="skills-pane skills-editor" aria-label={`Skill: ${skill.name}`}>
      <button type="button" className="button ghost skills-back" onClick={onBack}>
        <BackIcon /> All skills
      </button>
      <h2>
        {skill.name}
        {skill.git !== 'none' && (
          <span
            className={`skills-state${skill.git === 'new' ? ' added' : skill.git === 'committed' ? '' : ' changed'}`}
          >
            {skill.git === 'new' ? 'New' : skill.git === 'changed' ? 'Changed' : 'Committed'}
          </span>
        )}
      </h2>
      <p className="skills-where">
        <code>{skillPlace(skill, library)}</code> ·{' '}
        {inLibrary
          ? `in your skill library · ${library?.git ? skillGitNote(skill.git) : 'A plain folder: no git.'}`
          : `read by ${readers(skill)} · ${skillGitNote(skill.git)}`}
      </p>
      {skill.tooLarge && (
        <p className="skills-warning" role="alert">
          Its SKILL.md is too large to edit here (over 256 KB): open it in an editor.
        </p>
      )}
      <div className="skills-work">
        {!skill.tooLarge && (
          <textarea
            aria-label={`${skill.name} SKILL.md`}
            value={text}
            spellCheck={false}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              const saving = event.key === 's' && (event.ctrlKey || event.metaKey);
              if (!saving) return;
              event.preventDefault();
              if (canSave) onSave(text);
            }}
          />
        )}
        <div className="skills-side">
          {!skill.tooLarge && (
            <>
              <h3>Checks</h3>
              {checks.length > 0 ? (
                <ul className="skills-checks" aria-label="Checks">
                  {checks.map((check) => (
                    <li key={check.text} className={check.level}>
                      {check.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="skills-checks-none">
                  Nothing the standard or the agents would refuse.{' '}
                  <Help label="About the checks">
                    The checks are the open standard&apos;s (agentskills.io) and what Claude Code,
                    Codex and Anthropic&apos;s API refuse or cut. Whether it says the right thing is
                    yours to read.
                  </Help>
                </p>
              )}
            </>
          )}
          {skill.files.length > 0 && (
            <>
              <h3>Its other files</h3>
              <ul className="skills-files">
                {skill.files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
                {skill.moreFiles && <li className="hint">and more</li>}
              </ul>
            </>
          )}
        </div>
      </div>
      <div className="skills-actions">
        {!skill.tooLarge && <span className="skills-size">{skillSize(text)}</span>}
        {notice && (
          <span className={`skills-notice${notice.error ? ' error' : ''}`} role="status">
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
        {deleting ? (
          <span className="workspace-confirm">
            Deletes {folderOf(skill, library)}/{skill.name}
            {skill.files.length > 0 ? ` and its ${skill.files.length} other files` : ''}
            {skill.git === 'new' || skill.git === 'none'
              ? ', not committed: it is gone for good.'
              : ': git keeps it.'}{' '}
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setDeleting(false);
                onDelete();
              }}
            >
              Delete
            </button>{' '}
            <button type="button" className="button ghost" onClick={() => setDeleting(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="button ghost"
            disabled={busy}
            onClick={() => setDeleting(true)}
          >
            Delete…
          </button>
        )}
        <button
          type="button"
          className="button ghost"
          {...tip('Ask Scribe to change this skill')}
          onClick={onImprove}
        >
          Improve with Scribe
        </button>
        {edited && (
          <button type="button" className="button ghost" disabled={busy} onClick={onDiscard}>
            Discard changes
          </button>
        )}
        <button
          type="button"
          className="button"
          disabled={!canSave}
          {...tip(inLibrary ? 'Save it in your skill library' : 'Save it in this checkout', {
            keys: 'Ctrl+S',
          })}
          onClick={() => onSave(text)}
        >
          Save
        </button>
      </div>
    </section>
  );
}

/**
 * A new skill: its name and description, written as its frontmatter in `.claude/skills/`, or in the
 * skill library's folder (SK1) when one is set and the person picks it.
 */
function NewSkill({
  busy,
  notice,
  library,
  taken,
  onCreate,
  onScribe,
  onBack,
}: {
  busy: boolean;
  notice: Notice | null;
  /** The library's folder, when a skill can be made there. */
  library: string | undefined;
  taken: (name: string, where: 'checkout' | 'library') => boolean;
  onCreate: (name: string, description: string, where: 'checkout' | 'library') => Promise<boolean>;
  onScribe: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<'checkout' | 'library'>('checkout');
  const where = library ? picked : 'checkout';
  const problem = newSkillProblem(
    name,
    description,
    (n) => taken(n, where),
    where === 'library' && library ? library : '.claude/skills',
  );
  // Said once something is typed: an empty form is not wrong yet.
  const shown = name === '' && description === '' ? null : problem;
  return (
    <form
      className="skills-pane skills-new"
      aria-label="New skill"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem || busy) return;
        void onCreate(name, description, where).then((made) => {
          if (made) {
            setName('');
            setDescription('');
          }
        });
      }}
    >
      <button type="button" className="button ghost skills-back" onClick={onBack}>
        <BackIcon /> All skills
      </button>
      <h2>New skill</h2>
      <p className="skills-where">
        Its name and description here, its instructions in the editor next; or{' '}
        <button type="button" className="link" onClick={onScribe}>
          ask Scribe to write it
        </button>
        .
      </p>
      {library && (
        <div className="skills-field">
          <span className="field-label" id="skill-where">
            Where
          </span>
          <span className="scopes skills-where-choice" role="group" aria-labelledby="skill-where">
            {(['checkout', 'library'] as const).map((place) => (
              <button
                key={place}
                type="button"
                className={where === place ? 'scope active' : 'scope'}
                aria-pressed={where === place}
                {...tip(place === 'library' ? library : 'This checkout, read by its agents')}
                onClick={() => setPicked(place)}
              >
                {place === 'library' ? 'Library' : '.claude/skills'}
              </button>
            ))}
          </span>
        </div>
      )}
      <div className="skills-field">
        <span className="field-label">
          <label htmlFor="skill-name">Name</label>
          <Help label="About the name">
            Lowercase letters, digits and hyphens, 64 at most: the folder&apos;s name in
            .claude/skills or the library, and the /command in Claude Code. Say the activity:
            release-notes, reviewing-migrations.
          </Help>
        </span>
        <input
          id="skill-name"
          value={name}
          autoComplete="off"
          spellCheck={false}
          placeholder="release-notes"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="skills-field">
        <span className="field-label">
          <label htmlFor="skill-description">Description</label>
          <Help label="About the description">
            What it does and when to use it, in the third person, the main use first: an agent reads
            only this before loading the skill. &quot;Writes release notes from merged branches. Use
            when asked for release notes or a changelog.&quot;
          </Help>
        </span>
        <textarea
          id="skill-description"
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <p className={`skills-size${shown ? ' error' : ''}`}>
          {shown ?? `${description.length.toLocaleString('en-US')} of 1,024 characters`}
        </p>
      </div>
      <div className="skills-actions">
        {notice && (
          <span className={`skills-notice${notice.error ? ' error' : ''}`} role="status">
            {notice.text}
          </span>
        )}
        <button type="submit" className="button" disabled={busy || problem !== null}>
          Create
        </button>
      </div>
    </form>
  );
}
