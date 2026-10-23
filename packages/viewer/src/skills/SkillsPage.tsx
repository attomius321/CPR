import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Skill, SkillChange, SkillsState } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { getJson, postJson } from '../ui/http.js';
import { BackIcon, PlusIcon } from '../ui/icons.js';
import { useShell } from '../shell/shell-context.js';
import {
  isSkillEdited,
  newSkillProblem,
  skillChecks,
  skillGitNote,
  skillGroups,
  skillOfUrl,
  skillSize,
} from './skills.js';

const API = '/api/skills';
/** The form for a new skill, in the list's place of a skill's path. */
const NEW = 'new';

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

/** The address of what is open: a skill by its path, or the form. */
function addressOf(open: string): string {
  return open === NEW ? '?new' : `?skill=${encodeURIComponent(open)}`;
}

/**
 * Skills (V41a): the checkout's skills — `.claude/skills/` (Claude Code) and `.agents/skills/`
 * (Codex) — each opened as its `SKILL.md`, checked as one types, saved in place for the person to
 * commit; a new one from its name and description; Link for Codex when Codex does not read Claude
 * Code's. Drafts are kept while another skill is open; leaving with one asks first.
 */
export function SkillsPage() {
  const [state, setState] = useState<SkillsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** On a narrow screen, a skill picked takes the page. */
  const [picked, setPicked] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('skill') || params.has(NEW);
  });
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
      // No skill yet: the form for the first one.
      setOpen(new URLSearchParams(search).has(NEW) ? NEW : (skillOfUrl(search, paths) ?? NEW));
    });
  }, [load]);
  // A skill written elsewhere (an editor, an agent) shows when the page is back in view.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const edited = useMemo(
    () => state?.skills.filter((s) => isSkillEdited(s, drafts[s.path])).map((s) => s.path) ?? [],
    [state, drafts],
  );
  // Leaving with an unsaved change asks first, as Settings does (V28b).
  const setLeaveGuard = useShell()?.setLeaveGuard;
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
    const next = await change(
      skill.path,
      { action: 'delete', path: skill.path, version: skill.version },
      () => `Deleted ${skill.folder}/${skill.name}.`,
    );
    if (!next) return;
    setDrafts((all) => without(all, skill.path));
    const first = next.skills[0]?.path ?? NEW;
    setOpen(first);
    setNotice({ at: first, text: `Deleted ${skill.folder}/${skill.name}.` });
    window.history.replaceState(null, '', addressOf(first));
  };
  const create = async (name: string, description: string) => {
    const next = await change(NEW, { action: 'new', name, description }, () => '');
    const made = next?.skills.find((s) => s.folder === '.claude/skills' && s.name === name);
    if (!made) return false;
    setOpen(made.path);
    setNotice({
      at: made.path,
      text: `Made ${made.path}. Write its instructions under the frontmatter, then save.`,
    });
    window.history.replaceState(null, '', addressOf(made.path));
    return true;
  };
  const link = () =>
    void change('codex', { action: 'link' }, (next) =>
      `Linked: Codex reads .agents/skills, now .claude/skills. ${next.codex.git === 'new' ? 'The link is not committed: commit it to share it.' : ''}`.trim(),
    );

  const current = state?.skills.find((s) => s.path === open);
  const groups = state ? skillGroups(state) : [];
  const codex = state?.codex;
  return (
    <div className="settings skills">
      <div className="commits-title settings-bar">
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
        <p className="commits-error error" role="alert">
          {error}
        </p>
      )}
      {codex?.installed && codex.link === 'none' && (
        <p className="settings-git skills-codex">
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
        <p className={`settings-git${notice.error ? ' error' : ''}`} role="status">
          {notice.text}
        </p>
      )}
      {!state ? (
        !error && <p className="hint">Reading the skills…</p>
      ) : (
        <div className={`settings-body${picked ? ' picked' : ''}`}>
          <nav className="settings-list" aria-label="Skills">
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
                        <span className="settings-name">{skill.name}</span>
                        {edited.includes(skill.path) ? (
                          <span className="settings-mark unsaved">not saved</span>
                        ) : skill.git === 'new' ? (
                          <span className="settings-mark added">new</span>
                        ) : (
                          skill.git === 'changed' && (
                            <span className="settings-mark changed">changed</span>
                          )
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
          {open === NEW && (
            <NewSkill
              busy={busy}
              notice={notice?.at === NEW ? notice : null}
              taken={(name) =>
                state.skills.some((s) => s.folder === '.claude/skills' && s.name === name)
              }
              onCreate={create}
              onBack={back}
            />
          )}
          {current && (
            <SkillEditor
              key={current.path}
              skill={current}
              draft={drafts[current.path]}
              busy={busy}
              notice={notice?.at === current.path ? notice : null}
              onDraft={(text) => setDrafts((all) => ({ ...all, [current.path]: text }))}
              onDiscard={() => setDrafts((all) => without(all, current.path))}
              onSave={(text) => void save(current, text)}
              onDelete={() => void remove(current)}
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

/** One skill: its `SKILL.md` to change, its checks and files, Save and Delete. */
function SkillEditor({
  skill,
  draft,
  busy,
  notice,
  onDraft,
  onDiscard,
  onSave,
  onDelete,
  onLoad,
  onBack,
}: {
  skill: Skill;
  draft: string | undefined;
  busy: boolean;
  notice: Notice | null;
  onDraft: (text: string) => void;
  onDiscard: () => void;
  onSave: (text: string) => void;
  onDelete: () => void;
  onLoad: () => void;
  onBack: () => void;
}) {
  const text = draft ?? skill.text ?? '';
  const edited = isSkillEdited(skill, draft);
  const checks = useMemo(() => skillChecks(skill, text), [skill, text]);
  const [deleting, setDeleting] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const canSave = edited && !busy && !skill.tooLarge;
  // As tall as its text, up to 70 % of the window (its CSS max-height), as Settings' editor.
  useLayoutEffect(() => {
    const field = area.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + 2}px`;
  }, [text]);

  return (
    <section className="settings-editor skills-editor" aria-label={`Skill: ${skill.name}`}>
      <button type="button" className="button ghost settings-back" onClick={onBack}>
        <BackIcon /> All skills
      </button>
      <h2>
        {skill.name}
        <span className={`settings-state${skill.git === 'committed' ? '' : ' changed'}`}>
          {skill.git === 'new' ? 'New' : skill.git === 'changed' ? 'Changed' : 'Committed'}
        </span>
      </h2>
      <p className="skills-where">
        <code>{skill.path}</code> · read by {readers(skill)} · {skillGitNote(skill.git)}
      </p>
      {skill.tooLarge ? (
        <p className="settings-warning" role="alert">
          Its SKILL.md is too large to edit here (over 256 KB): open it in an editor.
        </p>
      ) : (
        <>
          <textarea
            ref={area}
            aria-label={`${skill.name} SKILL.md`}
            value={text}
            spellCheck={false}
            rows={7}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              const saving = event.key === 's' && (event.ctrlKey || event.metaKey);
              if (!saving) return;
              event.preventDefault();
              if (canSave) onSave(text);
            }}
          />
          <p className="settings-size">{skillSize(text)}</p>
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
              Nothing the standard or the agents would refuse.
              <Help label="About the checks">
                The checks are the open standard&apos;s (agentskills.io) and what Claude Code, Codex
                and Anthropic&apos;s API refuse or cut. Whether it says the right thing is yours to
                read.
              </Help>
            </p>
          )}
        </>
      )}
      {skill.files.length > 0 && (
        <div className="skills-files">
          <p>Its other files</p>
          <ul>
            {skill.files.map((file) => (
              <li key={file}>{file}</li>
            ))}
            {skill.moreFiles && <li className="hint">and more</li>}
          </ul>
        </div>
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
        {deleting ? (
          <span className="workspace-confirm">
            Deletes {skill.folder}/{skill.name}
            {skill.files.length > 0 ? ` and its ${skill.files.length} other files` : ''}
            {skill.git === 'new' ? ', not committed: it is gone for good.' : ': git keeps it.'}{' '}
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
        {edited && (
          <button type="button" className="button ghost" disabled={busy} onClick={onDiscard}>
            Discard changes
          </button>
        )}
        <button
          type="button"
          className="button"
          disabled={!canSave}
          title="Save it in this checkout (Ctrl+S)"
          onClick={() => onSave(text)}
        >
          Save
        </button>
      </div>
    </section>
  );
}

/** A new skill: its name and description, written as its frontmatter in `.claude/skills/`. */
function NewSkill({
  busy,
  notice,
  taken,
  onCreate,
  onBack,
}: {
  busy: boolean;
  notice: Notice | null;
  taken: (name: string) => boolean;
  onCreate: (name: string, description: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const problem = newSkillProblem(name, description, taken);
  // Said once something is typed: an empty form is not wrong yet.
  const shown = name === '' && description === '' ? null : problem;
  return (
    <form
      className="settings-editor skills-new"
      aria-label="New skill"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem || busy) return;
        void onCreate(name, description).then((made) => {
          if (made) {
            setName('');
            setDescription('');
          }
        });
      }}
    >
      <button type="button" className="button ghost settings-back" onClick={onBack}>
        <BackIcon /> All skills
      </button>
      <h2>New skill</h2>
      <div className="skills-field">
        <span className="field-label">
          <label htmlFor="skill-name">Name</label>
          <Help label="About the name">
            Lowercase letters, digits and hyphens, 64 at most: the folder&apos;s name in
            .claude/skills, and the /command in Claude Code. Say the activity: release-notes,
            reviewing-migrations.
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
        <p className={`settings-size${shown ? ' error' : ''}`}>
          {shown ?? `${description.length.toLocaleString('en-US')} of 1,024 characters`}
        </p>
      </div>
      <div className="settings-actions">
        {notice && (
          <span className={`settings-notice${notice.error ? ' error' : ''}`} role="status">
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
