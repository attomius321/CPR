import { useEffect, useState } from 'react';
import type { McpAsk, McpAsks } from '@symbiote/core';
import { postJson } from '../ui/http.js';
import { reloadWorkspaces } from '../workspaces/useWorkspaces.js';

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

const ids = (asks: readonly McpAsk[]) => asks.map((ask) => ask.id).join(' ');

function set(next: McpAsk[]): void {
  if (ids(next) === ids(current)) return;
  current = next;
  for (const listener of listeners) listener(current);
}

async function readAsks(): Promise<void> {
  try {
    const response = await fetch('/api/mcp/asks');
    if (response.status === 404) none = true;
    if (response.ok) set(((await response.json()) as McpAsks).asks);
  } catch {
    // The server is away for a moment: the next read tries again.
  }
}

function schedule(): void {
  clearTimeout(timer);
  if (listeners.size === 0 || none) return;
  timer = setTimeout(() => {
    void (document.visibilityState === 'hidden' ? Promise.resolve() : readAsks()).then(schedule);
  }, ASKS_MS);
}

/** The asks waiting for the person, oldest first: read on mount and every 2 s while shown. */
export function useAsks(): McpAsk[] {
  const [asks, setAsks] = useState(current);
  useEffect(() => {
    listeners.add(setAsks);
    if (listeners.size === 1) void readAsks().then(schedule);
    return () => {
      listeners.delete(setAsks);
      if (listeners.size === 0) clearTimeout(timer);
    };
  }, []);
  return asks;
}

/**
 * The person's answer to an ask: what the agent asked is done (yes) or not. Answered once it is
 * done: the workspaces, reviews and merges are read again then, as after a page's own action.
 */
export async function answerAsk(id: string, yes: boolean): Promise<void> {
  set((await postJson<McpAsks>('/api/mcp/answer', { id, yes })).asks);
  if (yes) await reloadWorkspaces();
}
