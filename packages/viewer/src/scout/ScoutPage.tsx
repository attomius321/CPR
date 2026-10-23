import { Conversation } from './Conversation.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';

/**
 * Scout (V35): a read-only agent in the checkout, asked from here. With no conversation, the
 * question box; with one, the agent's own terminal, where its answer is and the person asks more
 * (the box where no terminal runs). New conversation starts over.
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
        doing: 'Read-only in',
        label: 'Ask Scout',
        help: (
          <>
            <p>
              Where something is decided, why it works this way, what touches it. Scout reads the
              files and git&apos;s history of this checkout and changes nothing; work it finds goes
              through a workspace.
            </p>
            <p>
              <kbd>Enter</kbd> asks; <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line.
            </p>
          </>
        ),
        placeholder: "Where is the merger's prompt defined?",
        submit: 'Ask',
        noun: 'question',
        effortHelp: 'The level this conversation starts at; Settings sets the one each starts at.',
      }}
    />
  );
}
