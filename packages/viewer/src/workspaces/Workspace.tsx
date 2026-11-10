import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { TerminalAvailability } from '@symbiote/core';
import { AttachImages, type OpenedTerminal } from './AgentTerminal.js';
import { reviewMarks, type ReviewMark } from '../history/branchReviews.js';
import { useNucleusName } from '../shell/names.js';
import { ActivityTab } from './ActivityTab.js';
import { BriefTab } from './BriefTab.js';
import { HiveRunTab } from './HiveRunTab.js';
import { useHiveDetail } from './useHiveDetail.js';
import { useShells } from './useShells.js';
import { useRespond } from './useRespond.js';
import { useWorkspaceActions } from './useWorkspaceActions.js';
import { WorkspaceHead } from './WorkspaceHead.js';
import { WorkspacePipeline } from './WorkspacePipeline.js';
import { TermPanes } from './TermPanes.js';
import { viewOfSearch } from './tab-address.js';
import { useChanges } from './ChangesPanel.js';
import { useChangesPanel, useFocus } from './useChangesPanel.js';
import { TerminalBar } from './TerminalBar.js';
import { barOf } from './terminal-bar.js';
import { agentTabName, hiveSteps, normalSteps, planAnswered } from './workspace-steps.js';
import { ReplyForm } from './ReplyForm.js';
import { WorkspaceTabs, type AgentView, type View } from './WorkspaceTabs.js';
import { TerminalIcon } from '../ui/icons.js';
import { useRemoving, workspaceKey } from './removing.js';
import { ThreadTab, useThread } from './ThreadTab.js';
import { respondTo } from './respond.js';
import { Resizer } from '../ui/Resizer.js';
import { workspaceHref, asksBeforeOpening, opensTerminal, talkCommand } from './workspaces.js';
import { allRows, workspaceGroups, type WorkspaceRow } from './workspace-groups.js';
import { startedWith } from './run-choices.js';
import { replyMode, verdictToSend } from './thread-items.js';
import { GIT_PAGE } from '../shell/pages.js';
import { useShell, type Notice } from '../shell/shell-context.js';
import { shellOfUrl, shownTab } from './shells.js';
import { useWorkspaces } from './useWorkspaces.js';
import { Loading } from '../ui/Loading.js';
import { SideCard } from './SideCard.js';
import { mergeOf } from './workspace-words.js';

/** `?send=verdict`: from the Review tab, the box filled with the review's verdict (V18c). */
const sendOfUrl = (): string | null => new URLSearchParams(window.location.search).get('send');

/** The tab the address picks (`tab-address.ts`; `&run`, and `&review` before V92). */
const viewOfUrl = (): View | null => viewOfSearch(window.location.search);

/**
 * A workspace in the shell's main area (V29a; the Workspaces page's panel before it): its state
 * and actions, then its terminal, its thread or its brief. The address names it (`/?branch=`).
 */
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
  if (!list) return <Loading className="hint main-hint">Listing workspaces…</Loading>;
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
  if (!asked) return <Loading className="hint main-hint">Looking for it…</Loading>;
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
  // until closed. Read when the panel opens, with every change of the list (V89), and when a shown
  // shell's output stops (V94b): their tabs say what runs in them.
  const shellsCan = terminal?.available === true && workspace.worktree.exists;
  const { shells, setShellsQuiet, closing, setClosing, openShell, forgetShell, closeShell } =
    useShells({ branch, shellsCan, version, setSaid });
  const [shellShown, setShellShown] = useState(() => shellOfUrl(window.location.search));
  const [chosen, setChosen] = useState(viewOfUrl);
  // V89: Split (the agent and a shell, by its number) and Focus (the rail, no side card).
  const [split, setSplit] = useState(splitOfUrl);
  const [focus, toggleFocus] = useFocus();
  const splitCan = terminals && shellsCan;
  const fallback: AgentView = terminals ? 'terminal' : 'thread';
  const { shellNumber, splitNumber, view, shownShell } = shownTab({
    chosen,
    shells,
    shellShown,
    split,
    terminals,
    shellsCan,
    hive: workspace.hive !== undefined,
  });
  const showTerminal = terminals && view === 'terminal';
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
  const { respond, message } = useRespond({ branch, terminals, view, show, opened });
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
  const live = agent.state === 'working' || agent.state === 'needs-you';
  const restartable =
    agent.kind !== undefined &&
    ['not-started', 'failed', 'stopped', 'not-running'].includes(agent.state);
  // A plan that waits (decision 833): Approve plan and Send reply under it, while its turn ended.
  const planWaits = agent.state === 'plan-ready' && !agent.interrupted;

  const { act, copy, send, clean, openInCode, typeVerdict } = useWorkspaceActions({
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
  });

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

  return (
    <section className="workspace" aria-label={`Workspace ${branch}`}>
      <WorkspaceHead
        row={row}
        mark={mark}
        nucleusName={nucleusName}
        stopping={stopping}
        setStopping={setStopping}
        said={said}
        setSaid={setSaid}
        showPipeline={showPipeline}
        steps={steps}
        hiveDrives={hiveDrives}
        landed={landed}
        hive={hive}
        read={read}
        merges={merges}
        restartable={restartable}
        busy={busy}
        act={act}
        copy={copy}
        onNotice={onNotice}
        hiveLands={hiveLands}
        focus={focus}
        changesShown={changesShown}
        toggleChanges={toggleChanges}
        clean={clean}
        cleaning={cleaning}
        openInCode={openInCode}
        live={live}
        talk={talk}
        terminals={terminals}
        terminal={terminal}
        setConfirming={setConfirming}
      />
      <WorkspacePipeline
        showPipeline={showPipeline}
        hiveDrives={hiveDrives}
        row={row}
        hive={hive}
        steps={steps}
        merges={merges}
        landed={landed}
        read={read}
      />
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
            onOpenShell={() => void openShell(showShell)}
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
            <TermPanes
              showTerminal={showTerminal}
              shownShell={shownShell}
              splitNumber={splitNumber}
              agentName={agentName}
              bar={bar}
              toggleSplit={toggleSplit}
              asking={asking}
              setAsking={setAsking}
              attempt={attempt}
              setAttempt={setAttempt}
              branch={branch}
              agent={agent}
              setOpened={setOpened}
              ended={ended}
              setEnded={setEnded}
              forgetShell={forgetShell}
              setShellsQuiet={setShellsQuiet}
              setSplit={setSplit}
              setChosen={setChosen}
              setShellShown={setShellShown}
              address={address}
            />
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
          <SideCard
            branch={branch}
            version={version}
            changes={changes}
            setPicks={setPicks}
            showPipeline={showPipeline}
            view={view}
            row={row}
            hive={hive}
            bar={bar}
            shells={shells}
            setSaid={setSaid}
          />
        )}
      </div>
    </section>
  );
}
