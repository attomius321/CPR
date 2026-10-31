# Hive's question: three candidates

A throwaway prototype that drew three robotic heads for Hive's question ("Turn on Hive mode?") in
place of Carnage's tendrils, in the real dialog. The person picked the Circuit, which is built in
`packages/viewer/src/ui/hive-art.ts` and `hive-draw.ts`, and kept the Swarm "for the future… we'll
do something with that". The plan and its decisions (665–667, 673) are in
[docs/plan/v82-hive-mode.md](../../docs/plan/v82-hive-mode.md); what was learned is in
[docs/journal/v82-hive-mode.md](../../docs/journal/v82-hive-mode.md).

| Candidate | What it draws |
|---|---|
| `circuit` | Ten traces at 0° and 45° route in from both edges and land on a machined Hive Mind; packets run in, orders run out. Built. |
| `conduits` | Ten ribbed metal cables shoot out, pause to align and plug into the Mind with sparks; light runs down the ribs. |
| `swarm` | The Mind's plates fly in and lock, core first; about 90 hex drones fly in and dock on the Mind's own lattice, smaller and sparser toward the edges; signals hop drone to drone into the Mind, and a pulse spreads out from the core now and then. Kept for later. |

![The Swarm at rest in the question, 1×](swarm.png)

`swarm.mp4` is the Swarm from the moment the dialog opens, 7 s at 30 frames a second, 1×.

## Files

| File | What it is |
|---|---|
| `proto.js` | The three candidates, each a pure function of time (`draw(ctx, t)` on the 520 × 128 art), and `HiveProto.mount(kind)` / `play(kind)`, which put one in place of the question's canvas |
| `record.mjs` | Stills (both themes) and films (frame by frame, the prototype stepped 1/30 s) of the candidates in a running `symbiote view` |
| `swarm.mp4`, `swarm.png` | The Swarm as the person saw it |

## Running it

```sh
pnpm build
# In a scratch git repository (Hive off: no symbiote/hive.json):
node <repo>/packages/cli/dist/bin.js view --no-open        # prints the viewer's URL
node spikes/hive-question-candidates/record.mjs <url> <out> film swarm
ffmpeg -framerate 30 -i <out>/swarm-frames/f%04d.png -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" \
  -c:v libx264 -pix_fmt yuv420p swarm.mp4
```

On this machine, run Playwright with `env -u WAYLAND_DISPLAY` (headless Chromium gives no frames
with WSLg's display set). The prototype's Mind sits 2 px higher than the built one's (at 62, not
64 of the art's 128).

**Measured** (the question open 10 s, every browser process, hardware acceleration off, two runs):
Carnage's tendrils 17 and 18 % of a core; Circuit 13 and 18 %; Conduits 13 and 16 %; Swarm 10 and
10 %; a still question 3 %.
