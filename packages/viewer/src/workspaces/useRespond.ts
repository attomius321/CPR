// Answering a workspace's agent (V48, V92): its terminal shown and focused, or the Thread's box; asked
// for from the sidenav or the Overview too (`RESPOND_EVENT`).
import { useEffect, useRef } from 'react';
import type { OpenedTerminal } from './AgentTerminal.js';
import type { AgentView, View } from './WorkspaceTabs.js';
import { RESPOND_EVENT } from './respond.js';

/** The person's answer and a message to the writer, and the respond event of this workspace. */
export function useRespond({
  branch,
  terminals,
  view,
  show,
  opened,
}: {
  branch: string;
  /** Its agent's session opens in a terminal here. */
  terminals: boolean;
  view: View;
  show: (next: AgentView) => void;
  opened: OpenedTerminal | null;
}) {
  /**
   * Takes the person's answer (V48): its terminal shown and focused where one runs, else the
   * thread and its box. A terminal not open yet focuses itself as it opens.
   */
  const respond = () => {
    if (terminals) {
      if (view !== 'terminal') show('terminal');
      opened?.focus();
      return;
    }
    if (view !== 'thread') show('thread');
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('.workspace .reply textarea')?.focus(),
    );
  };
  /** Message the writer (V92, decision 865): the Thread's box, the one way to send it one. */
  const message = () => {
    show('thread');
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('.workspace .reply textarea')?.focus(),
    );
  };
  const respondNow = useRef(respond);
  respondNow.current = respond;
  useEffect(() => {
    const onRespond = (event: Event) => {
      if ((event as CustomEvent<string>).detail === branch) respondNow.current();
    };
    window.addEventListener(RESPOND_EVENT, onRespond);
    return () => window.removeEventListener(RESPOND_EVENT, onRespond);
  }, [branch]);
  return { respond, message };
}
