# V36 — Images in an agent's terminal

[Index](../PLAN.md) · [Journal](../journal/v36-terminal-images.md)

**Status:** merged into main (2026-10-22, from branch `feature/agent-terminal-accept-images`, a
workspace started in Symbiote; approved in Symbiote at `9a7c9dd`). The spike is in the journal ("V36
spike"); as built and results under "As built (V36)" below.

**Problem** (asked: "Terminals with agents should be able to accept images", with
[Orca](https://github.com/stablyai/orca) as the example). The agent's terminal (a workspace's
Claude Code or Codex, V21 and V27b; Scout's, V35) takes keys and text only. Found by reading the
code of xterm.js 6.0.0, Claude Code 2.1.308 and Codex 0.163 as installed here (the real agents
not run yet: the spike below does that):

| What the person does | What happens today |
|---|---|
| Ctrl+Shift+V, ⌘V or Paste, with a screenshot in the clipboard | xterm.js reads only `text/plain`: an empty bracketed paste (`ESC[200~ESC[201~`) reaches the agent; the image goes nowhere |
| Ctrl+V on Linux and Windows | xterm.js sends ^V (0x16) and cancels the browser's paste. The agent then reads the clipboard of the machine it runs on: Claude Code with `xclip` or `wl-paste` on Linux (neither is installed on this WSL2 machine), PowerShell on Windows. What reaches it here is not measured |
| An image file dropped on the terminal | Nothing: no drop handler. A browser gives the page the file's bytes, never its path |

How the agents take an image in their input:

- **Claude Code 2.1.308**: a pasted text that is a path ending `.png`, `.jpg`, `.jpeg`, `.gif`
  or `.webp` (outer quotes stripped, backslash escapes undone, Windows paths mapped on WSL) is
  read at once, checked to be an image by its bytes, resized, and becomes `[Image #n]` in the
  message being typed.
- **Codex 0.163**: the same for a pasted image path (`attach_image path=`, `[Image #n]`).
- **Orca** (read at `70e997f`): a pasted screenshot is written to the OS temp folder
  (`orca-paste-<time>-<uuid>.png`) and its path bracketed-pasted into the agent's terminal;
  dropped image files are pasted the same way, a path with a space or a shell character
  backslash-escaped (Codex splits a raw path with a space); text in the clipboard wins over an
  image.

**Goal**: in every agent terminal Symbiote draws, pasting an image (Ctrl+V, Ctrl+Shift+V, ⌘V,
the context menu's Paste) or dropping image files on it attaches them to the message being typed,
as the agent's own `[Image #n]`; nothing is sent until the person presses Enter. **Unchanged**:
pasting text, keys, the terminal's other routes; no new dependency.

## Server (`packages/cli/src/terminal.ts`, `server.ts`)

- `POST /api/terminals/<id>/image { data }`, the image as base64, under the write rule as every
  terminal write (JSON, `x-symbiote`, same origin). The bytes must start as PNG, JPEG, GIF or WebP
  (what both agents take), at most 20 MB (this route's body limit only; others stay at 1 MB).
  Saved as `<OS temp>/symbiote-images/<16 random bytes, hex>.<kind>` (folder 0700, file 0600).
  Answers `{ path, text }`: `text` is the path as the agents read it — as is with only safe
  characters, else backslash-escaped (POSIX), as Orca. 404 without such a terminal, 400 not an
  image, 413 too large.
- Images older than a day are removed when the next one is saved, not when `symbiote view`
  exits: a message queued in Claude Code, or Codex's draft, may still need its file (Claude Code
  reads it when pasted; Codex when the turn starts, to measure).

## The page (`packages/viewer/src/AgentTerminal.tsx`, `terminal.ts`)

- **Paste**: a listener on the terminal's box, in the capture phase, sees the paste before
  xterm.js. With text in `text/plain`, xterm.js pastes it as today. Otherwise each image in the
  clipboard is saved through `…/image` and its `text` pasted with `term.paste()`: bracketed
  when the agent asked for it, as xterm.js does for text, and through the same one-write-at-a-time
  queue as keys (V21). The event then stops: no empty paste reaches the agent.
- **Ctrl+V** (Linux, Windows): the browser's paste instead of ^V (`attachCustomKeyEventHandler`):
  the clipboard the page reads is the one the person sees, on any machine, while the agent's own
  read is its machine's. ^V does nothing else in Claude Code or Codex. Ctrl+Shift+V and ⌘V as
  today.
- **Drop**: image files dropped on the terminal, in their order, each as a paste. While files
  are dragged over it, the terminal shows a frame and "Drop to attach" (the style's tokens).
  Other files: "Only images can be attached: PNG, JPEG, GIF or WebP." A drop never opens the
  file in the window (a browser, and Electron, navigate to a dropped file by default).
- **Errors** (too large, not an image, the save failed) in the terminal's error line, cleared by
  the next image attached.
- Pure parts in `terminal.ts`, unit-tested: which pasted or dropped items are images, text over
  image.

## Spike first (after the OK, before the tests)

In a throwaway clone of this repository, with the real Claude Code (`claude attach` on a `--bg`
session, as Symbiote opens it) and Codex (`codex resume --remote` on its app server), a
throwaway model or the cheapest one:

1. A bracketed paste of a PNG's path gives `[Image #1]`; two pastes in one write give two.
2. One turn, "What colour is the square?" with a red square: the model sees the image.
3. The file removed after the paste, before Enter: does the message still carry it?
4. A path with a space, backslash-escaped, is taken by both.
5. Scout (`dontAsk`, Symbiote's gate): the image attached without a tool call.
6. Today's Ctrl+V and Ctrl+Shift+V in Symbiote's window on WSLg with a Windows screenshot in the
   clipboard: what the page's paste event holds, and what reaches the agent.

If `claude attach` does not take a pasted path as an image, this plan stops there and comes back
with what was measured.

## Verification

1. **Tests first** (red before): `packages/cli/test/terminal.test.ts`, saving an image (kinds by
   their bytes, other bytes refused, the size limit, the file's mode, the day's sweep, the
   escaped text); `server.test.ts`, the route (403 without `x-symbiote`, 404 for an unknown
   terminal, 400, 413, the file's bytes equal what was sent); the viewer's `terminal.test.ts`,
   which items are images and text over image.
2. **e2e**: the fake `claude attach` learns bracketed paste: a pasted path to an existing image
   prints `[Image #n]` and records the file's bytes. A pasted image (a `ClipboardEvent` holding a
   PNG), two dropped images, Ctrl+V with an image; a text paste as today; a dropped text file
   refused; Scout's terminal too. Every spec as before.
3. **Real agents**, through `symbiote view` on the throwaway clone: a workspace's Claude Code and
   Codex terminals and Scout's, each with a pasted and a dropped image answered by the model; one
   Windows screenshot pasted in Symbiote's window here. Everything made removed after.
4. **Viewer**: the drop frame's screenshot, dark and light; the xterm.js chunk and the main bundle
   against `main`'s; `/history` first paint unchanged (nothing loads before a terminal opens).
5. No analysis code changes: `pnpm check`, `pnpm build`, `pnpm test:e2e`; no regression sets.

**Risks**

| Risk | Mitigation |
|---|---|
| `claude attach` or `codex resume --remote` does not take a pasted path as an image | The spike first; the plan stops there if so |
| Screenshots left on disk | 0600 in a 0700 folder, removed after a day; said in the README |
| Ctrl+V no longer sends ^V | The page does what the agent's ^V did, from the clipboard the person sees; said in the README |
| A large image | 20 MB at most; both agents resize what they send |
| Windows and macOS not run | Paths escaped as Orca does; said in the results |
| Another site saves files through the route | The write rule; terminal IDs unguessable (V21) |

**Order**: the spike; then the server (tests, route), then the page (tests, e2e); then the real
agents, screenshots, README.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V36 | Images in an agent's terminal | The spike; `…/image` and the images folder; paste, Ctrl+V and drop in `AgentTerminal`; the fake's `[Image #n]`; README. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 242 | How an image reaches the agent | **Saved by Symbiote's server, its path pasted into the agent's terminal: the agent's own attachment** | Claude Code and Codex both take a pasted image path (read in their code); Orca does the same. No protocol of Symbiote's own; nothing for the agent to learn. |
| 243 | Where images are kept | **The OS temp folder's `symbiote-images/`, removed after a day**. As built: **Symbiote's cache, `<cache>/images/` (folder 0700, files 0600), removed after a day** | Not the worktree (git would see them, an agent could commit them); not kept for ever; Orca uses the temp folder. As built: on Linux the temp folder is shared by the machine's users, and a `symbiote-images` folder another user made first would be theirs; the cache is the person's own. A day, because Codex reads the file when the message is sent (spike). |
| 244 | Ctrl+V on Linux and Windows | **The page's paste, text or image, instead of ^V** | The page reads the clipboard the person sees; the agent's own read missed it here (no `xclip`, `wl-paste`) and on a browser on another machine. |
| 245 | A clipboard with text and an image | **Text** | A copied spreadsheet range or a web page carries both, and was text to the person; Orca's rule. |

**Not in V36 (later)**: an Attach button with a file picker; non-image files dropped as paths
(a browser gives no path); images in the Thread's box (V18c) or the start page's brief; images the
agent prints, drawn in the terminal (sixel, iTerm's inline images).

## As built (V36)

- **Images in Symbiote's cache**, not the OS temp folder (decision 243 as built): `/tmp` is
  shared on Linux. `SYMBIOTE_CACHE_DIR` moves them with the rest of the cache; e2e runs keep
  theirs in their own.
- **The spike answered five of its six questions.** The sixth, a Windows screenshot pasted in
  Symbiote's window on WSLg, needs the person's clipboard: not run.
- **Codex needs the file until the message is sent**: removed after the paste and before Enter,
  Codex said "Failed to prepare image: … No such file or directory (oserror 2)" and sent nothing;
  Claude Code had read it at the paste. Hence a day, not removal at exit.
- **The 413 is answered before the body is read**, from `Content-Length`, and the rest of the
  request is drained: a request destroyed mid-body gives the page a network error, not the words.
  Other routes keep their 1 MB limit; `written` takes the limit.
- **The drop frame covers the whole terminal**, its listeners on the terminal's root: the frame is
  a sibling of the box xterm.js draws in, whose children React must not share.
- **Ctrl+V tested for real** in e2e: Chromium's clipboard written through the async Clipboard API,
  then a key press. With the key handler removed, that step fails ("[Image #4]" never drawn).
- **Enter in the same write as the text before it does not submit** in Claude Code 2.1.308: a
  script that typed with no delay and pressed Enter at once left the message in the input (the
  page joins keys typed while a write is on its way, V21). Typed 30 ms a key and Enter 0.8 s later,
  as a person types, it was sent. Not V36's, and not changed. One case not explained, as V21's:
  Enter alone on a draft restored by reopening the terminal did not submit; Enter from the next
  client did.

**Results.** Tests first, red for the right reason: `terminal.test.ts` 4 (the functions missing),
`server.test.ts` 1 (405, no route), the viewer's `terminal.test.ts` 6, and the e2e workspace test
("[Image #1]" never drawn). `pnpm check` 1,244 tests (11 new). e2e: the new workspace test (a
pasted image, two dropped, a text file refused, text over image, Ctrl+V from the real clipboard,
all sent with Enter) and Scout's first test extended (a pasted image, the checkout clean);
e2e 189 of 189 (V35: 188; the first full run, under the real agents' load, lost one `shell.spec` focus test, which then passed 3 of 3 alone).

With the real agents through the page in Chromium (1440 × 900), on a throwaway repository with
`symbiote view` from this build; one 64 × 64 PNG pasted (red) and two dropped (green, and blue
from a folder with a space in its name), then "Name the colour of each image":

| Terminal | Agent | Drawn | Answer | Saved as |
|---|---|---|---|---|
| A workspace's | Claude Code 2.1.308, Haiku 5.5 (`claude attach`) | `[Image #4] [Image #5] [Image #6]` | "1. Red 2. Green 3. Blue" | three PNG blocks in the transcript, each `[Image: source: ~/.cache/symbiote/images/<hex>.png]` |
| A workspace's | Codex 0.163, GPT-6-Luna (`codex resume --remote`) | `[Image #1] [Image #2] [Image #3]` | "Red, green, blue." | trust asked first and answered in the page |
| Scout's | Codex 0.163 | `[Image #1] [Image #2] [Image #3]` | "Red, green, blue." | |

No page errors, no error line. The images folder was `drwx------`, its files `-rw-------`. The
drop frame, dark and light: the same, the terminal being black in both. Cost: the main bundle
653,153 → 655,401 bytes (+2,248; +848 gzipped), the stylesheet +294; the xterm.js chunk the same
331,178 bytes, and nothing new loads before a terminal opens. Cleaned up after: both workspaces
(Clean up), Scout's conversations, Claude Code's records of the folders (`claude purge`), the two
trust entries Codex wrote, the repository, the saved images.

Not verified: a screenshot from the Windows clipboard in Symbiote's window (WSLg); JPEG, GIF and
WebP with the real agents (PNG only; the kinds are unit-tested); an image of megabytes with the
real agents; macOS and Windows, where `pastedPath`'s escaping is untested; Firefox and Safari;
`/history` first paint, not measured again (the bundle +0.3 %).
