# Spike: push instead of polling

Throwaway code for the spike in `docs/journal/spike-push-instead-of-polling.md`. Nothing here is
built, linted or tested with the repository.

| File | What it is |
|---|---|
| `push.patch` | The prototype: `GET /api/events` (server-sent events: the whole state on connect, then the parts that changed), its triggers (a hook's ping, `fs.watch`, merges and asks from memory, a safety read), the hooks' ping (`SPIKE_PING`), and the viewer reading the stream. Applies to `main` at 93e0e31. |
| `push-shared.patch` | On top of `push.patch`: one stream per browser, not per tab. The tab holding a Web Lock opens it and relays over a BroadcastChannel. |
| `e2e/push.spec.ts` | Cost per minute (requests, bytes, renders, server CPU), how soon a change shows, polling against push; many tabs of one view. |
| `e2e/merge.spec.ts` | How soon a merge's steps show, in the tab that clicked and in another window. |
| `e2e/reliability.spec.ts` | A burst of hooks, a cut stream, a stopped server, a restart on the same port, hidden frames as the nexus has them; its frozen-page and minimized-window cases did not reproduce (see the journal). |
| `e2e/hidden.spec.ts`, `e2e/hidden-tab.spec.ts`, `hidden-tab.mjs` | A page really hidden: Chromium started by hand on Xvfb, two tabs over raw CDP (Playwright keeps its pages visible); the app's window and a checked freeze, which did not reproduce. |
| `hook-time.mjs` | A hook's time with each ping, against a stand-in view: running, hung, gone, a stale record. |
| `fswatch.mjs` | What `fs.watch` sees on a disk: appends, new folders, renames, git's refs; `--windows` writes from cmd.exe to a /mnt/c folder. |
| `fswatch-rename.mjs`, `fswatch-plain.mjs` | Writes by rename, three times: Node's recursive watch misses the third; a plain watch per folder sees 10 of 10. |
| `winrelay.sh` | The stream through WSL2's localhost relay: Windows' `curl.exe` against WSL's own `curl`. |
| `observe-real.mjs`, `analyze-real.py`, `cpu.sh` | Read-only: real agents' hook writes against `claude agents --json --all`, and their timeline; a process's CPU from `/proc`. |
| `tables.py` | The journal's tables from the specs' JSON lines. |
| `results/` | What the journal quotes: the specs' JSON lines (`e2e-superseded.jsonl`: the delay runs redone after two bugs in the spec and the prototype), the hooks' times, the real view's CPU, the real agents' timelines. |

## Running it

```sh
T=$(mktemp -d) && git archive 93e0e31 | tar -x -C $T && cd $T
git apply /path/to/spikes/push-instead-of-polling/push.patch
pnpm install --frozen-lockfile --offline && pnpm build
cp /path/to/spikes/push-instead-of-polling/e2e/*.spec.ts packages/viewer/e2e/
cd packages/viewer
# SPIKE_PUSH: off (polling, as main), both, ping, watch. SPIKE_PING: off, http, nowait, udp, net, netflush.
env -u WAYLAND_DISPLAY SPIKE_PUSH=both SPIKE_PING=netflush SPIKE_RESULTS=$T/results.jsonl \
  npx playwright test e2e/push.spec.ts --timeout=1800000
node hook-time.mjs <main's packages/cli/dist> <the copy's packages/cli/dist> <a symbiote/workspaces folder> 60
```
