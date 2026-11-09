// What `symbiote view`'s server is given, and what its routes share (decision 962): the options,
// the graphs' sites, the sets of writes and streams running. Its routes take a `Pick<>` of
// `ServerContext`, never the whole (decision 963).
import type { ServerResponse } from 'node:http';
import type {
  BranchReviewInfo,
  CheckoutResult,
  BranchMerge,
  ChangedBlob,
  ChangedFile,
  FinishResult,
  LocalReview,
  CheckoutTarget,
  Graph,
  LineCount,
  RefList,
  RepoStatus,
  ReviewFile,
} from '@symbiote/core';
import type { Review } from '@symbiote/forge';
import type { Log } from '@symbiote/log';
import type { CodeMap } from '@symbiote/monitor';
import type { Diffs, Pair } from './diffs.js';
import type { Side } from './server-requests.js';
import type { OpenRequest, OpenResult } from './editor.js';
import type { Workspaces } from './workspaces.js';
import type { StateStore } from './state.js';
import type { WorkspaceDayService } from './workspace-day.js';
import type { Merger } from './merges.js';
import type { PromptSettingsService } from './prompts.js';
import type { CheckSettingService } from './check-setting.js';
import type { UsageService } from './usage.js';
import type { IntroRecord } from './intro.js';
import type { HiveRecord } from './hive.js';
import type { ReviewerSettings } from './hive-review.js';
import type { HiveLandingService } from './hive-request.js';
import type { HivePacingService } from './hive-pacing.js';
import type { HiveWorkspace } from './hive-workspace.js';
import type { Histories } from './history.js';
import type { GitPage } from './git-page.js';
import type { BranchReviews } from './reviews.js';
import type { Terminals } from './terminal.js';
import type { PageAgent } from './page-agent.js';
import type { SkillsService } from './skills.js';
import type { SymbioteMcp } from './mcp.js';
import type { IssuesService } from './issues.js';

/** Posts reviews to the change request being viewed (`symbiote pr` only). */
export interface ReviewTarget {
  forge: 'github' | 'gitlab';
  submit(review: Review): Promise<{ url: string }>;
}

/** A change's files read from git (V60), for the Files page: their lines, and one file's diff. */
export interface ChangeFiles {
  /** Lines added and removed per file from `from` to `to`, renames detected. */
  lines(from: string, to: string): Promise<LineCount[]>;
  /** The files that differ from `from` to `to`, each with its blob (V90). */
  blobs(from: string, to: string): Promise<ChangedBlob[]>;
  /** One file's diff from `from` to `to`, the whole file as context. */
  diff(from: string, to: string, file: ChangedFile): Promise<string>;
}

/** `symbiote view`: the repository's commits, and the diffs between them picked in the viewer. */
export interface RepositoryOptions {
  /** The repository's folder name, shown at the top of the viewer's sidenav (V29a). */
  name?: string;
  /** The commits page's history: rows and their details, its shape (`GET /api/history…`). */
  history: Histories;
  /** HEAD, the history's version, local changes and an operation in progress. */
  status(): Promise<RepoStatus>;
  /** Branches, remote branches and tags (`GET /api/refs`). */
  refs(): Promise<RefList>;
  /** Checks out a branch, remote branch, tag or commit (`POST /api/checkout`). */
  checkout(target: CheckoutTarget): Promise<CheckoutResult>;
  /** Whether a full SHA is a commit of the repository (`POST /api/diffs`). */
  isCommit(sha: string): Promise<boolean>;
  /** Analyzed and asked for, each served under `/diff/<base>..<head>/`. */
  diffs: Diffs;
  /** A repo-relative file at a commit. */
  readFile(sha: string, path: string): Promise<string>;
  /** Each diff's files with their lines, and one file's diff (V60): `./api/files`, `./api/file`. */
  files?: ChangeFiles;
  /** Git's page (V66): a commit's details, the changes, git's writes (`/api/git/…`). */
  git?: GitPage;
  /** Where a diff's review state is kept; without it the viewer keeps state in the browser. */
  state?: (graph: Graph) => StateStore;
  /** Branch reviews (V15): `/api/reviews`, and each review under `/review/<branch>/`. */
  reviews?: BranchReviews;
  /** Workspaces started from the page, each with its agent (V18): `/api/workspaces…`. */
  workspaces?: Workspaces;
  /** Terminals on agents' sessions (V21): `/api/terminals/<id>…`; closed with the server. */
  terminals?: Terminals;
  /** Symbiote's merger (V26): approved branches merged, checked and landed: `/api/merges…`. */
  merges?: Merger;
  /**
   * A Hive workspace's Review tab (HV3): its rounds, a kept test's text, Land
   * (`/api/workspaces/hive…`).
   */
  hiveWorkspace?: HiveWorkspace;
  /**
   * The Overview's read of the days (V91): `/api/workspaces/day?since=`, what Symbiote and git
   * recorded since the page's local midnight six days back.
   */
  day?: WorkspaceDayService;
  /** Every agent's prompts (V28): `/api/settings/prompts`. */
  settings?: PromptSettingsService;
  /** The check, one for the merger and Hive (fix/settings-page): `/api/settings/checks`. */
  checks?: CheckSettingService;
  /**
   * Nucleus, the person's orchestrator in the checkout (V35, NU1): `/nucleus` (`/scout`, its address
   * before NU1, too), `/api/nucleus…`.
   */
  nucleus?: PageAgent;
  /** The checkout's skills (V41): `/skills`, `/api/skills`. */
  skills?: SkillsService;
  /** Scribe, the Skills page's agent that writes skills (V41): `/api/scribe…`. */
  scribe?: PageAgent;
  /** Where the checkout's code is, by file (RM1): `/monitor`, `/api/monitor…`. */
  monitor?: { map(): Promise<CodeMap> };
  /** Origin's GitHub or GitLab issues, read only (IS1): `/issues`, `/api/issues…`. */
  issues?: IssuesService;
  /** Each subscription's windows of use (V29c): `GET /api/usage`, from a 5-min copy. */
  usage?: Pick<UsageService, 'report' | 'settled'>;
  /**
   * The folders holding records (V94a): `symbiote/` (or the cache's) and the merge queue's. A
   * record written there by this process is news for the page's stream, `/api/events`.
   */
  recordFolders?: () => Promise<string[]>;
  /** Git's common folder (V94c): its refs are watched, a commit made anywhere is news. */
  gitDir?: string;
  /** Claude Code's list read anew (V94c, decision 906), while an agent is live; null: none. */
  sessions?: () => Promise<unknown>;
  /** Codex's app server's status changes (V94c), heard while a Codex agent is live. */
  codexStatus?: (onChange: () => void) => Promise<{ stop(): void; closed: Promise<void> } | null>;
}

