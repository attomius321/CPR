# Spike: does Ctrl+X Ctrl+S (send now) work in the agent terminal?

Claude Code 2.1.310 shows "ctrl+x ctrl+s to send now" under a message that waits behind a running
turn. This folder holds the experiments that checked whether those keys work in Symbiote's agent
terminal (xterm.js 6.0.0 in the viewer → `POST /api/terminals/<id>/in` → node-pty →
`claude attach <id>` on a `claude --bg` session), and the data they measured. The answer and the
numbers are in [RESULTS.md](RESULTS.md).

| File | What |
|---|---|
| `bytes.spec.ts` | Chromium → agent's stdin: the bytes each key sends, the requests, whether the page keeps the browser's Cut and Save. The e2e harness's fake agent, its `attach` swapped for a byte logger. No account use. |
| `real.mjs` | The real Claude Code as Symbiote runs it (`--bg`, then `attach` in node-pty, `xterm-256color`), sent the bytes the terminal sends while a message waits behind a 30 s command. `trust <repo>`, `run <repo> [variant…]`. |
| `ui.spec.ts` | The whole way once: `symbiote view` with the real Claude Code, a workspace started from its page, Ctrl+X, Ctrl+S pressed in Chromium. |
| `timeline.cjs` | A trial's transcript as a timeline: `node timeline.cjs data/real-transcript-<tag>.jsonl <pressedAt>`. |
| `playwright.config.ts` | The viewer's Playwright config pointed here. |
| `data/` | Everything measured (below). |

## Data

- `bytes.json`, `bytes.png` — step 1: per key, the stdin reads (hex) and their gaps; the POSTs; the
  page's `keydown`s with `defaultPrevented`; the logger's `stty -a` before and in raw mode.
- `real.jsonl` — steps 2–3: one `stty` line per session (the attach process's terminal), one
  `trial` line per trial, `note` lines for trials measured wrong (kept, said why).
- `real-transcript-<tag>.jsonl` — each trial's slice of the session's transcript (from
  `~/.claude/projects/-tmp-symbiote-sendnow-*/<session>.jsonl`).
- `real-screen-<tag>.txt` — what `attach` drew during the trial, escapes stripped.
- `real-attach-<session>.raw` — a session's whole `attach` output, escapes kept.
- `real-run.log` — the run's console.
- `ui.json`, `ui-*.png`, `ui-transcript.jsonl` — step 4.
- `trust-screen.txt`, `spike-settings.json` — the scratch folder's trust prompt; the settings
  passed to the test sessions (`agentPushNotifEnabled: false`).

## Rerun

```sh
pnpm install --frozen-lockfile && pnpm build      # from the repo root
cd packages/viewer
env -u WAYLAND_DISPLAY npx playwright test --config ../../spikes/ctrl-x-ctrl-s-works/playwright.config.ts bytes
R=$(mktemp -d /tmp/symbiote-sendnow-XXXX); (cd $R && git init -q && echo x > a && git add . && git -c user.email=a@b -c user.name=a commit -qm i)
cd ../../spikes/ctrl-x-ctrl-s-works
node real.mjs trust $R && node real.mjs run $R none one-write gap-150ms
```

`real.mjs` and `ui.spec.ts` use the Claude account of whoever runs them (haiku, two short turns a
trial). Run them from a shell with no `CLAUDE*` variables of a running session, or as here: the
scripts drop them.
