import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type {
  MergeEntry,
  WorkspaceReplied,
  WorkspaceShell,
  WorkspaceShells,
  WorkspaceStart,
  TerminalAvailability,
  WorkspaceSummary,
} from '@symbiote/core';
import {
  AgentTerminal,
  AttachImages,
  lastTerminalSize,
  toTerminal,
  type OpenedTerminal,
} from './AgentTerminal.js';
import { reviewMarks, type ReviewMark } from '../history/branchReviews.js';
import { useNucleusName } from '../shell/names.js';
import { ActivityTab } from './ActivityTab.js';
import { BriefTab } from './BriefTab.js';
import { HiveRunTab, RunFacts, useHiveDetail } from './HiveRunTab.js';
import { viewOfSearch } from './tab-address.js';
import { ChangesPanel, changedFiles, useChanges } from './ChangesPanel.js';
import { useChangesPanel, useFocus } from './useChangesPanel.js';
import { HeadSteps, Since } from './HeadSteps.js';
import { TerminalBar } from './TerminalBar.js';
import { barOf } from './terminal-bar.js';
import {
  agentTabName,
  hiveSteps,
  normalSteps,
  pipelineSteps,
  planAnswered,
  type StepsModel,
} from './workspace-steps.js';
import { ReplyForm } from './ReplyForm.js';
import { WorkspaceTabs, type AgentView, type View } from './WorkspaceTabs.js';
import {
  BellIcon,
  BranchIcon,
  ChangesIcon,
  CheckIcon,
  ChoreIcon,
  CloseIcon,
  EditorIcon,
  ExpandIcon,
  MergeIcon,
  PencilIcon,
  ReviewIcon,
  SpinIcon,
  TerminalIcon,
} from '../ui/icons.js';
import { Pipeline, type PipelineState } from '../ui/Pipeline.js';
import { HivePipeline } from './HivePipeline.js';
import { hivePipeline } from './hive-pipeline.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { PageHead } from '../ui/PageHead.js';
import { KIND_ICONS } from './StartKinds.js';
import { cleanUp } from './cleanup.js';
import { useRemoving, workspaceKey } from './removing.js';
import { MoreActions, type MenuAction } from '../ui/MoreActions.js';
import { MergeControl } from './MergeControl.js';
import { openReview } from './review-open.js';
import { ThreadTab, useThread } from './ThreadTab.js';
import { RunsOn, WorkspaceBranch } from './WorkspaceFacts.js';
import { rowWords } from './row-words.js';
import { RESPOND_EVENT, respondTo } from './respond.js';
import { postJson, serverWords } from '../ui/http.js';
import { Resizer } from '../ui/Resizer.js';
import {
  AGENT_NAMES,
  runsOnWords,
  allRows,
  workspaceGroups,
  workspaceHref,
  workspaceName,
  briefTip,
  replyMode,
  asksBeforeOpening,
  opensTerminal,
  startedNotice,
  startedWith,
  talkCommand,
  verdictToSend,
  type WorkspaceRow,
  mergedForCard,
} from './workspaces.js';
import { GIT_PAGE } from '../shell/pages.js';
import { useShell, type Notice } from '../shell/shell-context.js';
import { verdictLine } from './terminal.js';
import { closeQuestion, shellAfter, shellName, shellOfUrl, withShell } from './shells.js';
import { readWorkspacesAgain, reloadWorkspaces, useWorkspaces } from './useWorkspaces.js';
import { tip } from '../ui/tip.js';

/** `?send=verdict`: from the Review tab, the box filled with the review's verdict (V18c). */
const sendOfUrl = (): string | null => new URLSearchParams(window.location.search).get('send');

/** The tab the address picks (`tab-address.ts`; `&run`, and `&review` before V92). */
const viewOfUrl = (): View | null => viewOfSearch(window.location.search);

