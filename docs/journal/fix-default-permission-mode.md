# Journal: Fix — normal mode's Ask asks: the permission mode passed to Claude Code by its name

[Index](../JOURNAL.md)

## Fix — normal mode's Ask asks (2026-11-14, branch `fix/default-permission-mode`)

Asked: a normal-mode workspace started with `default`, the person's "ask", ran in `auto`. HV10a's
run A ran `env`, `gh`, `git ls-remote`, `ssh` and `curl` unasked. Normal mode is human-centric:
Ask must ask.

**Learned**:
- **`auto` is Claude Code's own default now.** Claude Code 2.1.325 holds the notice "Auto mode is
  now Claude Code's default permission mode", shown once (`hasSeenAutoDefaultNotice: true` in
  `~/.claude.json`), and so does every installed version back to 2.1.319. The person's settings
  did not cause it. `~/.claude/settings.json` sets no `permissions.defaultMode`, and there is no
  `settings.local.json` or managed settings file. Symbiote's `claude-settings.json` holds only
  hooks. Symbiote passed no `--permission-mode` for `default` (`claude-code.ts:457`), so the
  session started in `auto`.
- **Reproduced on this workspace itself.** Symbiote started it with `permissionMode: "default"`.
  Its transcript read `auto` on all 20 lines that carry a mode.
- **`manual` is a new name for `default`.** Claude Code's modes inside are still `acceptEdits`,
  `auto`, `bypassPermissions`, `default`, `dontAsk` and `plan`. `--permission-mode manual` maps
  to `default`, and the parser takes both. `--help` lists only `manual`, and the session's own
  title for it is "Manual". The transcript records `default`. All five installed versions,
  2.1.319, 2.1.321, 2.1.322, 2.1.323 and 2.1.325, list `manual`. `claude --help` takes 0.07 s.
- **Accept edits runs more than edits.** Claude Code 2.1.325 runs `mkdir`, `touch`, `rm`,
  `rmdir`, `mv`, `cp` and `sed` unasked in `acceptEdits`. The Start page's tip says so.
- **A resume keeps the mode.** `claude --bg --resume` with no flag, as Symbiote resumes,
  continued in `default` and asked again.
- **Codex has no such gap.** The person picks no mode for it. Symbiote passes
  `-s workspace-write` by name on every start and resume.

**Fixed**: `start()` and `startPageAgent()` (`packages/cli/src/claude-code.ts`) always pass
`--permission-mode`. Symbiote's `default` goes by the name the installed Claude Code lists for
the mode that asks: `manual` where `claude --help` lists it, else `default` (`askingMode`,
`parsePermissionModes`). `default` is also the fallback when the help cannot be read, since every
version measured takes it. The help is read once, shared with the effort levels. Symbiote keeps
`default` as its own value in records, `config.json` and the API, so nothing is migrated. The
Start page names it **Ask** instead of "Claude Code's default", and the Permissions choice's tip
says what each mode does. `auto` for Hive's writers and Scribe's asking mode are passed the same
way. `resume()` is unchanged.

**Verification**: tests first, red for the right reason. The start test expected no flag for
`default`. Its new form, and a test of 2.1.325's help, a help from before `manual` and one that
cannot be read, failed with `--bg` where the mode should be, and `parsePermissionModes` was not a
function. A real run used a trusted scratch repository and the same prompt, one `curl`:

| Start | Arguments | Transcript's mode | The `curl` |
|---|---|---|---|
| `main`'s (no flag) | none | `auto` (4 lines) | ran unasked |
| This branch's built `start()` | `--permission-mode manual` | `default` (3 lines) | waited: session `blocked`, "permission prompt" |
| Stopped, then `resume()` with no flag | none | `default` (5 lines) | the next one waited again |
| With Symbiote's hooks | `--permission-mode manual` | `default` | the thread recorded `asks` for Bash `curl …` |

The sessions were stopped and removed, and the scratch folder deleted.

`pnpm check` ran 3,729 tests in 270 files, and `pnpm build` passed. `pnpm test:e2e` passed:
the viewer 488 of 488 and the nexus 32 of 32. The first full run failed one test, Scribe's spec,
which expected `--permission-mode default`. It now expects `manual`, the name the fake agent's
help lists, as 2.1.325's does. `workspaces.spec` checks that Ask is picked, its tip, and
`--permission-mode manual` in the start. Screenshots of the Start page in both themes show
"Ask" and its tip above the choice.

Not verified: a Claude Code version from before `manual`. None is installed, so that path is
tested only with a help written in that form.
