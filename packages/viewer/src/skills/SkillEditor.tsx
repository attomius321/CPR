// One skill on the Skills page (V64): its card, its `SKILL.md` to change, its checks and other
// files beside it, and what the page says after a change.
import { useMemo, useRef, useState } from 'react';
import type { LibraryState, Skill } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import {
  BackIcon,
  ChecksIcon,
  DocumentsIcon,
  FolderIcon,
  SaveIcon,
  SparklesIcon,
  TrashIcon,
} from '../ui/icons.js';
import { OpenIcon } from '../diff/OpenIcon.js';
import { checkParts, isSkillEdited, skillChecks, skillGitNote, skillSize } from './skills.js';
import { tip } from '../ui/tip.js';
import { skillPlace, folderOf } from './library.js';
import { PaneHead } from './PaneHead.js';
import { SkillText } from './SkillText.js';

/** What the page says after a change, under the skill (or the form) it was made from. */
export interface Notice {
  at: string;
  text: string;
  error?: boolean;
  /** The file changed since it was read (409): read it again, the drafts kept. */
  stale?: boolean;
}

/** Who reads a skill, in words. */
const readers = (skill: Skill) =>
  skill.agents.map((a) => (a === 'claude' ? 'Claude Code' : 'Codex')).join(' and ');

/**
 * One skill (V64): a card — its icon, name and chip, Open in VS Code, where it is, its `SKILL.md`
 * as tall as the card (`SkillText`), then its size and the actions — and its checks and other files
 * in cards beside it (under it on a narrower area, decision 462).
 */
export function SkillEditor({
  skill,
  library,
  draft,
  busy,
  notice,
  expanded,
  onDraft,
  onDiscard,
  onSave,
  onDelete,
  onImprove,
  onOpen,
  onExpand,
  onLoad,
  onBack,
}: {
  skill: Skill;
  /** The skill library (SK1): where a skill of it is. */
  library: LibraryState | undefined;
  draft: string | undefined;
  busy: boolean;
  notice: Notice | null;
  expanded: boolean;
  onDraft: (text: string) => void;
  onDiscard: () => void;
  onSave: (text: string) => void;
  onDelete: () => void;
  onImprove: () => void;
  /** Open in VS Code at `line`; `unsaved`: the text here differs from the file. */
  onOpen: (line: number, unsaved: boolean) => void;
  onExpand: (expanded: boolean) => void;
  onLoad: () => void;
  onBack: () => void;
}) {
  const text = draft ?? skill.text ?? '';
  const edited = isSkillEdited(skill, draft);
  const checks = useMemo(() => skillChecks(skill, text), [skill, text]);
  const [deleting, setDeleting] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const canSave = edited && !busy && !skill.tooLarge;
  const inLibrary = skill.folder === 'library';
  /** The caret's line, 1 when the text is not shown. */
  const caretLine = () => {
    const at = area.current?.selectionStart ?? 0;
    return text.slice(0, at).split(/\r\n|\r|\n/).length;
  };

  return (
    <section className="skills-editor" aria-label={`Skill: ${skill.name}`}>
      <div className="skills-skill">
        <div className="skills-pane skills-card">
          <button type="button" className="button ghost skills-back" onClick={onBack}>
            <BackIcon /> All skills
          </button>
          <PaneHead
            icon={<DocumentsIcon />}
            title={
              <>
                {skill.name}
                {skill.git !== 'none' && (
                  <span
                    className={`skills-state${skill.git === 'new' ? ' added' : skill.git === 'committed' ? '' : ' changed'}`}
                  >
                    {skill.git === 'new'
                      ? 'New'
                      : skill.git === 'changed'
                        ? 'Changed'
                        : 'Committed'}
                  </span>
                )}
              </>
            }
            actions={
              <button
                type="button"
                className="button secondary"
                {...tip(
                  inLibrary
                    ? `Open it in VS Code, in a window on ${library?.folder ?? 'the library'}`
                    : 'Open it in VS Code, at the caret’s line',
                )}
                onClick={() => onOpen(skill.tooLarge ? 1 : caretLine(), edited)}
              >
                <OpenIcon /> Open in VS Code
              </button>
            }
          >
            <code>{skillPlace(skill, library)}</code> ·{' '}
            {inLibrary
              ? `in your skill library · ${library?.git ? skillGitNote(skill.git) : 'A plain folder: no git.'}`
              : `read by ${readers(skill)} · ${skillGitNote(skill.git)}`}
          </PaneHead>
          {skill.tooLarge ? (
            <p className="skills-warning" role="alert">
              Its SKILL.md is too large to edit here (over 256 KB): open it in an editor.
            </p>
          ) : (
            <SkillText
              name={skill.name}
              text={text}
              area={area}
              expanded={expanded}
              onText={onDraft}
              onSave={() => canSave && onSave(text)}
              onExpand={onExpand}
            />
          )}
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
                  className="button danger"
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
                className="button secondary skills-delete"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                <TrashIcon /> Delete…
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              {...tip('Ask Scribe to change this skill')}
              onClick={onImprove}
            >
              <SparklesIcon /> Improve with Scribe
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
              <SaveIcon /> Save
            </button>
          </div>
        </div>
        <div className="skills-side">
          {!skill.tooLarge && (
            <section className="skills-side-card skills-checks-card" aria-label="Checks">
              <div className="skills-side-head">
                <ChecksIcon />
                <h3>Checks</h3>
                <Help label="About the checks">
                  The checks are the open standard&apos;s (agentskills.io) and what Claude Code,
                  Codex and Anthropic&apos;s API refuse or cut. Whether it says the right thing is
                  yours to read.
                </Help>
              </div>
              {checks.length > 0 ? (
                <ul className="skills-checks">
                  {checks.map((check) => {
                    const [lead, rest] = checkParts(check.text);
                    return (
                      <li key={check.text} className={check.level}>
                        <strong>{lead}</strong>
                        {rest && ` ${rest}`}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="skills-checks-none">
                  Nothing the standard or the agents would refuse.
                </p>
              )}
            </section>
          )}
          {skill.files.length > 0 && (
            <section className="skills-side-card" aria-label="Its other files">
              <div className="skills-side-head">
                <FolderIcon />
                <h3>Its other files</h3>
              </div>
              <ul className="skills-files">
                {skill.files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
                {skill.moreFiles && <li className="hint">and more</li>}
              </ul>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