/** A workspace's shells (V45): its terminals' IDs, so read with the page's header. */
async function readShells(branch: string): Promise<WorkspaceShell[]> {
  const response = await fetch(`/api/workspaces/shells?branch=${encodeURIComponent(branch)}`, {
    headers: { 'x-symbiote': '1' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(serverWords(text));
  return (JSON.parse(text) as WorkspaceShells).shells;
}

/**
 * A workspace in the shell's main area (V29a; the Workspaces page's panel before it): its state
 * and actions, then its terminal, its thread or its brief. The address names it (`/?branch=`).
 */
/** Whose turn it is, the pipeline card's Turn (proof 02). */
const TURN_WORDS: Record<StepsModel['tone'], string> = {
  you: 'Yours',
  run: "Agent's",
  ok: 'Done',
  error: 'Stopped',
  info: 'Paused',
  idle: 'Nobody',
};

/** A pipeline step's mark (V93): done a check, at work the arc, failed a cross, else its own. */
function stepIcon(name: string, state: PipelineState): ReactNode {
  if (state === 'done') return <CheckIcon />;
  if (state === 'now') return <SpinIcon />;
  if (state === 'bad') return <CloseIcon />;
  switch (name) {
    case 'Your OK':
      return <BellIcon />;
    case 'Review':
      return <ReviewIcon />;
    case 'Merge':
    case 'Land':
      return <MergeIcon />;
    case 'Check':
      return <ChoreIcon />;
    default:
      return <PencilIcon />;
  }
}

export function WorkspaceView({ branch }: { branch: string }) {
  const shell = useShell();
  const { list, reviews } = useWorkspaces();
  // The Review tab's "Send to the agent" opens the workspace with `&send=verdict`, once.
  const [send] = useState(sendOfUrl);
  const groups = useMemo(() => workspaceGroups(list?.workspaces ?? [], reviews), [list, reviews]);
  const nucleusName = useNucleusName();
  const marks = useMemo(() => reviewMarks(reviews, nucleusName).marks, [reviews, nucleusName]);
  const row = allRows(groups).find((r) => r.workspace.branch === branch);
  const notify = useCallback((notice: Notice | null) => shell?.notify(notice), [shell]);
  const onGone = useCallback(() => shell?.navigate({ page: 'overview' }), [shell]);
  if (!list) return <p className="hint main-hint">Listing workspaces…</p>;
  if (!row) return <NotListed branch={branch} />;
  return (
    <WorkspacePanel
      key={branch}
      row={row}
      mark={marks.get(branch)}
      waiting={groups.waiting.map((r) => r.workspace.branch).filter((b) => b !== branch)}
      version={list}
      terminal={list.terminal}
      fillVerdict={send === 'verdict'}
      onNotice={notify}
      onGone={onGone}
    />
  );
}

/**
 * A workspace the list does not have: one cleaned up moves to History (V77), its address replaced;
 * else it was started elsewhere, or its record is gone.
 */
function NotListed({ branch }: { branch: string }) {
  const shell = useShell();
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    let gone = false;
    fetch(`/api/workspaces/history?branch=${encodeURIComponent(branch)}`).then(
      (response) => {
        if (gone) return;
        if (response.ok) shell?.navigate({ page: 'workspace-history', branch }, { replace: true });
        else setAsked(true);
      },
      () => !gone && setAsked(true),
    );
    return () => {
      gone = true;
    };
  }, [branch, shell]);
  if (!asked) return <p className="hint main-hint">Looking for it…</p>;
  return (
    <div className="main-empty">
      <p>No workspace {branch}.</p>
      <p className="hint">
        It was started elsewhere, or its record is gone. The sidenav lists the workspaces there are,
        History the finished ones;{' '}
        <a href={`${GIT_PAGE}?branch=${encodeURIComponent(branch)}`}>Git</a> shows its branch, if it
        is still there.
      </p>
    </div>
  );
}

/** `&split=<n>`: Split on, with shell `n` beside the agent (V89, decision 831). */
const splitOfUrl = (): number | null => {
  const value = new URLSearchParams(window.location.search).get('split');
  return value !== null && /^[1-9]\d*$/.test(value) ? Number(value) : null;
};

/** What Approve plan sends (V89, decision 833): the plan's OK, as the proof words it. */
export const PLAN_OK = 'Your plan is approved. Build it as planned, and commit in small steps.';

/**
 * The picked workspace (V18c; in the shell's main area since V29a; the redesign's since V89): its
 * steps and actions in its head, then its sessions — its agent's terminal, its thread, activity
 * and brief, its shells —, the bar under them that says what waits, and its side card. Nothing is
 * sent without the person (decision 82); sending to an agent that works, or waits on a prompt,
 * ends its turn, so that is asked first.
 */
function WorkspacePanel({
  row,
  mark,
  waiting,
  version,
  terminal,
  fillVerdict,
  onNotice,
  onGone,
}: {
  row: WorkspaceRow;
  mark: ReviewMark | undefined;
  /** The other workspaces whose agent waits for the person (V48), in the sidenav's order. */
  waiting: string[];
  /** The list as last read: the thread is read again with it. */
  version: unknown;
  /** Whether its agent's session can be shown in a terminal (V21). */
  terminal: TerminalAvailability | undefined;
  /** Fill the box with the review's verdict once it is read (`?send=verdict`). */
  fillVerdict: boolean;
  onNotice: (notice: Notice | null) => void;
  /** It was cleaned up: the main area shows something else. */
  onGone: () => void;
}) {
  const shell = useShell();
  const nucleusName = useNucleusName();
  const { merges } = useWorkspaces();
  const { workspace } = row;
  const { branch, agent } = workspace;
  const [thread, reloadThread] = useThread(branch, version);
  const [said, setSaid] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  // Being cleaned up (V57), from here or from its card: its actions wait, as its card does.
  const cleaning = useRemoving(workspaceKey(branch));
  const busy = acting || cleaning;
  // Its stop asked, until the server answers (V48): the button says so.
  const [stopping, setStopping] = useState(false);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState<'send' | 'clean' | null>(null);
  const filled = useRef(false);
  const mode = replyMode(agent);
  const verdict = verdictToSend(thread);
  // V21: the agent's own session in a terminal, where one can run: the panel opens on it, and the
  // thread is its history, read only (one way to answer the agent: the box stops its session).
  // Claude Code's, and Codex's on its app server (V27b): through Symbiote's runner, Codex's turns
  // in a terminal would not reach its thread (decision 133).
  const terminals = opensTerminal(agent, terminal);
  const talk = talkCommand(agent, workspace.worktree.path);
  // Hive drives it (HV4): its steps, its writer, its bar.
  const hiveDrives = workspace.hive !== undefined && !workspace.hive.off;
  // V45: shells in its worktree, in tabs after the agent's, whatever its agent; kept by the server
  // until closed. Read when the panel opens and with every read of the list (V89): their tabs say
  // what runs in them.
  const shellsCan = terminal?.available === true && workspace.worktree.exists;
  const [shells, setShells] = useState<WorkspaceShell[] | null>(null);
  // Bumped by every change made here: a read begun before it is older than what is shown.
  const shellsChanged = useRef(0);
  const [shellShown, setShellShown] = useState(() => shellOfUrl(window.location.search));
  const [closing, setClosing] = useState<{ shell: WorkspaceShell; question: string } | null>(null);
  const [chosen, setChosen] = useState(viewOfUrl);
  // V89: Split (the agent and a shell, by its number) and Focus (the rail, no side card).
  const [split, setSplit] = useState(splitOfUrl);
  const [focus, toggleFocus] = useFocus();
  const splitCan = terminals && shellsCan;
  const fallback: AgentView = terminals ? 'terminal' : 'thread';
  // The shell picked; once it went (closed, exited), its neighbour, the one before first; none
  // left, or `symbiote view` started again: the agent's tab.
  const shellNumber =
    shellShown === null || shells === null || shells.some((shell) => shell.number === shellShown)
      ? shellShown
      : shellAfter(shells, shellShown);
  // Split's shell, as for a picked one: its neighbour once it went; none left, Split is off.
  const splitNumber =
    !splitCan || split === null
      ? null
      : shells === null || shells.some((shell) => shell.number === split)
        ? split
        : shellAfter(shells, split);
  const shellGone = chosen === 'shell' && (!shellsCan || (shells !== null && shellNumber === null));
  const view: View =
    splitNumber !== null
      ? 'terminal'
      : chosen === 'terminal' && !terminals
        ? 'thread'
        : shellGone || (chosen === 'run' && !workspace.hive)
          ? fallback
          : (chosen ?? fallback);
  const showTerminal = terminals && view === 'terminal';
  const shownShell =
    splitNumber !== null
      ? shells?.find((shell) => shell.number === splitNumber)
      : view === 'shell'
        ? shells?.find((shell) => shell.number === shellNumber)
        : undefined;
  const [opened, setOpened] = useState<OpenedTerminal | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Attaching to a stopped session continues it (with no turn): asked when a terminal is to
  // open, not once it is open (a stop from the head leaves its last lines in view).
  const [asking, setAsking] = useState(() => asksBeforeOpening(agent));
  // The branch's changes at the right (V29d), shown or hidden, as wide as they were dragged; read
  // here (V89), for the head's counts and the side card alike.
  const { changesShown, toggleChanges, changesWidth, resizeChanges, resizing, setResizing } =
    useChangesPanel();
  const [picks, setPicks] = useState(0);
  const changes = useChanges(branch, version, picks);
  // Hive's record (HV3), read once a list read (V89): the head's spend and the Review tab.
  const hive = useHiveDetail(branch, version, workspace.hive !== undefined);
  // A text to type into the agent's terminal and send (decision 834), once it is open.
  const [typing, setTyping] = useState<string | null>(null);

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
  }, [branch, shellsCan, version]);
  // Focus folds the sidenav to its rail while this page shows it (decision 830).
  const setFocused = shell?.setFocused;
  useEffect(() => {
    setFocused?.(focus);
    return () => setFocused?.(false);
  }, [focus, setFocused]);
  /** The address for the tabs shown: `&split=<n>`, `&shell=<n>`, `&<view>`, or the terminal. */
  const address = (next: string | null) => {
    const href = workspaceHref(branch);
    window.history.replaceState(null, '', next === null ? href : `${href}&${next}`);
  };
  const show = (next: AgentView) => {
    setChosen(next);
    setEnded(null);
    setAsking(asksBeforeOpening(agent));
    // The agent's tab keeps Split; any other view leaves it.
    if (next !== 'terminal') setSplit(null);
    address(next === 'terminal' ? (splitNumber !== null ? `split=${splitNumber}` : null) : next);
  };
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
  const showShell = (number: number) => {
    // In Split a shell's tab swaps the right pane.
    if (splitNumber !== null) {
      setSplit(number);
      address(`split=${number}`);
      return;
    }
    setChosen('shell');
    setShellShown(number);
    address(`shell=${number}`);
  };
  /** Opens a shell at the size the last terminal was drawn at; it is fitted once shown. */
  const openShell = (then: (number: number) => void = showShell) =>
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
  /** Split on, with the shell last shown, else the first, else a new one; or off. */
  const toggleSplit = () => {
    if (splitNumber !== null) {
      setSplit(null);
      address(null);
      return;
    }
    const on = (number: number) => {
      setChosen('terminal');
      setEnded(null);
      setSplit(number);
      address(`split=${number}`);
    };
    const known = shells?.find((shell) => shell.number === shellNumber) ?? shells?.[0];
    if (known) on(known.number);
    else void openShell(on);
  };
  // The picked tab in sight when the strip scrolls (many shells, a narrow window): when it is
  // picked, and when the strip narrows.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const reveal = () =>
      element
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view, shellNumber, shells?.length]);
  // What is drawn for a shell that went is its neighbour's tab: the address says so too.
  useEffect(() => {
    if (split !== null && shells !== null && splitNumber !== split) {
      setSplit(splitNumber);
      address(splitNumber === null ? null : `split=${splitNumber}`);
      return;
    }
    if (chosen !== 'shell' || shells === null || shellNumber === shellShown) return;
    if (shellNumber === null) show(fallback);
    else showShell(shellNumber);
  });
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

  const live = agent.state === 'working' || agent.state === 'needs-you';
  const restartable =
    agent.kind !== undefined &&
    ['not-started', 'failed', 'stopped', 'not-running'].includes(agent.state);
  // A plan that waits (decision 833): Approve plan and Send reply under it, while its turn ended.
  const planWaits = agent.state === 'plan-ready' && !agent.interrupted;

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
  const more: MenuAction[] = [
    // Stop is the menu's, as proofs 02 and 08 draw the head (V93): it says it stops meanwhile.
    ...(live
      ? [
          {
            label: stopping ? 'Stopping…' : 'Stop the agent',
            disabled: busy,
            onSelect: () => {
              setStopping(true);
              setSaid('Stopping the agent…');
              act(() =>
                postJson('/api/workspaces/stop', { branch })
                  .then(() => null)
                  .finally(() => setStopping(false)),
              );
            },
          },
        ]
      : []),
    ...(talk && !terminals
      ? [
          {
            label: 'Talk',
            title: `Talk to the agent in a terminal: ${talk}${
              agent.kind === 'codex' && !agent.remote
                ? ' (its turns there are not recorded in this thread)'
                : terminal && !terminal.available
                  ? ` (no terminal here: ${terminal.reason})`
                  : ''
            }`,
            onSelect: () => act(() => copy(talk, `${talk}: paste it in a terminal`)),
          },
        ]
      : []),
    {
      label: 'Copy the prompt',
      disabled: busy,
      onSelect: () =>
        act(async () => {
          const response = await fetch(
            `/api/workspaces/prompt?branch=${encodeURIComponent(branch)}`,
          );
          if (!response.ok) throw new Error(await response.text());
          const { prompt } = (await response.json()) as { prompt: string };
          return copy(prompt, 'the prompt');
        }),
    },
    // Merged, Clean up is the head's own button (V55).
    ...(!mergedForCard(workspace) && !live
      ? [
          {
            label: 'Clean up…',
            disabled: busy,
            title: 'Not merged: remove its worktree, keep the branch',
            onSelect: () => setConfirming('clean'),
          },
        ]
      : []),
  ];

  const views: AgentView[] = [
    // A workspace Hive drives (HV3): its run, its rounds and its landing (V92: Run), first as
    // proofs 02, 03 and 07 draw it (V93).
    ...(workspace.hive ? (['run'] as const) : []),
    ...(terminals ? (['terminal'] as const) : []),
    'thread',
    'activity',
    'brief',
  ];
  // In Hive mode Hive lands a workspace it drives (HV4, decision 774): no review of the person's.
  const hiveLands = hiveDrives;
  const entries = thread?.entries ?? [];

  // The head's steps (decisions 823–825).
  const steps =
    hiveDrives && workspace.hive
      ? hiveSteps(workspace.hive)
      : normalSteps({
          workspace,
          next: row.next,
          planAnswered: planAnswered(entries),
          ...mergeOf(merges?.merges ?? [], branch),
        });
  const read = changes !== null && typeof changes !== 'string' ? changes : null;
  // The pipeline card on every view but the terminal's (V93, decision 884; proofs 02, 03, 07).
  const showPipeline = view !== 'terminal' && view !== 'shell';
  const landed =
    workspace.hive?.landing?.outcome === 'landed' ? workspace.hive.landing.ended : undefined;
  const bar = barOf({ workspace, next: row.next, entries });
  const agentName = agentTabName(agent, hiveDrives);
  const shellsRunning = (shells ?? []).filter((one) => one.running);
  const doing = workspace.activity?.doing;
  const editing = doing && 'tool' in doing ? doing.subject : undefined;

  const pane = (head: ReactNode, body: ReactNode, key: string) => (
    <div key={key} className="term-pane">
      {splitNumber !== null && <div className="term-pane-head">{head}</div>}
      {body}
    </div>
  );

  return (
    <section className="workspace" aria-label={`Workspace ${branch}`}>
      {/* The page frame's head (V72, decision 511): the kind's icon, the name and its kind, then
          the branch, where it started and what runs it; its steps and actions at the right
          (V89, decision 823). */}
      <PageHead
        className={`workspace-top tone-${row.next.chip.tone}`}
        icon={(workspace.kind && KIND_ICONS[workspace.kind]) ?? <BranchIcon />}
        title={<span {...tip(briefTip(workspace.brief))}>{workspaceName(workspace)}</span>}
        line={
          <span className="workspace-state-line">
            <span className="workspace-ref">
              <WorkspaceBranch row={row} mark={mark} />
            </span>
            {workspace.from && (
              <span className="workspace-from">
                from <span className="mono">{workspace.from}</span>
              </span>
            )}
            <span className="workspace-since">
              started {startedAt(workspace.created)}
              {workspace.via ? ` by ${workspace.via === 'nucleus' ? nucleusName : 'an agent'}` : ''}
            </span>
            <RunsOn agent={workspace.agent} />
          </span>
        }
        actions={
          <>
            {said && (
              <span className="workspace-said" role="status">
                {said}
              </span>
            )}
            {/* The pipeline card holds the steps outside the terminal view (V93, decision 884):
                the head its state's pill. In the terminal view they stay in the head (V89). */}
            {!showPipeline && (
              <HeadSteps
                model={steps}
                {...(hiveDrives
                  ? {
                      hive: {
                        started: workspace.created,
                        ...(landed ? { ended: landed } : {}),
                        ...(hive.detail?.spend ? { spend: hive.detail.spend } : {}),
                      },
                    }
                  : {
                      normal: {
                        commits: workspace.ahead,
                        files: read ? changedFiles(read) : null,
                      },
                    })}
              />
            )}
            {showPipeline && (
              <StatusLabel tone={steps.tone} className="workspace-pill">
                {hiveDrives && workspace.hive && hive.detail
                  ? hivePipeline(steps, hive.detail, {
                      into: workspace.from ?? 'its branch',
                      commits: workspace.ahead,
                      push: merges?.push === true,
                      now: Date.now(),
                    }).pill
                  : steps.tone === 'you'
                    ? `${rowWords(row, Date.now()).word} · your turn`
                    : steps.tone === 'run'
                      ? 'Working'
                      : steps.word}
              </StatusLabel>
            )}
            {restartable && workspace.worktree.exists && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    postJson<WorkspaceStart>('/api/workspaces/start', { branch }).then((start) => {
                      onNotice(startedNotice(start));
                      return null;
                    }),
                  )
                }
              >
                Start the agent
              </button>
            )}
            {/* Hive lands its own (HV4, decision 774): no Merge into while Hive drives it. */}
            {workspace.ahead > 0 && !mergedForCard(workspace) && !hiveLands && (
              <MergeControl branch={branch} />
            )}
            {/* Open in VS Code, the proofs' ‹› beside the side card's toggle (V93). */}
            {workspace.worktree.exists && (
              <button
                type="button"
                className="icon-button head-open"
                aria-label="Open in VS Code"
                disabled={busy}
                {...tip('Open its worktree in VS Code')}
                onClick={openInCode}
              >
                <EditorIcon />
              </button>
            )}
            {!focus && (
              <button
                type="button"
                className="icon-button changes-toggle"
                aria-label="Changes"
                aria-pressed={changesShown}
                {...tip(`${changesShown ? 'Hide' : 'Show'} the side card`, { keys: ']' })}
                onClick={toggleChanges}
              >
                <ChangesIcon />
              </button>
            )}
            <MoreActions actions={more} />
            {!hiveLands && workspace.ahead > 0 && workspace.tip !== null && (
              <button
                type="button"
                className={mergedForCard(workspace) ? 'button secondary' : 'button primary'}
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await openReview(branch);
                    return null;
                  })
                }
              >
                Review
              </button>
            )}
            {mergedForCard(workspace) && (
              <button
                type="button"
                className="button danger"
                disabled={busy}
                {...tip('Remove its sessions, its worktree and its merged branch')}
                onClick={() => clean(false)}
              >
                {cleaning ? 'Cleaning up…' : 'Clean up'}
              </button>
            )}
          </>
        }
      />
      {showPipeline && hiveDrives && workspace.hive && hive.detail && (
        <HivePipeline
          model={steps}
          detail={hive.detail}
          into={workspace.from ?? 'its branch'}
          commits={workspace.ahead}
          push={merges?.push === true}
          created={workspace.created}
          landed={landed}
          icon={stepIcon}
        />
      )}
      {showPipeline && !(hiveDrives && workspace.hive && hive.detail) && (
        <Pipeline
          label="Its steps"
          steps={pipelineSteps(steps, {
            into: workspace.from ?? 'its branch',
            commits: workspace.ahead,
          }).map((step) => ({
            name: step.name,
            state: step.state,
            // At work, what its agent does now (V48f: "Thinking", "Editing src/a.ts").
            detail: step.state === 'now' && row.next.doing ? row.next.doing : step.detail,
            icon: stepIcon(step.name, step.state),
          }))}
          cells={
            hiveDrives && workspace.hive
              ? [
                  {
                    label: 'Round',
                    value: (
                      <>
                        {workspace.hive.round} <small>of {workspace.hive.rounds}</small>
                      </>
                    ),
                    words: steps.word,
                  },
                  {
                    label: 'Time',
                    value: (
                      <Since since={workspace.created} {...(landed ? { until: landed } : {})} />
                    ),
                    words: landed ? 'brief to landed' : 'since the brief',
                  },
                  ...(hive.detail?.spend
                    ? [
                        {
                          label: 'Spend',
                          value: `$${hive.detail.spend.total.toFixed(2)}`,
                          words:
                            hive.detail.spend.budget !== undefined
                              ? `of $${hive.detail.spend.budget.toFixed(2)}`
                              : 'no budget',
                        },
                      ]
                    : []),
                ]
              : [
                  {
                    label: 'Turn',
                    value: TURN_WORDS[steps.tone],
                    ...(steps.tone === 'you' ? { tone: 'you' as const } : {}),
                    ...(steps.since ? { words: `since ${startedAt(steps.since)}` } : {}),
                  },
                  {
                    label: 'Commits',
                    value: workspace.ahead,
                    words:
                      workspace.ahead === 0 && workspace.planFirst
                        ? 'plan first'
                        : read
                          ? `${changedFiles(read)} file${changedFiles(read) === 1 ? '' : 's'}`
                          : 'on its branch',
                  },
                ]
          }
        />
      )}
      {closing && (
        <p className="workspace-confirm">
          {closing.question}{' '}
          <button
            type="button"
            className="button"
            onClick={() => void closeShell(closing.shell, true)}
          >
            Close it
          </button>{' '}
          <button type="button" className="button ghost" onClick={() => setClosing(null)}>
            Cancel
          </button>
        </p>
      )}
      {confirming === 'clean' && (
        <p className="workspace-confirm">
          {branch} is not merged: Clean up removes its worktree and keeps the branch and its
          commits.{' '}
          <button type="button" className="button danger" onClick={() => clean(true)}>
            Clean up anyway
          </button>{' '}
          <button type="button" className="button ghost" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </p>
      )}
      <div
        className={`workspace-split${resizing ? ' resizing' : ''}${focus ? ' focus' : ''}`}
        style={
          changesWidth ? ({ '--changes-width': `${changesWidth}px` } as CSSProperties) : undefined
        }
      >
        <div className="workspace-main">
          <WorkspaceTabs
            stripRef={strip}
            views={views}
            view={view}
            agent={agent}
            agentName={agentName}
            shells={shells}
            shellsCan={shellsCan}
            shellNumber={shellNumber}
            split={splitCan ? splitNumber : undefined}
            focus={focus}
            attach={opened && showTerminal ? <AttachImages into={opened} /> : null}
            onShow={show}
            onShowShell={showShell}
            onCloseShell={(shell) => void closeShell(shell)}
            onOpenShell={() => void openShell()}
            onSplit={toggleSplit}
            onFocus={toggleFocus}
          />
          <div className="workspace-body">
            {view === 'activity' && (
              <div className="workspace-activity">
                <ActivityTab workspace={workspace} thread={thread} version={version} />
              </div>
            )}
            {view === 'run' && (
              <HiveRunTab
                workspace={workspace}
                detail={hive.detail}
                error={hive.error}
                commits={read?.commits.listed ?? []}
                onMessage={message}
              />
            )}
            {view === 'brief' && (
              <BriefTab
                text={workspace.brief}
                started={startedWith(workspace.agent, workspace.via, nucleusName)}
                documents={workspace.documents}
              />
            )}
            {(showTerminal || shownShell) && (
              <div className={`term-panes${splitNumber !== null ? ' split' : ''}`}>
                {/* The agent's pane first, at one place in the tree whether Split is on or off:
                    a toggle resizes its terminal, never attaches it again (decision 831). */}
                {showTerminal &&
                  pane(
                    <>
                      <span className="term-pane-name">{agentName.name}</span>
                      <span className="term-pane-what">{bar.detail ?? bar.text}</span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`${agentName.name} alone`}
                        {...tip('This terminal alone')}
                        onClick={toggleSplit}
                      >
                        <ExpandIcon />
                      </button>
                    </>,
                    <div className="workspace-terminal">
                      {asking ? (
                        <p className="workspace-confirm">
                          Opening the terminal continues the stopped session.{' '}
                          <button type="button" className="button" onClick={() => setAsking(false)}>
                            Open the terminal
                          </button>
                        </p>
                      ) : (
                        <AgentTerminal
                          key={attempt}
                          branch={branch}
                          onOpened={setOpened}
                          onEnded={setEnded}
                        />
                      )}
                      {ended && (
                        <p className="workspace-confirm">
                          The terminal {ended === 'exited' ? 'ended' : 'lost its session'}.{' '}
                          <button
                            type="button"
                            className="button"
                            onClick={() => {
                              setEnded(null);
                              // A stop ends the terminal before the list says so: the state is
                              // read anew.
                              void readWorkspacesAgain().then(({ list }) => {
                                const now = list?.workspaces.find((f) => f.branch === branch)?.agent
                                  .state;
                                setAsking(
                                  asksBeforeOpening({ ...agent, state: now ?? agent.state }),
                                );
                                setAttempt((n) => n + 1);
                              });
                            }}
                          >
                            Open again
                          </button>
                        </p>
                      )}
                    </div>,
                    'agent',
                  )}
                {shownShell &&
                  pane(
                    <>
                      <span className="term-pane-name">{shellName(shownShell.number)}</span>
                      {shownShell.running && (
                        <span className="term-pane-what">{shownShell.running}</span>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`${shellName(shownShell.number)} alone`}
                        {...tip('This terminal alone')}
                        onClick={() => {
                          setSplit(null);
                          setChosen('shell');
                          setShellShown(shownShell.number);
                          address(`shell=${shownShell.number}`);
                        }}
                      >
                        <ExpandIcon />
                      </button>
                    </>,
                    <div className="workspace-terminal">
                      <AgentTerminal
                        key={shownShell.id}
                        id={shownShell.id}
                        onEnded={() => forgetShell(shownShell.id)}
                      />
                    </div>,
                    `shell-${shownShell.id}`,
                  )}
              </div>
            )}
            {view === 'thread' && (
              <div className="workspace-thread">
                <ThreadTab thread={thread} worktree={workspace.worktree.path} plan={planWaits} />
                {terminals && !planWaits && (
                  <p className="hint thread-readonly">
                    <span className="thread-readonly-icon">
                      <TerminalIcon />
                    </span>
                    <span>
                      To answer,{' '}
                      <button type="button" className="link" onClick={() => show('terminal')}>
                        open its terminal
                      </button>
                      .
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
          <ReplyForm
            hidden={view !== 'thread' || (terminals && !planWaits)}
            text={text}
            mode={mode}
            verdict={verdict}
            confirming={confirming === 'send'}
            busy={busy}
            waitingFor={agent.waitingFor}
            plan={planWaits}
            inTerminal={terminals}
            onText={setText}
            onSend={(stop) => send(stop)}
            onApprove={() => send(false, PLAN_OK)}
            onCancel={() => setConfirming(null)}
          />
          {/* Not under the Thread tab's reply box, which answers (V93, proof 02). */}
          {/* Nor under the Run tab, which says what Hive runs (V93, proof 02). */}
          {!(view === 'thread' && !(terminals && !planWaits)) && view !== 'run' && (
            <TerminalBar
              model={bar}
              hive={workspace.hive}
              terminalShown={showTerminal || shownShell !== undefined}
              waiting={waiting}
              {...(terminals ? { onTerminal: respond } : {})}
              onThread={() => show('thread')}
              onNext={(next) => respondTo(next, (route) => shell?.navigate(route))}
              {...(verdict && opened && showTerminal
                ? { onVerdict: () => void typeVerdict(opened, verdict.text) }
                : {})}
            />
          )}
        </div>
        {changesShown && !focus && (
          <Resizer
            gutter
            label="Resize changes panel"
            side="after"
            variable="--changes-width"
            min={200}
            room={480}
            onResize={resizeChanges}
            onDrag={setResizing}
          />
        )}
        {changesShown && !focus && (
          <ChangesPanel
            branch={branch}
            version={version}
            changes={changes}
            onPicked={() => setPicks((n) => n + 1)}
            editing={editing}
            // Outside the terminal view, the proof's facts and files (V93, proof 02).
            page={showPipeline && view !== 'run'}
            run={view === 'run'}
            facts={<FactsSection workspace={workspace} />}
            brief={briefFirst(workspace.brief)}
            now={
              view === 'run' ? (
                <RunFacts workspace={workspace} detail={hive.detail} />
              ) : (
                <NowSection row={row} bar={bar} shells={shellsRunning} />
              )
            }
            onSaid={setSaid}
          />
        )}
      </div>
    </section>
  );
}

/** The workspace's newest entry in the merge queue, if any. */
function mergeOf(entries: readonly MergeEntry[], branch: string): { merge?: MergeEntry } {
  const merge = entries.filter((entry) => entry.branch === branch).at(-1);
  return merge ? { merge } : {};
}

/** When it started: the time today, else the day. */
function startedAt(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A brief's first words for the side card (V93): its goal's first paragraph, no Markdown marks. */
function briefFirst(brief: string): string | undefined {
  const lines = brief
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const text = lines.join(' ').replace(/\*\*|__|`/g, '');
  return text === '' ? undefined : text.length > 240 ? `${text.slice(0, 240).trimEnd()}…` : text;
}

/**
 * The workspace's facts (V93, proof 02): its kind, agent, model and plan first. Its permissions
 * are not in the list's summary: not shown.
 */
function FactsSection({ workspace }: { workspace: WorkspaceSummary }) {
  const { agent } = workspace;
  const runs = runsOnWords(agent);
  return (
    <section className="changes-section changes-now" aria-label="Workspace">
      <h2>Workspace</h2>
      <dl className="changes-facts">
        {workspace.kind && (
          <>
            <dt>Kind</dt>
            <dd>{workspace.kind.charAt(0).toUpperCase() + workspace.kind.slice(1)}</dd>
          </>
        )}
        {agent.kind && (
          <>
            <dt>Agent</dt>
            <dd>{AGENT_NAMES[agent.kind]}</dd>
          </>
        )}
        {runs && (
          <>
            <dt>Model</dt>
            <dd>{runs.text}</dd>
          </>
        )}
        <dt>Plan first</dt>
        <dd data-tone={workspace.planFirst && agent.state === 'plan-ready' ? 'you' : undefined}>
          {workspace.planFirst
            ? agent.state === 'plan-ready'
              ? 'on, waits for your OK'
              : 'on'
            : 'off'}
        </dd>
      </dl>
    </section>
  );
}

/**
 * The side card's first section (V89, decision 832): what the agent does now and since when, and
 * what runs in its shells; nothing while neither.
 */
function NowSection({
  row: { workspace, next },
  bar,
  shells,
}: {
  row: WorkspaceRow;
  bar: ReturnType<typeof barOf>;
  shells: WorkspaceShell[];
}) {
  const { agent } = workspace;
  const live = ['working', 'needs-you', 'plan-ready'].includes(agent.state);
  if (!live && shells.length === 0) return null;
  const since = workspace.activity?.since;
  return (
    <section className="changes-section changes-now" aria-label="What its agent does">
      <h2>Now</h2>
      <dl className="changes-facts">
        {live && (
          <>
            <dt>{agent.kind ? AGENT_NAMES[agent.kind] : 'Agent'}</dt>
            <dd data-tone={bar.tone}>
              {agent.state === 'working' ? (next.doing ?? 'Working') : bar.text}
            </dd>
            {since && (
              <>
                <dt>{agent.state === 'working' ? 'Working' : 'Waiting'}</dt>
                <dd>
                  <Since since={since} />
                  {workspace.activity?.tools
                    ? ` · ${workspace.activity.tools} tool call${workspace.activity.tools === 1 ? '' : 's'}`
                    : ''}
                </dd>
              </>
            )}
          </>
        )}
        {shells.map((one) => (
          <Fragment key={one.id}>
            <dt>{shellName(one.number)}</dt>
            <dd className="mono">{one.running}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
