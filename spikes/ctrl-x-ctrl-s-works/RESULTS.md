# Results: Ctrl+X Ctrl+S (send now) in the agent terminal

Measured 2026-10-25 with Claude Code 2.1.310, xterm.js 6.0.0, node-pty 1.1.0, Chromium (Playwright),
Symbiote at `da991b5`.

## Answer

**Yes, Ctrl+X then Ctrl+S works in Symbiote's agent terminal.** In 8 of 8 trials and in the real
UI, the message waiting behind a running command reached Claude Code 0.34–1.04 s after the second
key, and Claude Code's answer was written 1.5–2.7 s after that key. With no keys pressed, the same
message waited 18.5–24.5 s, until the command ended.

What "send now" does in 2.1.310: it **moves the running command to the background** ("it was not
interrupted"), the turn takes the waiting message in and answers it, and the command's end comes
later as a turn of its own. Nothing is killed.

**Ctrl+Enter does not work** in the agent terminal. Claude Code binds it to send now too, but
xterm.js sends it as a plain Enter (`0d`), so the message waits as with no key at all. Claude Code
knows this: it hints Ctrl+Enter only on terminals that confirm the kitty keyboard protocol, which
xterm.js does not, so it shows "ctrl+x ctrl+s to send now".

## Where the hint comes from

Claude Code 2.1.310's default bindings (in its binary): `"ctrl+x ctrl+s": "chat:sendNow"`,
`"ctrl+enter": "chat:sendNow"`, `"ctrl+x enter": "chat:queueSubmit"`. The hint picks the binding to
show with `X8t()`: Ctrl+Enter only when the terminal confirmed `kittyKeyboard`, outside tmux and
screen. No `~/.claude/keybindings.json` here, so the defaults apply. Under the waiting message it
draws "ctrl+x ctrl+s to send now", and in the prompt "Press up to edit queued messages".

## Each layer

| Layer | Checked how | Result |
|---|---|---|
| xterm.js key → bytes | `bytes.spec.ts`, Chromium | Ctrl+X → `18`, Ctrl+S → `13`, Ctrl+Enter → `0d`, Enter → `0d` |
| Browser defaults (Cut, Save page) | same: `keydown` read after dispatch | `defaultPrevented: true` for every Ctrl+X and Ctrl+S; no `cut` or `input` event |
| Symbiote's page keys | code: `AgentTerminal.tsx:229`, `ui/keys.ts` | only Ctrl+V is left to the browser; page shortcuts skip any key with Ctrl |
| Viewer → server | same spec: the POSTs | one `POST /api/terminals/<id>/in` per key, `{"data":"\u0018"}` then `{"data":"\u0013"}`; 7–156 ms apart as pressed |
| Server → pty → program | byte logger as `attach` | each key one read on stdin, gaps kept (7, 104, 156 ms) |
| Line discipline (^S = XOFF?) | `stty -a -F` on the attach process's pty | starts `ixon`; with Claude Code reading it, `-ixon -icanon` (4 of 4 sessions) |
| Desktop app (Electron) | code only: `policy.ts` `keyAction`, `main.ts` `setMenu` | takes only zoom and devtools keys; no menu on Linux and Windows; macOS menus use ⌘. **Not run.** |

## Trials: the real Claude Code (`real.mjs`)

Each trial: in one `claude --bg` session on haiku, through `claude attach` in node-pty, ask for a
30 s command; once it runs, type a second message (it waits, the hint shows); 2 s later send the
variant's bytes. Times are from the first byte sent. "Moved" means the command's result was "moved
to the background".

| Variant | Bytes | n | Message taken in | Answered | Command |
|---|---|---|---|---|---|
| none (control) | — | 2 | 24,450; 18,539 ms | 25,586; 19,667 ms | ran to its end |
| `^X^S` in one write | `18 13` | 2 | 341; 457 ms | 1,819; 1,573 ms | moved |
| `^X`, 10 ms, `^S` | `18`,`13` | 2 | 471; 455 ms | 1,582; 1,484 ms | moved |
| `^X`, 150 ms, `^S` (as a person types) | `18`,`13` | 2 (+1†) | 630; 543 ms (†432) | 1,669; 1,735 ms (†1,700) | moved |
| `^X`, 1.5 s, `^S` | `18`,`13` | 2 | 2,431; 2,535 ms (931; 1,035 after `^S`) | 3,624; 3,585 ms | moved |
| Ctrl+Enter | `0d` | 2 | 18,582; 18,539 ms | 19,620; 19,513 ms | ran to its end |

The press came 6.3–12.3 s into the 30 s command; the controls' times are the rest of the command.
A 1.5 s pause between the two keys still counts as the chord. No trial showed "Send now isn't
available here" (the attach client's message when the session cannot do it), and none wrote
"Request interrupted".

† Trial `mvo9btkp-1`, an earlier driver: its two times were measured wrong; the figures in
brackets are read from its transcript (`note` line in `data/real.jsonl`). Trial `mvo9ai3b-1` is
not counted: Claude Code refused a bare `sleep 30` ("Blocked: standalone sleep"), so no command
was running when the keys came. Hence `node -e setTimeout` in the rest.

## The whole way once: `symbiote view` (`ui.spec.ts`)

A scratch repo in `/tmp`, its own Symbiote cache and config folders, the workspace started from
the Start page, the agent on haiku. In the workspace's Terminal tab: the 30 s command, a waiting
message, then `Control+x`, 150 ms, `Control+s` pressed in Chromium.

- Hint drawn in the terminal: "ctrl+x ctrl+s to send now", "❯ Press up to edit queued messages"
  (`data/ui-queued.png`).
- Command moved to the background 1,035 ms after the press; message taken in at 1,049 ms;
  answered at 2,863 ms (`data/ui-after.png`: the answer, "1 shell still running").
- The attach process's pty: `-ixon -icanon`. No page errors.

## Recommendation

1. **Nothing to fix.** The keys work as Claude Code's hint says, in the browser viewer and, by its
   code, in the desktop app.
2. **Use Ctrl+X Ctrl+S, not Ctrl+Enter**, in the agent terminal. There is no need to hurry: the two
   keys can be 1.5 s apart.
3. **Keep Ctrl+X and Ctrl+S free in the terminal.** If Symbiote ever gives Ctrl+S a meaning (save a
   draft, say) it must leave the terminal's keys alone, as it does Ctrl+R. Optional: a check of a
   few lines in `workspaces.spec.ts`'s terminal test (Ctrl+X, Ctrl+S reach the fake as `18 13`)
   would catch that. Not done here: the brief asked for an answer, not a change.
4. Not worth doing: making Ctrl+Enter work would mean xterm.js sending a distinct sequence (kitty
   keyboard protocol or a custom key handler), plus Claude Code trusting it. That is a bigger
   change for a key the hint does not offer.

## Not verified

- The desktop app was not run: its part is read from code. macOS was not run (there Ctrl, not ⌘,
  still sends `18 13` by xterm.js's rules, but unmeasured).
- Only Chromium. The browser's own Save dialog was not seen (headless); `defaultPrevented` on
  Ctrl+S is what keeps it shut.
- One Claude Code version (2.1.310). The behavior (move the command to the background) is that
  version's; older ones may stop the turn instead.
- Codex is not covered: it has no Ctrl+X Ctrl+S. Its waiting messages go in after the next tool
  call, and Esc interrupts and sends (from its binary's strings, not run).
- The `real.mjs` sessions ran with `--strict-mcp-config` and `agentPushNotifEnabled: false`, not
  as Symbiote starts them; the UI run started its agent as Symbiote does (plus a project setting
  allowing `node -e` and the same notification setting).

## Cost and leftovers

Four haiku sessions, 41 API requests in their transcripts (32 + 3 + 3 + 3). That is more than the
15–20 turns planned, because every send-now trial has a third turn when the moved command ends, and
15 trials ran. All four sessions are stopped, not removed (`claude agents` lists them: `sendnow-*`
and `feature/send-now-ui`). Their full transcripts stay in
`~/.claude/projects/-tmp-symbiote-sendnow-*`. The scratch repos are in `/tmp/symbiote-sendnow-UE0b`
and `/tmp/symbiote-sendnow-ui-SfvBki` (`/tmp` may be cleared on reboot). The copies here keep only
the user, assistant, queue and system entries: the rest held the session's system prompt and
account details.
