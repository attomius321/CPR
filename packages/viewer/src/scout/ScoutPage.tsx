import { Help } from '../ui/Help.js';
import { PageHead } from '../ui/PageHead.js';
import { ScoutIcon } from '../ui/icons.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import {
  folderName,
  PageAgentActions,
  PageAgentBody,
  PageAgentError,
  usePageAgent,
} from './Conversation.js';
import { tip } from '../ui/tip.js';

const API = '/api/scout';

/**
 * Scout (V35): an agent in the checkout; since MC1 it carries workspaces from a start to a merge
 * through Symbiote's tools, asking the person to confirm what changes a branch's fate. Since V50
 * the page is its terminal: opened with no question, which the terminal takes. Since V77 nothing
 * on the page picks its agent, model or level (decision 561): Settings does, and its head says
 * what the conversation runs on; New conversation starts the next on Settings'.
 */
export function ScoutPage() {
  const { scout: read } = useWorkspaces();
  const agent = usePageAgent(API, read);
  return (
    <section className="scout-page" aria-labelledby="scout-title">
      {/* The page frame's head (V72): what it reads and runs on its line; its state and New
          conversation at the right. */}
      <PageHead
        className="scout-head"
        icon={<ScoutIcon />}
        title="Scout"
        titleId="scout-title"
        beside={
          <Help label="About Scout">
            <p>
              Where something is decided, why it works this way, what touches it; and your
              workspaces from a start to a merge: what waits for you, a plan to answer, a
              branch&apos;s review, its merge. Scout reads this checkout&apos;s files and history
              and changes no file; it acts through Symbiote, and asks you to confirm a start, a
              verdict, a merge or a clean-up first.
            </p>
            <p>
              Ask in its terminal. Settings sets the model and effort each conversation starts on: a
              running one keeps its own, and New conversation starts the next on Settings&apos;.
            </p>
          </Help>
        }
        line={
          read ? (
            <span className="scout-about" {...tip(read.checkout, { code: true })}>
              In {folderName(read.checkout)}
              {agent.on ? `, ${agent.on}` : ''}
            </span>
          ) : undefined
        }
        actions={agent.conversation ? <PageAgentActions agent={agent} /> : undefined}
      />
      <PageAgentError agent={agent} />
      {/* The page's card (V61), in the page frame since V72: the terminal. */}
      <div className="scout-card">
        <PageAgentBody name="Scout" api={API} agent={agent} />
      </div>
    </section>
  );
}