export interface ViewServerOptions {
  /**
   * The page's stream, `/api/events` (V94): on unless false (`SYMBIOTE_EVENTS=off`); off, the
   * pages poll as before V94.
   */
  events?: boolean;
  /** The graph served at `/` (`symbiote pr`). */
  graph?: Graph;
  /** Folder with the built viewer (index.html, assets/). */
  viewerDir: string;
  /** Reads a repo-relative file on one side of `graph`'s change. */
  readSource?: (side: Side, path: string) => Promise<string>;
  /** The files of `graph`'s change, and one file's diff (V60): `/api/files`, `/api/file`. */
  files?: ChangeFiles;
  /** Default: a free port. */
  port?: number;
  /** Enables `POST /api/review`. */
  review?: ReviewTarget;
  /** Enables `/api/state/<name>`; without it the viewer keeps state in the browser. */
  state?: StateStore;
  /** Enables the commits page at `/` and diffs under `/diff/<base>..<head>/`. */
  repository?: RepositoryOptions;
  /**
   * Enables `POST /api/open`: a file of a graph's change, opened in VS Code; in `worktree` when
   * the branch reviewed is checked out in another worktree (V18b).
   */
  open?: (request: OpenRequest, worktree?: string) => Promise<OpenResult>;
  /** Enables `/api/intro` (V39): whether a person saw the first-time intro, for every page. */
  intro?: IntroRecord;
  /** Enables `/api/hive` (V82): Hive mode, on every page from its first paint. */
  hive?: HiveRecord;
  /**
   * The check Hive would run (V92, decision 872), for `/api/hive/state`: the default checkout's
   * (`projectCheck`); null when none is set or found.
   */
  hiveCheck?: () => Promise<{ commands: string[]; source: string } | null>;
  /**
   * Enables `/api/nucleus/start-confirm` (NU8): the person's setting with which Nucleus's
   * `start_workspace` goes without a Confirm, on while `hive` is; the MCP reads it at each call.
   */
  nucleusStart?: HiveRecord;
  /**
   * Enables `/api/hive/reviewer/…` (HV3): the running reviewer's model and level, as the
   * merger's.
   */
  hiveReviewer?: ReviewerSettings;
  /** Enables `/api/hive/landing` (HV8): how Hive lands, the forge and its token. */
  hiveLanding?: HiveLandingService;
  /** Enables `/api/hive/pacing` (HV5): the usage threshold, the budget, Hive's pause now. */
  hivePacing?: HivePacingService;
  /**
   * Symbiote's logs (LG1): a line per request, and the pages' errors at `POST /api/logs`;
   * without it, nothing is written.
   */
  log?: Log;
  /** Symbiote's version, as its MCP introduces itself (MC1). */
  version?: string;
}

/** A graph served with its sources, review state and reviews. */
export interface Site {
  graph: Graph;
  allowed: Record<Side, Set<string>>;
  readSource: (side: Side, path: string) => Promise<string>;
  state?: StateStore | undefined;
  review?: ReviewTarget | undefined;
  /** A branch review's own end (V16): its verdict recorded. */
  finish?: (review: LocalReview) => Promise<FinishResult>;
  /** Whether the branch merges cleanly into the default branch (V17). */
  merge?: () => Promise<BranchMerge | null>;
  /** The worktree the branch reviewed is checked out in, when not this one (V18b). */
  worktree?: () => Promise<string | undefined>;
  /** The change's files with their lines, and one file's diff (V60). */
  files?: SiteFiles | undefined;
}

/** A site's {@link ChangeFiles}, at its graph's two commits. */
export interface SiteFiles {
  list(): Promise<ReviewFile[]>;
  diff(file: ChangedFile): Promise<string>;
}

/** What `startViewServer`'s routes share: its options, the sites it made, what runs now. */
export interface ServerContext {
  options: ViewServerOptions;
  repository: RepositoryOptions | undefined;
  /** The graph served at `/` (`symbiote pr`). */
  root: Site | undefined;
  sites: WeakMap<Graph, Site>;
  opened: Map<string, { info: BranchReviewInfo; pair: Pair }>;
  reviewSites: WeakMap<Graph, Map<string, Site>>;
  pairSites: Map<string, SiteFiles>;
  /** The server's own hosts, filled once it listens. */
  hosts: Set<string>;
  busy: Set<string>;
  streams: Set<ServerResponse>;
  log: Log;
  viewerFiles: Map<string, Buffer>;
  mcp: SymbioteMcp | undefined;
}
