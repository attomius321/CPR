# Journal: NU9 — Nucleus's and Alpha Ceph's read and network commands

[Index](../JOURNAL.md) · [Plan](../plan/nu9-nucleus-read-commands.md)

## NU9 — the shell's reads and the network's (2026-11-04, branch `feature/nucleus-and-aplha-ceph-tools`)

Nucleus's gate, given its folders (every settings file since V80), checks the whole Bash command
(`nucleus-shell.ts`). It allows the shell's read commands, git's read commands, `cd` into the
reach, and joins with `&&`, `||`, `;`, new lines and pipes. With the web on, it also allows `curl`
GET, `gh`'s reads and `git ls-remote`. Every file a command names, and every match of a glob, is
in the checkout or an open workspace's worktree by real path. git's check moved to `git-read.ts`;
Scribe's gate keeps git's read commands only. Decisions 917–922.

**Measured first**: the record (`symbiote/nucleus-activity.jsonl`, 3,746 lines from 2026-10-30)
held 111 Bash calls, of which 17 were refused (15 %), all reads. The brief came a minute after the
refusal of `wc -l docs/PLAN.md && grep … | head -40`. Read, Grep and Glob never failed in 466
calls. So "read tools" meant shell reads on the repository, and the person confirmed it ("I need
him to read files from the current repository").

**Learned**:
- **The gate can expand globs itself**: bash 5.2 never matches `.` or `..` (`globskipdots`), and
  `readdirSync` lists neither. So the gate lists the matches, checks each by real path, and refuses
  one that begins with `-`. Without that, a file named `-o` in the folder would turn `sort *` into
  `sort -o`. A pattern for hidden names is refused anyway, for older shells.
- **A link inside the repository is the way out**: operands are checked by real path, but
  recursion follows links only with `grep -R`, `rg -L`, `find -L`/`-follow`, `ls -L` and `du -L`,
  so those options are refused. `grep -r` and `find` do not follow links found below the folder
  they start in.
- **getopt_long takes a long option's beginning, ripgrep does not**: matching git's way
  (`takes`: either name starting with the other) would refuse `grep --files-with-matches` as
  `--file` and `rg --files` too. GNU tools now match a refused name or its beginning; `rg` matches
  the whole name only.
- **A tilde and a leading `=` expand outside quotes**: bash expands `~` at a word's start and
  after `=` or `:`, and zsh makes `=ls` a program's path. The gate refuses both.
- **A backslash in double quotes expands nothing**: `-G "\[V94\]|\bV94\b"`, refused by the old
  rule, passes now; `$` and backticks in double quotes are still refused.
- **The prompt test pins Nucleus's text by hash** (decision 685). Its length went from 3,452 to
  4,200 characters with the two paragraphs' new words; the pin is updated, with the reason in its
  comment.

**Verification**:
- **Tests**: 197 in `nucleus-shell.test.ts` on a real repository with worktrees, links out and a
  file named `-o`. They cover the record's 11 refused commands, 40 more reads, 88 refusals, 21
  network reads and 33 network refusals, plus the gate, the hook and Alpha Ceph's name. Every git and Scribe test is unchanged.
  The test file was written before the module, but I did not run it red: it could only fail on
  the missing import.
- **Replay** of the record's 111 Bash calls through the built gate, today's folders, the web on:
  - 16 of the 17 refusals pass.
  - The 17th names a worktree of a workspace that has finished since.
  - 9 calls that passed then are refused now. All are `git -C` into worktrees of 4 workspaces
    finished since, which main's gate refuses today too.
- **The built hook** (`dist/nucleus-hook.js`), given hook input on stdin with the person's
  arguments, allowed `wc … && grep … | head`, `git show … | sed -n`, and `gh pr list` with
  `--web`. It refused `cat /etc/hostname`, `sed -i`, `gh pr list` without `--web`, and
  `find -delete` in Alpha Ceph's name. 5 calls took 154 ms.
- `pnpm check`: 240 files, 3,393 tests. `pnpm build`.
- **e2e**: `nucleus-activity.spec.ts` used `curl -sS https://example.com` as its refused call,
  which NU9 allows with the web on. Its refused call is now `cat /etc/hostname` (outside the
  reach); a write (`rm`) would have been filed as a change, not with the reads. Full runs: 429 and
  428 of 431 passed. The other failures differed between runs, and each passed when run alone:
  `look.spec.ts:458` (the sidenav's rows), `hermes.spec.ts:29`, and `workspaces.spec.ts:2293` (a
  merge; 3 of 4 alone). None of them reaches the gate's modules.
- **A test that failed every evening**: Symbiote's merge check failed on `hive-pacing.spec.ts`,
  which expected "goes on at HH:MM". When the fake 5-hour usage window ends after midnight, the
  page rightly says "goes on tomorrow at HH:MM" (`hive-rounds.ts`), so the test failed from about
  19:00 to midnight on any branch. Its three patterns now accept "tomorrow at" too.

Not verified:
- A real Nucleus conversation on Claude Code using the commands.
- The network commands' answers. Only the gate's decisions were checked; nothing was fetched.
