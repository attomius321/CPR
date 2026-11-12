// A workspace's shells (V45): read with the page's header, with every change of the list and when a
// shown shell's output stops (V94b); opened at the last terminal's size, closed (asked first while
// a program runs in one).
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceShell, WorkspaceShells } from '@symbiote/core';
import { lastTerminalSize, toTerminal } from './AgentTerminal.js';
import { pageHeaders, postJson, serverWords } from '../ui/http.js';
import { closeQuestion, withShell } from './shells.js';

import type { Dispatch, SetStateAction } from 'react';

/** A workspace's shells (V45): its terminals' IDs, so read with the page's headers and key. */
async function readShells(branch: string): Promise<WorkspaceShell[]> {
  const response = await fetch(`/api/workspaces/shells?branch=${encodeURIComponent(branch)}`, {
    headers: await pageHeaders(),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(serverWords(text));
  return (JSON.parse(text) as WorkspaceShells).shells;
}

/** The shells, kept here as the tabs show them, and how one opens, goes and closes. */
export function useShells({
  branch,
  shellsCan,
  version,
  setSaid,
}: {
  branch: string;
  /** Terminals can run here and the worktree is there. */
  shellsCan: boolean;
  /** The list as last read: the shells are read again with it. */
  version: unknown;
  setSaid: Dispatch<SetStateAction<string | null>>;
}) {
  const [shells, setShells] = useState<WorkspaceShell[] | null>(null);
  // Bumped by every change made here: a read begun before it is older than what is shown.
  const shellsChanged = useRef(0);
  // Bumped when a shown shell's output stops (V94b): what runs in it may have changed.
  const [shellsQuiet, setShellsQuiet] = useState(0);
  const [closing, setClosing] = useState<{ shell: WorkspaceShell; question: string } | null>(null);
  useEffect(() => {
    if (!shellsCan) return;
    let gone = false;
    const asked = shellsChanged.current;
    readShells(branch).then(
      (read) => !gone && asked === shellsChanged.current && setShells(read),
      (e: unknown) => {
        if (gone) return;
        // A read that fails keeps the tabs as they were; the first one shows none.
        setShells((now) => now ?? []);
        setSaid((e as Error).message);
      },
    );
    return () => {
      gone = true;
    };
  }, [branch, shellsCan, version, shellsQuiet]);
  /** Opens a shell at the size the last terminal was drawn at; it is fitted once shown. */
  const openShell = (then: (number: number) => void) =>
    postJson<WorkspaceShell>('/api/workspaces/shell', { branch, ...lastTerminalSize() }).then(
      (opened) => {
        shellsChanged.current += 1;
        setShells((now) => withShell(now ?? [], opened));
        then(opened.number);
      },
      (e: unknown) => setSaid((e as Error).message),
    );
  /** A shell closed or exited: its tab goes. Twice is once: a close is followed by its exit. */
  const forgetShell = (id: string) => {
    shellsChanged.current += 1;
    setShells((now) => now?.filter((shell) => shell.id !== id) ?? now);
  };
  /** Closes a shell; with a program running in it, asked first (decision 298). */
  const closeShell = async (shell: WorkspaceShell, asked = false) => {
    if (!asked) {
      const read = await readShells(branch).catch(() => null);
      const now = read?.find((other) => other.id === shell.id) ?? shell;
      const question = closeQuestion(now);
      if (question) {
        setClosing({ shell: now, question });
        return;
      }
    }
    setClosing(null);
    // Already gone (it exited meanwhile): closed all the same.
    await toTerminal(shell.id, 'close', {}).catch(() => {});
    forgetShell(shell.id);
  };
  return { shells, setShellsQuiet, closing, setClosing, openShell, forgetShell, closeShell };
}
