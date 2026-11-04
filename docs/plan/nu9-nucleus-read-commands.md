# NU9 — Nucleus's and Alpha Ceph's read and network commands

[Index](../PLAN.md) · [Journal](../journal/nu9-nucleus-read-commands.md)

**Status:** planned (2026-11-04), on branch `feature/nucleus-and-aplha-ceph-tools` (the
workspace's, from `main` at `3266fde`).

**Problem** (the brief: "Nucleus and alpha ceph should have read tools"; the person's additions:
"And network capabilities", "I need him to read files from the current repository, when I ask him
to"). Nucleus's gate (V35, decision 236; V80, decision 598) lets Claude Code's Bash run git's read
commands only, one at a time, piped into `head`, `tail`, `wc` or `grep` at most. Its record
(`symbiote/nucleus-activity.jsonl`, 3,746 lines from 2026-10-30) holds 111 Bash calls; the gate
refused 17 (15 %), every one a read:

| Refused | Calls | Examples |
|---|---|---|
| git, with a pipe or a chain the gate refuses | 9 | `git show 3e31222:docs/plan/v82-hive-mode.md \| sed -n '24,46p;156,164p'`, `git grep … main -- docs/plan \| sort -u \| tail -5` |
| `wc` | 2 | `wc -l docs/PLAN.md && grep -nE "V94\|…" docs/PLAN.md \| head -40` (a minute before this brief) |
| `grep` | 2 | `grep -nE '^/\* \|…' spikes/hive-redesign/src/kit.css \| head -80` |
| `ls`, `tail`, `cd`, `date` | 4 | `tail -c 3000 symbiote/hive/feature/hive-pull-requests.jsonl`, `cd docs/plan && grep -n -m3 …` |

Read, Grep and Glob never failed (466 calls). On the network, WebSearch (20 calls) and WebFetch (15)
work while `nucleus.web` is on (decision 592); GitHub (pull requests, CI runs, issues), an HTTP API
and a remote's branches cannot be read: `gh`, `curl` and `git ls-remote` are refused.

Alpha Ceph is Nucleus while Hive is on, with the same gate under its name (decision 686): one
change serves both.

**Goal**: Nucleus and Alpha Ceph run the shell's read commands on the repository's files — the
checkout and the open workspaces' worktrees, the reach Read has (decision 597) — joined and piped
as an agent writes them, and, with the web on, read GitHub and HTTP. Nothing that writes a file,
runs another program or reads outside that reach. Scribe's gate and Codex's Nucleus are unchanged.

## The commands (`nucleus-shell.ts`, called by `nucleus-gate.ts`)

The gate still runs nothing: it parses the command as the shell would and decides.

- **Joining**: `&&`, `||`, `;`, a new line and `|` between allowed commands; each part checked.
  `cd <folder>` alone, into the reach; the parts after it are checked from there (after `;` or `||`
  from both folders). Refused as before: `$`, backticks, `>` and `<` but `2>&1`, `2>/dev/null` and
  `>/dev/null`, `&`, `(`, `{`, `!`, `#`, `[`; and a `~` the shell would expand.
- **Read commands**, their options that write, run a program, follow links out or read another
  file refused:
  - `cat`, `head`, `tail` (no `-f`, `-F`, `--follow`), `wc` (no `--files0-from`), `ls` (no `-L`),
    `stat`, `du` (no `-L`, `-X`, `--files0-from`), `file` (no `-f`, `-m`, `-C`), `nl`, `cut`, `tr`,
    `uniq` (one file at most: a second is its output), `basename`, `dirname`, `realpath`, `pwd`,
    `date` (a `+format` only), `echo`;
  - `grep` (no `-R`, `-f`, `--exclude-from`), `rg` (no `--pre`, `-z`, `-L`, `-f`, `--ignore-file`);
  - `find` (no `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, `-fprint*`, `-fls`, `-L`,
    `-follow`, `-files0-from`);
  - `sed`, its script only line or `/pattern/` addresses with `p`, `d`, `q`, `=` or `s///` without
    `w` or `e`; no `-i`, `-f`;
  - `sort` (no `-o`, `-T`, `--compress-program`, `--files0-from`, `--random-source`);
  - `jq` (no `-f`, `-L`, `--rawfile`, `--slurpfile`; a filter without `env`, `$ENV`, `import`,
    `include`: the process's environment holds tokens).
  - Every other program is refused: `awk`, `xargs`, `tee`, `sh`, `node`…
- **Where**: every file or folder a read command is given is in the checkout or an open
  workspace's worktree, by its real path, with no `..` (Read's rule, decision 597). Relative paths
  from the hook's `cwd`. The gate expands `*` and `?` itself and checks each match; a match that
  begins with `-` is refused (a file must not become an option).
- **git**: as before (decisions 236, 598), anywhere in the command; piped into any read command;
  after `cd` into a worktree, `git diff` is refused as with `-C` (it rewrites the worktree's index).
- **The network**, only with the web on (`--web`, from `nucleus.web`):
  - `curl`: `http(s)://` URLs, GET or HEAD; options from a list (`-s`, `-S`, `-L`, `-I`, `-i`, `-f`,
    `-v`, `-k`, `-G`, `-g`, `-H`, `-A`, `-e`, `-m`, `--connect-timeout`, `--retry`, `--compressed`,
    `-w`, `--max-redirs`, `-r`, `--url`, `-X GET|HEAD`); no value from a file (`@`). Localhost is
    allowed (the person's answer): `symbiote view`'s API changes nothing on a GET.
  - `gh`: `pr view|list|diff|checks|status`, `issue view|list|status`, `run view|list`,
    `release view|list`, `repo view`, `workflow view|list`, `search …`, `status`, and `api` with GET
    only (no `-X` other than GET, no `-f`, `-F`, `--input`, no `graphql`); no `--web`; a `--jq` or
    `--template` without `env`. They read with the person's `gh` login.
  - `git ls-remote` with a remote's name or an `https://`, `ssh://` or `git@` URL; no
    `--upload-pack`.

A settings file written before V80 gives the gate no reach: there it keeps git's read commands
only, as before.

## The words

- The refusal says what may run and why this command may not; the allowed call is recorded with
  its reason ("a read command (NU9)", "a read on the network (NU9)"); git's alone as before.
- Nucleus's prompt (`prompts.ts`, shared with Codex's) lists what it runs. Codex's read-only sandbox
  already runs any read and keeps the network off (decision 593): unchanged.
- `docs/reference/configuration.md` says what Nucleus runs.

## Verification

1. **Unit tests, red first** (`nucleus-shell.test.ts`, `nucleus-gate.test.ts`), on a real
   repository with worktrees and links out (V80's fixture):
   - the 17 refused commands of the record, on the fixture's files, allowed;
   - refused: `find -delete`, `sed -i`, `sed 'w /tmp/x'`, `sed 'r /etc/passwd'`, `sort -o`,
     `cat /etc/passwd`, `cat ../x`, a link out, `ls .*`, `cd /tmp && ls`, `cat ~/.bashrc`, `$(…)`,
     `>`, `&`, `awk`, `xargs`, `tail -f`, `jq -n env`, `grep -R` through a link, a glob matching
     `-o`, a finished workspace's worktree; `cd <worktree> && git diff`;
   - the network: `curl -d`, `curl -o`, `curl file://`, `curl -K`, `gh api -X POST`, `gh api -f`,
     `gh api graphql`, `gh pr merge`, `gh pr view --web` refused; every network command refused
     without the web;
   - every git test and every Scribe test as on `main`.
2. **Replay**: the new gate over every Bash call of the record, the before and after counts, each
   changed decision read.
3. **The hook as Claude Code runs it**: `dist/nucleus-hook.js` with hook input on stdin.
4. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| An option of a GNU tool the lists miss writes or reads elsewhere | Lists of refused options per command, checked with the tools' manuals; an unknown option's value is checked as a path, so a miss refuses |
| A link inside the repository points out | Real paths for every operand and match; `-R`, `-L`, `-follow` refused |
| Network commands send what Nucleus read to a server | As WebFetch already can (decision 592); off with `nucleus.web: false` |
| `gh` reads with the person's login | Reads only; the person's answer ("Gh included") |

## Milestones

| # | Milestone | Output |
|---|---|---|
| NU9 | The shell's reads, the network's, the words | tests, replay, docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 917 | What Nucleus runs in Bash | **The shell's read commands listed above, their writing options refused, joined by `&&`, `\|\|`, `;`, new lines and pipes, `cd` into the reach; git's as before** (replaces 236's "git's read commands only" for Nucleus and Alpha Ceph; Scribe keeps 236) | 15 % of its Bash calls were refused reads; the brief |
| 918 | Where they read | **The checkout and the open workspaces' worktrees, by real path, no `..`; globs expanded by the gate, a match beginning with `-` refused; options that follow links refused** | Read's reach (597); a shell command must not reach further than Read |
| 919 | git after `cd` | **The folder `cd` gives counts as `-C`: in a worktree, `git diff` refused** | 598's reason holds whichever way git gets there |
| 920 | The network | **`curl` (http(s), GET or HEAD), `gh`'s read commands, `git ls-remote`, only with the web on; localhost allowed** | The person's additions ("And network capabilities", "Gh included", loopback "No"); the web's switch is 592's |
| 921 | A settings file from before V80 | **No reach: git's read commands only, as before** | Paths cannot be checked without the checkout |
| 922 | Codex's Nucleus | **Unchanged; the shared prompt lists the commands** | Its sandbox already reads anything and keeps the network off (593) |

**Not in NU9**: Codex's network; reads outside the repository (the cache, the logs); `awk`, `xargs`.
