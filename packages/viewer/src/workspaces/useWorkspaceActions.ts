// What a workspace's page does (V18c, V48, V57; decisions 114, 834): an action with its words in the
// head, the reply sent (or typed into the terminal), the clean up, VS Code, the review's verdict.
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceReplied } from '@symbiote/core';
import { toTerminal, type OpenedTerminal } from './AgentTerminal.js';
import type { AgentView, View } from './WorkspaceTabs.js';
import { cleanUp } from './cleanup.js';
import { postJson } from '../ui/http.js';
import { replyMode, verdictToSend } from './thread-items.js';
import type { Notice } from '../shell/shell-context.js';
import { verdictLine } from './terminal.js';
import { reloadWorkspaces } from './useWorkspaces.js';

import type { Dispatch, SetStateAction } from 'react';

/** The page's actions; the verdict filled from the Review tab, and a reply typed into the terminal. */
export function useWorkspaceActions({
  branch,
  terminals,
  opened,
  showTerminal,
  fillVerdict,
  verdict,
  text,
  setText,
  setSaid,
  setActing,
  reloadThread,
  busy,
  planWaits,
  view,
  show,
  mode,
  setConfirming,
  onNotice,
  onGone,
}: {
  branch: string;
  terminals: boolean;
  opened: OpenedTerminal | null;
  showTerminal: boolean;
  /** Fill the box with the review's verdict once it is read (`?send=verdict`). */
  fillVerdict: boolean;
  verdict: ReturnType<typeof verdictToSend>;
  /** The reply box's text. */
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  setSaid: Dispatch<SetStateAction<string | null>>;
  setActing: Dispatch<SetStateAction<boolean>>;
  reloadThread: () => void;
  busy: boolean;
  /** A plan waits for the person's OK (decision 833). */
  planWaits: boolean;
  view: View;
  show: (next: AgentView) => void;
  mode: ReturnType<typeof replyMode>;
  setConfirming: Dispatch<SetStateAction<'send' | 'clean' | null>>;
  onNotice: (notice: Notice | null) => void;
  onGone: () => void;
}) {
  const filled = useRef(false);
  // A text to type into the agent's terminal and send (decision 834), once it is open.
  const [typing, setTyping] = useState<string | null>(null);
  /**
   * Types the verdict's line into the open terminal, without Enter (decision 114); noted first,
   * so the prompt it becomes reads as the verdict (AR2, decision 741). A note that fails leaves
   * the prompt the person's: the verdict is typed all the same.
   */
  const typeVerdict = (into: OpenedTerminal, text: string) => {
    const line = verdictLine(text);
    return postJson('/api/workspaces/sent', { branch, by: 'verdict', text: line })
      .catch(() => undefined)
      .then(() => toTerminal(into.id, 'in', { data: line }))
      .then(
        () => into.focus(),
        (e: unknown) => setSaid((e as Error).message),
      );
  };

  // From the Review tab (`?send=verdict`): the verdict in the box, or typed into the terminal.
  useEffect(() => {
    if (!fillVerdict || filled.current || !verdict) return;
    if (terminals) {
      if (!showTerminal || !opened) return;
      filled.current = true;
      void typeVerdict(opened, verdict.text);
      return;
    }
    filled.current = true;
    setText(verdict.text);
  }, [fillVerdict, verdict, terminals, showTerminal, opened]);

  // Approve plan and Send reply with a terminal (decision 834): typed into it and sent with
  // Enter once its input is drawn. One line: a line break typed would send early.
  useEffect(() => {
    if (typing === null || !opened || !showTerminal) return;
    setTyping(null);
    opened.submit(typing.replace(/\s*\n\s*/g, ' ').trim());
    setText('');
  }, [typing, opened, showTerminal]);

  /** Runs an action, says how it went in the panel; the list (and thread) are read again. */
  const act = (task: () => Promise<string | null>) => {
    setActing(true);
    task()
      .then((words) => setSaid(words))
      .catch((e: unknown) => setSaid(`${(e as Error).message}`))
      .finally(() => {
        setActing(false);
        void reloadWorkspaces();
        reloadThread();
      });
  };
  const copy = (words: string, what: string) =>
    navigator.clipboard.writeText(words).then(
      () => `Copied ${what}`,
      () => `Could not copy ${what}`,
    );

  const send = (stop: boolean, words = text) => {
    if (words.trim() === '' || busy) return;
    // With its terminal (decision 834): typed there and sent, while the plan waits.
    if (terminals && planWaits) {
      setTyping(words);
      if (view !== 'terminal') show('terminal');
      return;
    }
    if (mode === 'stop-and-send' && !stop) {
      setConfirming('send');
      return;
    }
    setConfirming(null);
    act(() =>
      postJson<WorkspaceReplied>('/api/workspaces/reply', {
        branch,
        text: words,
        ...(stop ? { stop: true } : {}),
        // The review's verdict, sent as it was filled in, is the verdict (AR2).
        ...(verdict && words === verdict.text ? { by: 'verdict' } : {}),
      }).then(
        (replied) => {
          setText('');
          return replied.copy ? `Sent, but Claude Code started a copy: ${replied.copy}` : 'Sent';
        },
        (e: unknown) => {
          // Its turn started meanwhile: ask before stopping it.
          if (/sending stops its turn/.test((e as Error).message)) setConfirming('send');
          throw e;
        },
      ),
    );
  };

  /** Not through `act`: `cleanUp` marks it while it runs, and reads the list again (V57). */
  const clean = (unmerged: boolean) => {
    setConfirming(null);
    cleanUp(branch, unmerged).then(
      (notice) => {
        onNotice(notice);
        onGone();
      },
      (e: unknown) => setSaid((e as Error).message),
    );
  };

  const openInCode = () =>
    act(() => postJson('/api/workspaces/open', { branch }).then(() => 'Opened in VS Code'));
  return { act, copy, send, clean, openInCode, typeVerdict };
}
