// A workspace's Thread tab (V18c): what its agent was told and reported, and the person's messages.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorkspaceThread } from '@symbiote/core';
import { markdownNodes, useMarkdown } from '../ui/markdown.js';
import { threadItems } from './workspaces.js';
import { tip } from '../ui/tip.js';

/**
 * A workspace's thread (V18c), read when it is picked and with every read of the list (on focus,
 * every 5 s while an agent works or waits).
 */
export function useThread(branch: string, version: unknown): [WorkspaceThread | null, () => void] {
  const [thread, setThread] = useState<WorkspaceThread | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`/api/workspaces/thread?branch=${encodeURIComponent(branch)}`)
      .then((response) => (response.ok ? (response.json() as Promise<WorkspaceThread>) : null))
      .then((read) => live && setThread(read))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [branch, version, asked]);
  return [thread, useCallback(() => setAsked((n) => n + 1), [])];
}

const timeOf = (at: string) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * What the agent was told and reported, newest last; what it waits on as a line. It opens at its
 * end and follows new entries; a read with nothing new leaves it where the person scrolled. The
 * agent's reports are drawn as Markdown (plain text until the lexer is loaded); the person's
 * messages and Symbiote's prompt as written.
 */
export function ThreadTab({
  thread,
  worktree,
  unrecorded = "Symbiote keeps an agent's messages from V18c on: Talk shows this one's.",
}: {
  thread: WorkspaceThread | null;
  worktree: string;
  /** What is said when Symbiote kept none of its messages (History's own words, V77). */
  unrecorded?: string;
}) {
  const list = useRef<HTMLOListElement>(null);
  const items = thread ? threadItems(thread.entries, worktree) : [];
  const lexer = useMarkdown();
  useLayoutEffect(() => {
    const box = list.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [items.length, lexer]);
  if (!thread) return <p className="hint">Reading its messages…</p>;
  return (
    <>
      {!thread.recorded && <p className="hint">{unrecorded}</p>}
      {thread.recorded && items.length === 0 && (
        <p className="hint">Nothing yet: the agent's reports and your messages show here.</p>
      )}
      {items.length > 0 && (
        <ol ref={list} className="thread">
          {items.map((item, i) => {
            const key = `${i}:${item.at}`;
            if (item.who === 'line' || item.who === 'waits') {
              return (
                <li key={key} className={`thread-${item.who}`} {...tip(timeOf(item.at))}>
                  {item.text}
                </li>
              );
            }
            if (item.who === 'symbiote') {
              return (
                <li key={key} className="thread-item thread-symbiote">
                  <details>
                    <summary>
                      Symbiote's prompt · <time dateTime={item.at}>{timeOf(item.at)}</time>
                    </summary>
                    <div className="thread-text">{item.text}</div>
                  </details>
                </li>
              );
            }
            return (
              <li key={key} className={`thread-item thread-${item.who}`}>
                <div className="thread-who">
                  {item.who === 'agent' ? 'Agent' : 'You'} ·{' '}
                  <time dateTime={item.at}>{timeOf(item.at)}</time>
                </div>
                {item.who === 'agent' && lexer ? (
                  <div className="thread-text markdown">{markdownNodes(lexer(item.text))}</div>
                ) : (
                  <div className="thread-text">{item.text}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
