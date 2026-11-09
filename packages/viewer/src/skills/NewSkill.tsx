// The Skills page's form for a new skill (V41a): its name, its description, where it goes.
import { useState } from 'react';
import { Help } from '../ui/Help.js';
import { BackIcon, PlusIcon } from '../ui/icons.js';
import { newSkillProblem } from './skills.js';
import { tip } from '../ui/tip.js';
import { PaneHead } from './PaneHead.js';
import type { Notice } from './SkillEditor.js';

/**
 * A new skill: its name and description, written as its frontmatter in `.claude/skills/`, or in the
 * skill library's folder (SK1) when one is set and the person picks it.
 */
export function NewSkill({
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
      <PaneHead icon={<PlusIcon />} title="New skill">
        Its name and description here, its instructions in the editor next; or{' '}
        <button type="button" className="link" onClick={onScribe}>
          ask Scribe to write it
        </button>
        .
      </PaneHead>
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
