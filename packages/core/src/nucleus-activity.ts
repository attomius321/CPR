// What Nucleus did (NU2, decisions 604–608): one line a recorded event in
// `symbiote/nucleus-activity.jsonl`, kept across conversations, from its agent's hooks (Claude
// Code), its thread as Symbiote reads it (Codex) and Symbiote itself (its tools, the person's
// Confirms, a conversation opened or ended). Types only; the CLI writes and reads the file and
// serves `GET /api/nucleus/activity`.
import type { ActivityEntry, AgentKind } from './workspaces.js';

/** The tokens a turn used, as its agent reported them. */
export interface TurnTokens {
  /** Input not read from the cache. */
  input: number;
  /** Input read from the cache. */
  cached?: number;
  /** Input written to the cache (Claude Code). */
  cacheWrite?: number;
  output: number;
  /** Of `output`, the model's reasoning. */
  reasoning?: number;
}

/** What Nucleus's gate said of a call (Claude Code): allowed, refused, or left to its agent. */
export interface GateRecord {
  decision: 'allow' | 'deny' | 'agent';
  /** Why: a refusal's words, an allow's when it is not git's read. */
  reason?: string;
}

/** A page Nucleus read, or a search's result. */
export interface WebPage {
  url: string;
  title?: string;
  /** The HTTP status it answered (WebFetch). */
  code?: number;
  bytes?: number;
}

/** Who and where a line was recorded for: the conversation (Claude Code's session, Codex's thread). */
interface Of {
  at: string;
  conversation?: string;
  agent?: AgentKind;
  /** Codex's turn it belongs to. */
  turn?: string;
}

/** A tool call's start or end (V73's fields), with what NU2 keeps besides. */
export interface NucleusCall extends ActivityEntry, Omit<Of, 'at' | 'turn'> {
  /** Symbiote's own record of one of its tools' calls (`mcp.ts`), beside its agent's. */
  source?: 'symbiote';
  /** A start: the gate's decision (Claude Code). */
  gate?: GateRecord;
  /** An end: the pages read (WebFetch's, Codex's opened). */
  pages?: WebPage[];
  /** An end: a search's results. */
  links?: WebPage[];
  /** An end: refused by its agent's own rules (Claude Code's `PermissionDenied`), and why. */
  refused?: string;
}

/** A Confirm Symbiote asked the person for one of Nucleus's calls (decision 361), and its end. */
export type ConfirmStage =
  | { stage: 'asked'; until: string }
  | { stage: 'ended'; answer: 'confirmed' | 'declined' | 'expired' | 'gone'; ms: number };

/** Anything else that happened in a conversation. */
export type NucleusEntry = Of &
  (
    | { kind: 'prompt'; text: string }
    | { kind: 'report'; text: string; tokens?: TurnTokens; ms?: number }
    /** A session's start: `startup`, `resume`, `clear`, `compact` (Claude Code's `source`). */
    | { kind: 'start'; source: string; model?: string }
    | { kind: 'end'; reason?: string }
    /** Its context compacted: before (`PreCompact`) and after, with its summary. */
    | { kind: 'compact'; stage: 'before' | 'after'; trigger?: string; summary?: string }
    | { kind: 'error'; error: string; details?: string }
    | { kind: 'notice'; type: string; message?: string }
    /** A turn stopped by the person. */
    | { kind: 'interrupted' }
    /** Symbiote opened a conversation: its agent, model and effort. */
    | { kind: 'opened'; model?: string; effort?: string }
    /** New conversation ended this one. */
    | { kind: 'renewed' }
    /** A Confirm: asked, then how it ended; `call` is Symbiote's call that asked. */
    | ({ kind: 'confirm'; ask: string; tool: string; words: string; call?: string } & ConfirmStage)
  );

export type NucleusActivityLine = NucleusEntry | NucleusCall;

/** `GET /api/nucleus/activity`: the newest megabyte of lines, oldest first; `cut` when older ones were left out. */
export interface NucleusActivity {
  lines: NucleusActivityLine[];
  cut: boolean;
}
