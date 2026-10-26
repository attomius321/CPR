import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LibraryCommits,
  LibraryProbe,
  LibraryState,
  SkillChange,
  SkillsState,
} from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { getJson, postJson } from '../ui/http.js';
import { probeText } from '../skills/library.js';
import { BackToList } from './BackToList.js';

const API = '/api/skills';
/** How long typing rests before Symbiote looks at the folder typed. */
const PROBE_MS = 250;

const SOURCES = [
  { clone: false, label: 'A folder' },
  { clone: true, label: 'Clone a repository' },
] as const;

const COMMITS: { commits: LibraryCommits; label: string; note: string }[] = [
  {
    commits: 'none',
    label: 'Leave git to me',
    note: 'Symbiote writes the files; you commit them where the library is.',
  },
  {
    commits: 'commit',
    label: 'Commit',
    note: "The Skills page commits the library's changes, and only those, with your message.",
  },
  {
    commits: 'push',
    label: 'Commit and push',
    note: 'The Skills page commits them, then pushes; it pulls too, fast-forward only.',
  },
];

/**
 * The skill library (SK1, decision 427): one folder of skills outside the repository, for every
 * repository on this machine; kept in Symbiote's config folder, not the project's. What is at the
 * folder typed is said before it is saved; a missing one is made only when Save says so.
 */
export function LibraryPage({ onBack }: { onBack: () => void }) {
  /** The library as the server has it: undefined while it is read, null when none is set. */
  const [library, setLibrary] = useState<LibraryState | null | undefined>(undefined);
  const [clone, setClone] = useState(false);
  const [folder, setFolder] = useState('');
  const [url, setUrl] = useState('');
  const [commits, setCommits] = useState<LibraryCommits>('none');
  const [probe, setProbe] = useState<LibraryProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  /** The library read again, the form as it is set. */
  const took = useCallback((state: SkillsState) => {
    const next = state.library ?? null;
    setLibrary(next);
    setFolder(next?.folder ?? '');
    setCommits(next?.commits ?? 'none');
    setClone(false);
    setUrl('');
  }, []);
  useEffect(() => {
    let current = true;
    getJson<SkillsState>(API)
      .then((state) => {
        if (current) took(state);
      })
      .catch((failed: unknown) => {
        if (!current) return;
        setLibrary(null);
        setNotice({
          text: `The library could not be read: ${(failed as Error).message}`,
          error: true,
        });
      });
    return () => {
      current = false;
    };
  }, [took]);

  // What is at the folder typed, once typing rests; an older answer never replaces a newer one.
  const asked = useRef(0);
  useEffect(() => {
    const typed = folder.trim();
    const ask = ++asked.current;
    if (typed === '') {
      setProbe(null);
      return;
    }
    const timer = setTimeout(() => {
      getJson<LibraryProbe>(`${API}/library?folder=${encodeURIComponent(typed)}`)
        .then((answer) => {
          if (ask === asked.current) setProbe(answer);
        })
        .catch(() => {
          if (ask === asked.current) setProbe(null);
        });
    }, PROBE_MS);
    return () => clearTimeout(timer);
  }, [folder]);

  const said = probe ? probeText(probe, clone) : null;
  const save = said?.save ?? null;
  const ready = !busy && folder.trim() !== '' && save !== null && (!clone || url.trim() !== '');

  const change = async (request: SkillChange, done: string) => {
    setBusy(true);
    try {
      const state = await postJson<SkillsState>(API, request);
      took(state);
      setNotice({
        text:
          request.action === 'library' && state.library && state.library.folder !== folder.trim()
            ? `${done} The library is ${state.library.folder}.`
            : done,
      });
    } catch (failed) {
      setNotice({ text: (failed as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const onSave = () =>
    void change(
      {
        action: 'library',
        folder: folder.trim(),
        commits,
        ...(clone ? { url: url.trim() } : {}),
        ...(save === 'create' ? { create: true } : {}),
      },
      clone ? 'Cloned and saved.' : 'Saved: the Skills page lists its skills.',
    );

  const note = COMMITS.find((c) => c.commits === commits)?.note;
  return (
    <section className="settings-editor library-settings" aria-label="Skill library">
      <BackToList onBack={onBack} />
      <h2>Skill library</h2>
      <p className="settings-row-note library-about">
        One folder of skills outside this repository, for every repository you open on this machine:
        the Skills page lists them beside the checkout&apos;s, and Scribe writes them.{' '}
        <Help label="About the skill library">
          A plain folder, or one in a git repository: each skill a folder with its SKILL.md. Kept in
          Symbiote&apos;s settings on this machine, not in the project. No agent reads the library
          from there: it is where you keep and write them.
        </Help>
      </p>
      {library === undefined ? (
        <p className="hint">Reading the library…</p>
      ) : (
        <div className="settings-card settings-rows">
          <section className="settings-part" aria-label="Source">
            <h3 id="library-source">Source</h3>
            <span className="scopes" role="group" aria-labelledby="library-source">
              {SOURCES.map((source) => (
                <button
                  key={source.label}
                  type="button"
                  className={clone === source.clone ? 'scope active' : 'scope'}
                  aria-pressed={clone === source.clone}
                  onClick={() => setClone(source.clone)}
                >
                  {source.label}
                </button>
              ))}
            </span>
          </section>
          {clone && (
            <section className="settings-part" aria-label="Repository">
              <h3>
                <label htmlFor="library-url">Repository</label>
              </h3>
              <input
                id="library-url"
                className="library-field"
                value={url}
                autoComplete="off"
                spellCheck={false}
                placeholder="git@github.com:you/skills.git"
                onChange={(event) => setUrl(event.target.value)}
              />
              <p className="settings-row-note">
                Cloned into the folder; the library is its skills folder when it has one.
              </p>
            </section>
          )}
          <section className="settings-part" aria-label="Folder">
            <h3>
              <label htmlFor="library-folder">{clone ? 'Clone into' : 'Folder'}</label>
            </h3>
            <input
              id="library-folder"
              className="library-field"
              value={folder}
              autoComplete="off"
              spellCheck={false}
              placeholder="~/skills"
              onChange={(event) => setFolder(event.target.value)}
            />
            {said && (
              <p className={`settings-row-note library-probe${said.error ? ' error' : ''}`}>
                {said.text}
              </p>
            )}
          </section>
          <section className="settings-part" aria-label="Commits">
            <h3 id="library-commits">Commits</h3>
            <span className="scopes" role="group" aria-labelledby="library-commits">
              {COMMITS.map((choice) => (
                <button
                  key={choice.commits}
                  type="button"
                  className={commits === choice.commits ? 'scope active' : 'scope'}
                  aria-pressed={commits === choice.commits}
                  onClick={() => setCommits(choice.commits)}
                >
                  {choice.label}
                </button>
              ))}
            </span>
            <p className="settings-row-note">{note}</p>
          </section>
        </div>
      )}
      <div className="settings-actions">
        {notice && (
          <span className={`settings-notice${notice.error ? ' error' : ''}`} role="status">
            {notice.text}
          </span>
        )}
        {library && (
          <button
            type="button"
            className="button ghost"
            disabled={busy}
            onClick={() =>
              void change({ action: 'forget' }, 'Forgotten: the folder stays as it is.')
            }
          >
            Forget
          </button>
        )}
        <button type="button" className="button" disabled={!ready} onClick={onSave}>
          {save === 'create' ? 'Make the folder and save' : clone ? 'Clone and save' : 'Save'}
        </button>
      </div>
    </section>
  );
}
