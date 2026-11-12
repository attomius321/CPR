import { useEffect, useState } from 'react';
import type { McpAsk, McpAsks } from '@symbiote/core';
import { pageHeaders, postJson } from '../ui/http.js';
import { readsHidden, reloadWorkspaces } from '../workspaces/useWorkspaces.js';
import { pushed, type Parts, type Status } from './events.js';

/**
 * How often the asks of Symbiote's MCP are read while a page shows (MC1): an agent may ask at any
 * moment, while nothing else Symbiote reads is working (an agent of the person's through
 * `symbiote mcp`), so they are read on their own, not with the workspaces.
 */
const ASKS_MS = 2_000;

// One reader for every component on the page.
let current: McpAsk[] = [];
const listeners = new Set<(asks: McpAsk[]) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
/** No MCP here (`symbiote pr`): read once, then never again. */
let none = false;

/** What the asks say: a batch's rows change state while it is done (MC3), not only which asks. */
const said = (asks: readonly McpAsk[]) => JSON.stringify(asks);

function set(next: McpAsk[]): void {
  if (said(next) === said(current)) return;
  current = next;
  for (const listener of listeners) listener(current);
}

async function readAsks(): Promise<void> {
  try {
    // The page's alone (SC1): the Confirm's asks are read with its key.
    const response = await fetch('/api/mcp/asks', { headers: await pageHeaders() });
    if (response.status === 404) none = true;
    if (response.ok) set(((await response.json()) as McpAsks).asks);
  } catch {
    // The server is away for a moment: the next read tries again.
  }
}

function schedule(): void {
  clearTimeout(timer);
  // Pushed (V94a): nothing to read.
  if (listeners.size === 0 || none || pushed().status() !== 'unavailable') return;
  timer = setTimeout(() => {
    const hidden = document.visibilityState === 'hidden' && !readsHidden();
    void (hidden ? Promise.resolve() : readAsks()).then(schedule);
  }, ASKS_MS);
}

/**
 * The asks read when the stream says they changed (V94a; SC1: it says no more, the asks are read
 * with the page's key); with no stream, read as before.
 */
function onPushed(changed: Parts, status: Status): void {
  if (status === 'unavailable') void readAsks().then(schedule);
  else if (changed.asks) void readAsks();
}
let unsubscribe: (() => void) | null = null;

/**
 * The asks waiting for the person, oldest first, as `symbiote view` pushes them (V94a). Without
 * its stream, read on mount and every 2 s while shown; in the app, hidden too (N2).
 */
export function useAsks(): McpAsk[] {
  const [asks, setAsks] = useState(current);
  useEffect(() => {
    listeners.add(setAsks);
    if (listeners.size === 1) unsubscribe = pushed().subscribe(onPushed);
    return () => {
      listeners.delete(setAsks);
      if (listeners.size > 0) return;
      unsubscribe?.();
      unsubscribe = null;
      clearTimeout(timer);
    };
  }, []);
  return asks;
}

/**
 * The person's answer to an ask: what the agent asked is done (yes) or not; a batch's ticked
 * items (MC3). Answered once it is done: the workspaces, reviews and merges are read again then,
 * as after a page's own action.
 */
export async function answerAsk(id: string, yes: boolean, items?: string[]): Promise<void> {
  set((await postJson<McpAsks>('/api/mcp/answer', { id, yes, ...(items ? { items } : {}) })).asks);
  if (yes) await reloadWorkspaces();
}
