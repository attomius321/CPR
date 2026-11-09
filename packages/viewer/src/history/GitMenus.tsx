// Git's menus and the dialogs they open (V11, V14, V66d; decisions 636–645): a row's (check out, a
// workspace, a branch or a tag there, a commit's writes), a branch's in the panel, a stash's; the
// checkout's confirmation, a branch or tag dialog, the question before a git write.
import { useCallback, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type {
  Commit,
  HistoryPage,
  HistoryRefs,
  RefList,
  RepoStatus,
  StashEntry,
} from '@symbiote/core';
import { fetchJson, postCheckout, startReview } from './api.js';
import { branchChoice, checkedOut, checkoutChoices, type CheckoutChoice } from './checkout.js';
import { hideBranch, unstash } from './git-api.js';
import { AskDialog, type After, type Ask } from './AskDialog.js';
import { gitAsks } from './git-asks.js';
import { stashWords, stoppedNotice } from './actions.js';
import { RefDialog, type RefAction } from './RefDialog.js';
import type { PanelEntry } from './branches.js';
import { CheckoutDialog } from './CheckoutDialog.js';
import { RowMenu, type RowMenuItem } from './RowMenu.js';
import { workspaceHref } from '../workspaces/workspaces.js';
import type { useWorkspaces } from '../workspaces/useWorkspaces.js';
import type { Notice, useShell } from '../shell/shell-context.js';

type BranchEntry = Extract<PanelEntry, { kind: 'branch' }>;

/**
 * The menus' and dialogs' state and what they do. `details`, `cursor` and `first` are the listing's;
 * a write done lists afresh (`onRelist`), in place (`relistRef`) or reads the changes again.
 */
export function useGitMenus({
  details,
  cursor,
  setCursor,
  setError,
  first,
  refs,
  shell,
  openWorkspace,
  workspaces,
  goToBranch,
  onRelist,
  readChanges,
  relistRef,
}: {
  /** The rows' commits read so far, by row. */
  details: RefObject<Map<number, Commit>>;
  cursor: number;
  setCursor: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
  first: HistoryPage | null;
  refs: HistoryRefs | null;
  shell: ReturnType<typeof useShell>;
  openWorkspace: (sha?: string) => unknown;
  workspaces: ReturnType<typeof useWorkspaces>['list'];
  goToBranch: (branch: { name: string; row: number | null }) => void;
  onRelist: (notice: Notice | null, branch?: string) => void;
  readChanges: () => void;
  relistRef: RefObject<() => Promise<void>>;
}) {
  // A row's menu (check out, a branch or a tag there), then a checkout's confirmation (V11).
  const [menu, setMenu] = useState<{
    at: { x: number; y: number };
    /** The row's commit. */
    sha: string;
    /** The submenu shown at first: `c`'s (V14). */
    open?: 'checkout';
    checkout: CheckoutChoice[];
    status: RepoStatus;
  } | null>(null);
  const [confirm, setConfirm] = useState<{ choice: CheckoutChoice; status: RepoStatus } | null>(
    null,
  );
  const [checkingOut, setCheckingOut] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  // A branch or tag dialog (V66d), and a branch's menu in the panel.
  const [refAction, setRefAction] = useState<RefAction | null>(null);
  const [branchMenu, setBranchMenu] = useState<{
    at: { x: number; y: number };
    entry: BranchEntry;
  } | null>(null);
  // A git write asked first (decisions 636–645).
  const [question, setQuestion] = useState<Ask | null>(null);

  /** Opens row `row`'s menu at a point of the window, the submenu `open` shown. */
  const openMenu = useCallback((row: number, x: number, y: number, open?: 'checkout') => {
    const commit = details.current.get(row);
    if (!commit) return;
    setCursor(row);
    Promise.all([fetchJson<RefList>('api/refs'), fetchJson<RepoStatus>('api/status')])
      .then(([refs, status]) => {
        setMenu({
          at: { x, y },
          sha: commit.sha,
          ...(open ? { open } : {}),
          checkout: checkoutChoices(commit, refs, status),
          status,
        });
      })
      .catch((e: unknown) => setError(`Could not read the branches: ${(e as Error).message}`));
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

  /** The workspace whose branch's tip is this commit (V18b), if any. */
  const workspaceOn = (sha: string) =>
    (workspaces?.workspaces ?? [])
      .filter((f) => f.tip === sha)
      .slice(0, 1)
      .map((f) => f.branch);

  /** "Check out ▸" (V14) and "Start a workspace here" (V18), then a branch or a tag there. */
  const menuItems = ({ sha, checkout, status }: NonNullable<typeof menu>): RowMenuItem[] => [
    {
      label: 'Check out',
      choices: checkout,
      onChoose: (index) => {
        const choice = checkout[index];
        setMenu(null);
        if (!choice || choice.disabled) return;
        setRefused(null);
        setConfirm({ choice, status });
      },
    },
    ...workspaceOn(sha).map((branch) => ({
      label: 'Open its workspace',
      onSelect: () =>
        shell
          ? shell.navigate({ page: 'workspace', branch })
          : window.location.assign(workspaceHref(branch)),
    })),
    {
      label: 'Start a workspace here',
      onSelect: () => {
        setMenu(null);
        openWorkspace(sha);
      },
    },
    {
      label: 'New branch here…',
      onSelect: () => {
        setMenu(null);
        setRefAction({ kind: 'new-branch', at: sha });
      },
    },
    {
      label: 'New tag here…',
      onSelect: () => {
        setMenu(null);
        setRefAction({ kind: 'new-tag', at: sha });
      },
    },
    ...commitItems(sha),
    ...(details.current.get(cursor)?.sha === sha ? (details.current.get(cursor)?.refs ?? []) : [])
      .filter((ref) => ref.kind === 'tag')
      .map((ref) => ({
        label: `Delete the tag ${ref.name}…`,
        onSelect: () => {
          setMenu(null);
          setRefAction({ kind: 'delete-tag', name: ref.name });
        },
      })),
  ];

  /**
   * A commit's writes onto the branch checked out (decisions 637, 638, 640): cherry-pick, revert,
   * reset; its branches merged in or rebased onto.
   */
  const commitItems = (sha: string): RowMenuItem[] => {
    const ask = (question: Ask) => () => {
      setMenu(null);
      setQuestion(question);
    };
    const commit = details.current.get(cursor);
    const branches = (commit?.sha === sha ? commit.refs : []).flatMap((ref) =>
      (ref.kind === 'branch' || ref.kind === 'remote') && ref.name !== first?.branch
        ? [{ kind: ref.kind, name: ref.name }]
        : [],
    );
    const detached = first?.branch ? {} : { disabled: 'HEAD is detached: check out a branch' };
    const choices = (verb: string) =>
      branches.map((ref) => ({
        label: `${verb} ${ref.name}`,
        ref,
        note: ref.kind === 'remote' ? 'remote branch' : 'branch',
        ...detached,
      }));
    const choose = (make: (name: string) => Ask) => (index: number) => {
      const ref = branches[index];
      setMenu(null);
      if (ref && first?.branch) setQuestion(make(ref.name));
    };
    return [
      { label: `Cherry-pick onto ${onto}…`, onSelect: ask(askCherryPick(sha)) },
      { label: 'Revert…', onSelect: ask(askRevert(sha)) },
      { label: `Reset ${onto} to here…`, onSelect: ask(askReset(sha)) },
      ...(branches.length === 0
        ? []
        : [
            { label: `Merge into ${onto}`, choices: choices('Merge'), onChoose: choose(askMerge) },
            {
              label: `Rebase ${onto} onto`,
              choices: choices('Onto'),
              onChoose: choose(askRebase),
            },
          ]),
    ];
  };

  /** A branch's menu in the panel (V66d): check out, go to its tip, review, rename, delete. */
  const branchMenuItems = (entry: BranchEntry): RowMenuItem[] => {
    const local = refs?.branches.some((b) => b.name === entry.name) ?? false;
    const remote = local ? undefined : refs?.remotes.find((r) => r.name === entry.name);
    const close = (then: () => void) => () => {
      setBranchMenu(null);
      then();
    };
    return [
      { label: 'Check out…', onSelect: close(() => checkoutBranch(entry)) },
      ...(entry.row === null
        ? []
        : [{ label: 'Go to its tip', onSelect: close(() => goToBranch(entry)) }]),
      ...(local
        ? [
            {
              label: 'Review',
              onSelect: close(() => {
                startReview(entry.name)
                  .then((url) => window.location.assign(url))
                  .catch((e: unknown) =>
                    setError(`Could not review ${entry.name}: ${(e as Error).message}`),
                  );
              }),
            },
            {
              label: 'Rename…',
              onSelect: close(() => setRefAction({ kind: 'rename-branch', name: entry.name })),
            },
            {
              label: 'Delete…',
              onSelect: close(() => setRefAction({ kind: 'delete-branch', name: entry.name })),
            },
          ]
        : []),
      // Merged in or rebased onto (decision 638); a remote's deleted there (644); hidden (645).
      ...(first?.branch && entry.name !== first.branch
        ? [
            {
              label: `Merge into ${first.branch}…`,
              onSelect: close(() => setQuestion(askMerge(entry.name))),
            },
            {
              label: `Rebase ${first.branch} onto it…`,
              onSelect: close(() => setQuestion(askRebase(entry.name))),
            },
          ]
        : []),
      ...(remote
        ? [
            {
              label: `Delete from ${remote.remote}…`,
              onSelect: close(() => setQuestion(askDeleteRemote(entry.name, remote.remote))),
            },
          ]
        : []),
      ...(local && entry.name === first?.branch
        ? []
        : [
            {
              label: entry.hidden ? 'Show in the graph' : 'Hide from the graph',
              onSelect: close(() =>
                toggleHidden(
                  `refs/${local ? 'heads' : 'remotes'}/${entry.name}`,
                  entry.name,
                  !entry.hidden,
                ),
              ),
            },
          ]),
    ];
  };

  /** A branch checked out from the panel: the row menu's confirmation (V11), its rules (V66d). */
  const checkoutBranch = useCallback(
    (entry: BranchEntry) => {
      Promise.all([fetchJson<RefList>('api/refs'), fetchJson<RepoStatus>('api/status')])
        .then(([listed, status]) => {
          const choice = branchChoice(entry.name, listed, status);
          if (!choice) return setError(`No branch ${entry.name} to check out`);
          if (choice.disabled) return shell?.notify({ text: `${entry.name}: ${choice.disabled}` });
          setRefused(null);
          setConfirm({ choice, status });
        })
        .catch((e: unknown) => setError(`Could not read the branches: ${(e as Error).message}`));
    },
    [shell],
  );

  const runCheckout = useCallback(
    async ({ target }: CheckoutChoice) => {
      setCheckingOut(true);
      setRefused(null);
      try {
        const result = await postCheckout(target);
        const remote = target.kind === 'remote' ? target.name : undefined;
        onRelist({
          text: checkedOut(result, remote),
          ...(result.warning ? { warning: result.warning } : {}),
        });
      } catch (e) {
        setRefused((e as Error).message);
        setCheckingOut(false);
      }
    },
    [onRelist],
  );

  /**
   * A git write done (decisions 636–645): the status bar says how it ended, then the page lists
   * afresh (HEAD moved), in place, or reads the uncommitted changes again.
   */
  const answered = useCallback(
    (notice: Notice, after: After) => {
      setQuestion(null);
      if (after === 'afresh') return onRelist(notice);
      shell?.notify(notice);
      if (after === 'here') void relistRef.current();
      else readChanges();
    },
    [onRelist, shell, readChanges],
  );
  // The branch the writes go onto: HEAD's.
  const onto = first?.branch ?? 'HEAD';
  const { askCherryPick, askRevert, askReset, askMerge, askRebase, askDeleteRemote } =
    gitAsks(onto);
  /** Hides a branch from the graph or shows it again (decision 645): listed in place. */
  const toggleHidden = (ref: string, name: string, hidden: boolean) => {
    hideBranch(ref, hidden)
      .then(() => {
        shell?.notify({ text: hidden ? `Hid ${name} from the graph` : `Showing ${name} again` });
        void relistRef.current();
      })
      .catch((e: unknown) =>
        shell?.notify({
          text: `Could not ${hidden ? 'hide' : 'show'} ${name}`,
          warning: (e as Error).message,
          error: true,
        }),
      );
  };
  /** A stash's menu (decision 639): apply or pop it at once; drop it once asked. */
  const [stashMenu, setStashMenu] = useState<{
    at: { x: number; y: number };
    stash: StashEntry;
  } | null>(null);
  const stashItems = (entry: StashEntry): RowMenuItem[] => {
    const words = stashWords(entry);
    const apply = (action: 'apply' | 'pop') => () => {
      setStashMenu(null);
      unstash(entry.sha, action)
        .then((result) =>
          answered(
            stoppedNotice(result, `${action === 'pop' ? 'Popped' : 'Applied'} the stash ${words}`),
            'changes',
          ),
        )
        .catch((e: unknown) =>
          shell?.notify({
            text: `Could not ${action} the stash`,
            warning: (e as Error).message,
            error: true,
          }),
        );
    };
    return [
      { label: 'Apply', onSelect: apply('apply') },
      { label: 'Pop: apply, then drop', onSelect: apply('pop') },
      {
        label: 'Drop…',
        onSelect: () => {
          setStashMenu(null);
          setQuestion({
            title: `Drop the stash ${words}?`,
            note: 'Its changes are lost: git keeps no other copy.',
            verb: 'Drop',
            danger: true,
            run: async () => {
              await unstash(entry.sha, 'drop');
              return { text: `Dropped the stash ${words}` };
            },
            after: 'changes',
          });
        },
      },
    ];
  };
  return {
    menu,
    closeMenu,
    menuItems,
    openMenu,
    confirm,
    setConfirm,
    checkingOut,
    refused,
    runCheckout,
    checkoutBranch,
    refAction,
    setRefAction,
    branchMenu,
    setBranchMenu,
    branchMenuItems,
    stashMenu,
    setStashMenu,
    stashItems,
    question,
    setQuestion,
    answered,
  };
}

/** The menus and dialogs open, in the page's order. */
export function GitMenus({
  menus,
  onRelist,
}: {
  menus: ReturnType<typeof useGitMenus>;
  onRelist: (notice: Notice | null, branch?: string) => void;
}) {
  const {
    branchMenu,
    branchMenuItems,
    setBranchMenu,
    stashMenu,
    stashItems,
    setStashMenu,
    question,
    answered,
    setQuestion,
    refAction,
    setRefAction,
    menu,
    menuItems,
    closeMenu,
    confirm,
    checkingOut,
    refused,
    runCheckout,
    setConfirm,
  } = menus;
  return (
    <>
      {branchMenu && (
        <RowMenu
          at={branchMenu.at}
          items={branchMenuItems(branchMenu.entry)}
          onClose={() => setBranchMenu(null)}
        />
      )}
      {stashMenu && (
        <RowMenu
          at={stashMenu.at}
          items={stashItems(stashMenu.stash)}
          onClose={() => setStashMenu(null)}
        />
      )}
      {question && (
        <AskDialog ask={question} onDone={answered} onCancel={() => setQuestion(null)} />
      )}
      {refAction && (
        <RefDialog
          action={refAction}
          onDone={(notice) => {
            setRefAction(null);
            onRelist(notice);
          }}
          onCancel={() => setRefAction(null)}
        />
      )}
      {menu && (
        <RowMenu
          at={menu.at}
          items={menuItems(menu)}
          {...(menu.open === 'checkout' ? { open: 0 } : {})}
          onClose={closeMenu}
        />
      )}
      {confirm && (
        <CheckoutDialog
          choice={confirm.choice}
          state={confirm.status}
          running={checkingOut}
          error={refused}
          onConfirm={() => void runCheckout(confirm.choice)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
