# Journal: V36 — Images in an agent's terminal

[Index](../JOURNAL.md) · [Plan](../plan/v36-terminal-images.md)

## V36 spike — what the agents take as an image, through Symbiote's terminals (2026-10-22, branch `feature/agent-terminal-accept-images`)

Asked: "Terminals with agents should be able to accept images", with Orca as the example. Read
first: Orca (`stablyai/orca` at `70e997f`) saves a pasted screenshot in the OS temp folder and
bracketed-pastes its path into the agent's terminal; Claude Code 2.1.308's code reads a pasted
path ending `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` as an image (outer quotes stripped,
backslash escapes undone); Codex 0.163's binary has `attach_image path=` and `[Image #`. xterm.js
6.0.0 pastes only `text/plain`, so a screenshot reaches the agent as an empty bracketed paste, and
Ctrl+V sends ^V. Then run through `symbiote view` itself (`main`'s build, a throwaway repository
under `~/projects`, Haiku 5.5 for Claude Code), each paste written to the terminal's `…/in`.

**Learned**:
- **Both agents attach a pasted path, through Symbiote's clients.** In Scout's terminal (`claude
  attach`, `dontAsk`): one bracketed paste of a PNG's path gave `[Image #1]`, two in one write gave
  two, a path with a space backslash-escaped was read whole; the transcript held three image
  blocks and the model answered "Red, green, blue." The same with Codex (`codex resume --remote`):
  `[Image #1][Image #2][Image #3]`, three `input_image` items in its rollout, "Red, green, blue."
- **Claude Code reads the file at the paste, Codex at the send.** Removed after the paste and
  before Enter: Claude Code's model still answered "Yellow"; Codex said "Failed to prepare image:
  … No such file or directory (oserror 2)" and sent nothing. An image must outlive the message.
- **Both clients turn bracketed paste on** (`ESC[?2004h`): xterm.js brackets what the page pastes.
- **`claude --bg` needs the folder's own trust entry**: `/` and `~/projects` in the trusted list
  did not count ("Workspace not trusted. Run `claude` in … once"). Trust was accepted once in the
  throwaway folder (the down arrow, then Enter: the default is "No, exit"), as V21 and V35 did,
  and purged after.
- On Linux the OS temp folder is shared by the machine's users: the images went to Symbiote's
  cache instead (decision 243 as built).

**Not tested**: what a Windows screenshot pasted in Symbiote's window on WSLg gives the page (the
person's clipboard); macOS and Windows. Cleaned up: the sessions, the trust entries (Claude Code's
by `claude purge`, Codex's two removed from its configuration), the repository.

## V36 — images in an agent's terminal (2026-10-22, branch `feature/agent-terminal-accept-images`)

Asked: terminals with agents accept images. A screenshot pasted (Ctrl+V, Ctrl+Shift+V, ⌘V) or
image files dropped on any agent terminal (a workspace's Claude Code or Codex, Scout's) are saved
by `POST /api/terminals/<id>/image` in `<cache>/images/` and their paths pasted, which the agent
attaches as `[Image #n]` to the message being typed; nothing is sent before Enter. Decisions
242–245.

**Learned**:
- **The first real run "failed" for the script's reason.** Playwright typed the question and
  pressed Enter at once: the page's key queue (V21) sent the text's tail and the Enter in one
  write, and Claude Code 2.1.308 kept it as typed text. Typed 30 ms a key with Enter 0.8 s later,
  the message with its three images was sent and answered. The page's own writes, logged:
  `S`, `ay ok.`, `\r`, each answered 204.
- **The drop frame cannot live in xterm.js's box**: React and xterm.js would share its children.
  It is a sibling over the whole terminal, taking no pointer, the listeners on the terminal's root.
- **A 413 needs the body drained**: a request destroyed mid-body gives the page "Failed to
  fetch". The image route refuses by `Content-Length` before reading and reads the rest away.
- **A mutation check for Ctrl+V**: with `attachCustomKeyEventHandler` removed, the e2e's Ctrl+V
  step failed (the fake typed ^V, no `[Image #4]`); restored, it passed. Chromium's clipboard,
  written through the async Clipboard API, is what a real Ctrl+V pastes in a headless run.
- **The whole suite under load**: run while the real agents were driven, `shell.spec`'s "a card
  keeps the focus when its workspace moves to another group" failed once, then passed 3 of 3
  alone (V35 recorded a like `shell.spec` focus failure).

**Verification**: tests first, red for the right reason (CLI 4, server 1, viewer 6, e2e 1); `pnpm
check` 1,244 tests; e2e 189 of 189. With the real Claude Code 2.1.308 and Codex 0.163 through the page
in Chromium: a workspace's Claude Code, a workspace's Codex and Scout's Codex each attached one
pasted and two dropped PNGs and named their colours (PLAN.md's V36 results). Bundle: +2,248 bytes
(+848 gzipped), the xterm.js chunk unchanged. Cleaned up: the workspaces, Scout's conversations,
Claude Code's records (`claude purge`), Codex's trust entries, the repository, the saved images.
Not verified: a screenshot from the Windows clipboard in Symbiote's window (WSLg); JPEG, GIF and
WebP with the real agents; macOS and Windows; Firefox and Safari; `/history` first paint.

Merged into main (2026-10-22) by Symbiote's merger, from the approved `9a7c9dd`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md`, resolved in the merge.
