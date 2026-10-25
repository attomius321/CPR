import { Conversation } from './Conversation.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';

/**
 * Scout (V35): an agent in the checkout, asked from here; since MC1 it carries workspaces from a
 * start to a merge through Symbiote's tools, asking the person to confirm what changes a branch's
 * fate. With no conversation, the question box; with one, the agent's own terminal, where its
 * answer is and the person asks more (the box where no terminal runs). New conversation starts
 * over.
 */
export function ScoutPage() {
  const { scout } = useWorkspaces();
  return (
    <Conversation
      agent={{
        name: 'Scout',
        api: '/api/scout',
        state: scout,
        className: 'scout-page',
        heading: 'h1',
        doing: 'In',
        label: 'Ask Scout',
        help: (
          <>
            <p>
              Where something is decided, why it works this way, what touches it; and your
              workspaces from a start to a merge: what waits for you, a plan to answer, a branch's
              review, its merge. Scout reads this checkout&apos;s files and history and changes no
              file; it acts through Symbiote, and asks you to confirm a start, a verdict, a merge or
              a clean-up first.
            </p>
            <p>
              <kbd>Enter</kbd> asks; <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line.
            </p>
          </>
        ),
        placeholder: 'What waits for me? Start a fix for the discount, plan first.',
        submit: 'Ask',
        noun: 'question',
        effortHelp: 'The level this conversation starts at; Settings sets the one each starts at.',
      }}
    />
  );
}
