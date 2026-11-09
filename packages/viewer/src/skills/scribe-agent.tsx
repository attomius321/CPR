// Scribe (V41b) as its pane on the Skills page shows it.
import type { ConversationAgent } from '../nucleus/Conversation.js';

/**
 * Scribe (V41b) as its conversation shows it; `typed` put in its terminal by Improve with Scribe
 * (V78), then `onTyped`.
 */
export const scribeAgent = (
  state: ConversationAgent['state'],
  typed: string | undefined,
  onTyped: () => void,
): ConversationAgent => ({
  name: 'Scribe',
  api: '/api/scribe',
  state,
  className: 'scribe-pane',
  heading: 'h2',
  doing: 'Writes skills in .claude/skills of',
  help: (
    <>
      <p>
        Scribe writes a new skill, or changes one, in .claude/skills, from what you ask. It reads
        this checkout&apos;s files and git&apos;s history, and writes nothing else.
      </p>
      <p>
        Ask in its terminal. Claude Code asks you before each write into .claude, there too. Scribe
        never commits: read the skill here, change it, and commit it.
      </p>
      <p>
        Settings sets the model and effort each conversation starts on: a running one keeps its own,
        and New conversation starts the next on Settings&apos;.
      </p>
    </>
  ),
  ...(typed === undefined ? {} : { typed }),
  onTyped,
});
