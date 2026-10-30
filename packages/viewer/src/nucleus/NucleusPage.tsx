import { useState } from 'react';
import { Help } from '../ui/Help.js';
import { PageHead } from '../ui/PageHead.js';
import { NucleusIcon } from '../ui/icons.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import {
  folderName,
  PageAgentActions,
  PageAgentBody,
  PageAgentError,
  usePageAgent,
} from './Conversation.js';
import { tip } from '../ui/tip.js';
import { formerText } from './page-agent.js';
import { NucleusActivity } from './NucleusActivity.js';

/** Nucleus's two views (NU2): its terminal, and what it did. */
type View = 'terminal' | 'activity';

/** `?activity` opens the Activity tab (NU2), as a workspace's does. */
const viewOfUrl = (): View =>
  new URLSearchParams(window.location.search).has('activity') ? 'activity' : 'terminal';

const API = '/api/nucleus';

/**
 * Nucleus (V35; Scout until NU1): an agent in the checkout; since MC1 it carries workspaces from a
 * start to a merge through Symbiote's tools, asking the person to confirm what changes a branch's
 * fate; since NU1 it searches the web and reads pages. A conversation Scout started is read as
 * Nucleus's, without the web, and the page says so until New conversation (decision 591). Since V50
 * the page is its terminal: opened with no question, which the terminal takes. Since V78 nothing
 * on the page picks its agent, model or level (decision 569): Settings does, and its head says
 * what the conversation runs on; New conversation starts the next on Settings'.
 */
export function NucleusPage() {
  const { nucleus: read } = useWorkspaces();
  const [view, setView] = useState<View>(viewOfUrl);
  const show = (next: View) => {
    setView(next);
    const url = new URL(window.location.href);
    url.search = next === 'activity' ? '?activity' : '';
    window.history.replaceState(window.history.state, '', url);
  };
  const agent = usePageAgent(API, read);
  const former = formerText(read?.conversation ?? null, 'Nucleus');
  return (
    <section className="nucleus-page" aria-labelledby="nucleus-title">
      {/* The page frame's head (V72): what it reads and runs on its line; its state and New
          conversation at the right. */}
      <PageHead
        className="nucleus-head"
        icon={<NucleusIcon />}
        title="Nucleus"
        titleId="nucleus-title"
        beside={
          <Help label="About Nucleus">
            <p>
              Where something is decided, why it works this way, what touches it; and your
              workspaces from a start to a merge: what waits for you, a plan to answer, a
              branch&apos;s review, its merge. Nucleus reads this checkout&apos;s files and history,
              searches the web and reads pages, and changes no file; it acts through Symbiote, and
              asks you to confirm a start, a verdict, a merge or a clean-up first.
            </p>
            <p>
              Ask in its terminal. Settings sets the model and effort each conversation starts on: a
              running one keeps its own, and New conversation starts the next on Settings&apos;.
            </p>
          </Help>
        }
        line={
          read ? (
            <span className="page-agent-about" {...tip(read.checkout, { code: true })}>
              In {folderName(read.checkout)}
              {agent.on ? `, ${agent.on}` : ''}
            </span>
          ) : undefined
        }
        actions={agent.conversation ? <PageAgentActions agent={agent} /> : undefined}
      />
      <PageAgentError agent={agent} />
      {former && (
        <p className="nucleus-former" role="note">
          {former}
        </p>
      )}
      {/* The page's card (V61), in the page frame since V72: its terminal, and since NU2 what it
          did, as line tabs on the card's head as a workspace's are. */}
      <div className="nucleus-card">
        <div className="workspace-views" role="tablist" aria-label="Nucleus">
          {(['terminal', 'activity'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={view === name}
              className={view === name ? 'selected' : ''}
              onClick={() => show(name)}
            >
              {name === 'terminal' ? 'Terminal' : 'Activity'}
            </button>
          ))}
        </div>
        {view === 'activity' ? (
          <div className="workspace-activity">
            <NucleusActivity read={read} />
          </div>
        ) : (
          <PageAgentBody name="Nucleus" api={API} agent={agent} />
        )}
      </div>
    </section>
  );
}
